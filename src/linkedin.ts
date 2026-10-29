import * as cheerio from "cheerio";
import type {
  Config,
  FetchResult,
  Fetcher,
  JobCard,
  Search,
  SearchStatus,
  SearchSummary,
  Sleep,
  WorkType,
} from "./types.ts";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export const WORLDWIDE_GEO_ID = "92000000";

const RATE_LIMIT_BACKOFF_MS = [10_000, 30_000];
const REQUEST_TIMEOUT_MS = 30_000;

export class RequestBudget {
  max: number;
  used: number;

  constructor(max: number) {
    this.max = max;
    this.used = 0;
  }

  tryConsume(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }

  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }
}

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: Sleep;
  random: () => number;
}

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPoliteFetcher(
  budget: RequestBudget,
  delayMs: { min: number; max: number },
  deps: Partial<HttpDeps> = {},
): Fetcher {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  let firstDone = false;

  return async (url: string): Promise<FetchResult> => {
    for (let attempt = 0; ; attempt++) {
      if (!budget.tryConsume()) return { status: "budget_exhausted" };
      if (attempt > 0) {
        await sleep(RATE_LIMIT_BACKOFF_MS[attempt - 1]);
      } else if (firstDone) {
        await sleep(delayMs.min + random() * (delayMs.max - delayMs.min));
      }
      firstDone = true;

      let res: Response;
      try {
        res = await doFetch(url, {
          method: "GET",
          headers: {
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
            Accept: "text/html",
          },
          redirect: "follow",
          credentials: "omit",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        return { status: "error", error: err instanceof Error ? err.message : String(err) };
      }

      if (res.status === 429 || res.status === 999) {
        await res.body?.cancel().catch(() => {});
        if (attempt >= RATE_LIMIT_BACKOFF_MS.length) return { status: "rate_limited" };
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        await res.body?.cancel().catch(() => {});
        return { status: "error", error: `HTTP ${res.status}` };
      }
      try {
        return { status: "ok", html: await res.text() };
      } catch (err) {
        return { status: "error", error: err instanceof Error ? err.message : String(err) };
      }
    }
  };
}

const SEARCH_ENDPOINT = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const POSTING_ENDPOINT = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/";
const PAGE_SIZE = 10;

export function buildSearchUrl(search: Search, page: number): string {
  const params = [
    `keywords=${encodeURIComponent(search.keywords)}`,
    `geoId=${encodeURIComponent(search.geoId)}`,
    `f_TPR=r${search.postedWithinSeconds}`,
    `f_E=${encodeURIComponent(search.experienceLevels.join(","))}`,
  ];
  if (search.remoteOnly) params.push("f_WT=2");
  params.push(`start=${page * PAGE_SIZE}`);
  return `${SEARCH_ENDPOINT}?${params.join("&")}`;
}

export function buildJobPostingUrl(id: string): string {
  return `${POSTING_ENDPOINT}${encodeURIComponent(id)}`;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

export function isEmptySearchResponse(html: string): boolean {
  return html.replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<!--[\s\S]*?-->/g, "").trim() === "";
}

export function parseSearchCards(html: string): JobCard[] {
  if (isEmptySearchResponse(html)) return [];
  const $ = cheerio.load(html);
  const cards: JobCard[] = [];
  $("div.base-card[data-entity-urn]").each((_, el) => {
    const card = $(el);
    const id = /^urn:li:jobPosting:(\d+)$/.exec(card.attr("data-entity-urn")?.trim() ?? "")?.[1];
    if (!id) return;
    const time = card.find("time.job-search-card__listdate, time.job-search-card__listdate--new").first();
    const datetime = time.attr("datetime")?.trim() ?? "";
    cards.push({
      id,
      title: collapse(card.find("h3.base-search-card__title").first().text()),
      company: collapse(card.find("h4.base-search-card__subtitle").first().text()),
      location: collapse(card.find("span.job-search-card__location").first().text()),
      postedDate: /^\d{4}-\d{2}-\d{2}$/.test(datetime) ? datetime : null,
      postedAgo: collapse(time.text()),
      link: `https://www.linkedin.com/jobs/view/${id}`,
    });
  });
  return cards;
}

export function isParseAnomaly(html: string, cards: JobCard[]): boolean {
  return !isEmptySearchResponse(html) && cards.length === 0;
}

const BLOCK_TAGS = "p, br, li, ul, ol, div, section, h1, h2, h3, h4, h5, h6, tr, td, th";

export function parseJobDescription(html: string): string | null {
  if (html.trim() === "") return null;
  const $ = cheerio.load(html);
  const desc = $(".description__text").first();
  if (desc.length === 0) return null;
  desc.find("button, script, style").remove();
  desc.find(BLOCK_TAGS).each((_, el) => {
    $(el).prepend(" ").append(" ");
  });
  const text = collapse(desc.text());
  return text === "" ? null : text;
}

export function isDescriptionAnomaly(html: string, description: string | null): boolean {
  return html.trim() !== "" && (description === null || description.trim() === "");
}

const WORK_TYPE_IN_LOCATION: Array<[RegExp, WorkType]> = [
  [/\(\s*remote\s*\)/i, "Remote"],
  [/\(\s*hybrid\s*\)/i, "Hybrid"],
  [/\(\s*on[\s-]?site\s*\)/i, "On-site"],
];

export function deriveWorkType(search: Search, location: string): WorkType | null {
  if (search.remoteOnly) return "Remote";
  for (const [re, type] of WORK_TYPE_IN_LOCATION) if (re.test(location)) return type;
  return null;
}

export function isWorldwideRemote(search: Search): boolean {
  return search.remoteOnly && search.geoId === WORLDWIDE_GEO_ID;
}

const describeFailure = (r: Exclude<FetchResult, { status: "ok" }>) =>
  r.status === "error" ? `error: ${r.error}` : r.status.replace("_", " ");

export async function runSearch(
  search: Search,
  config: Config,
  fetcher: Fetcher,
): Promise<{ summary: SearchSummary; cards: JobCard[]; warning?: string }> {
  const cards: JobCard[] = [];
  const seen = new Set<string>();
  let pages = 0;
  let status: SearchStatus = "ok";
  let warning: string | undefined;

  for (let page = 0; page < config.maxPagesPerSearch; page++) {
    const res = await fetcher(buildSearchUrl(search, page));
    if (res.status !== "ok") {
      if (page === 0) {
        status = "skipped";
        warning = `search "${search.id}" skipped: ${describeFailure(res)}`;
      } else {
        warning = `search "${search.id}" stopped at page ${page + 1}: ${describeFailure(res)}`;
      }
      break;
    }
    pages++;
    const pageCards = parseSearchCards(res.html);
    if (isParseAnomaly(res.html, pageCards)) {
      status = "parse_error";
      break;
    }
    if (pageCards.length === 0) break;
    for (const c of pageCards) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      cards.push(c);
    }
  }

  const summary: SearchSummary = { id: search.id, pages, cards: cards.length, status };
  return warning === undefined ? { summary, cards } : { summary, cards, warning };
}
