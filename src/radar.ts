import {
  buildJobPostingUrl,
  deriveWorkType,
  isDescriptionAnomaly,
  isWorldwideRemote,
  parseJobDescription,
  runSearch,
} from "./linkedin.ts";
import {
  classifyTitle,
  compileRelocationPatterns,
  descriptionMatches,
  hasRelocationWarning,
  needsDescription,
} from "./filter.ts";
import type { RequestBudget } from "./linkedin.ts";
import { formatDigest, formatJob, formatStartup, sendPaced } from "./telegram.ts";
import type {
  Config,
  Fetcher,
  JobCard,
  JobPosting,
  LoadedState,
  RunSummary,
  Search,
  SearchSummary,
  Sender,
  Sleep,
  TitleClass,
} from "./types.ts";

export interface RadarOptions {
  config: Config;
  state: LoadedState;
  now: Date;
  dryRun: boolean;
}

export interface RadarDeps {
  fetcher: Fetcher;
  budget: RequestBudget;
  send: Sender;
  sleep?: Sleep;
}

export interface RadarResult {
  summary: RunSummary;
  jobs: JobPosting[];
  handledIds: string[];
  messages: string[];
  initializedAt: string | null;
  saveState: boolean;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function collectCards(
  config: Config,
  fetcher: Fetcher,
  summary: RunSummary,
): Promise<Array<{ search: Search; cards: JobCard[] }>> {
  const results: Array<{ search: Search; cards: JobCard[] }> = [];
  for (const search of config.searches) {
    let searchSummary: SearchSummary;
    let cards: JobCard[] = [];
    try {
      const res = await runSearch(search, config, fetcher);
      searchSummary = res.summary;
      cards = res.cards;
      if (res.warning) summary.warnings.push(res.warning);
      if (searchSummary.status === "parse_error") {
        summary.errors.push(
          `search "${search.id}": LinkedIn returned a page but no job cards could be parsed (layout change?)`,
        );
      }
    } catch (err) {
      searchSummary = { id: search.id, pages: 0, cards: 0, status: "skipped" };
      summary.warnings.push(`search "${search.id}" skipped: ${errorMessage(err)}`);
    }
    summary.searches.push(searchSummary);
    results.push({ search, cards });
  }
  return results;
}

function mergeCards(results: Array<{ search: Search; cards: JobCard[] }>): JobPosting[] {
  const byId = new Map<string, { job: JobPosting; searches: Search[] }>();
  for (const { search, cards } of results) {
    for (const card of cards) {
      let entry = byId.get(card.id);
      if (!entry) {
        entry = {
          job: {
            ...card,
            workType: null,
            sources: [],
            worldwideRemote: false,
            description: null,
            relocationWarning: false,
            decision: "MATCHED",
          },
          searches: [],
        };
        byId.set(card.id, entry);
      }
      if (!entry.job.sources.includes(search.id)) {
        entry.job.sources.push(search.id);
        entry.searches.push(search);
      }
    }
  }
  const jobs: JobPosting[] = [];
  for (const { job, searches } of byId.values()) {
    if (searches.some((s) => s.remoteOnly)) {
      job.workType = "Remote";
    } else {
      for (const s of searches) {
        const wt = deriveWorkType(s, job.location);
        if (wt !== null) {
          job.workType = wt;
          break;
        }
      }
    }
    job.worldwideRemote = searches.some(isWorldwideRemote);
    jobs.push(job);
  }
  return jobs;
}

function byPostedDateOldestFirst(a: JobPosting, b: JobPosting): number {
  if (a.postedDate === b.postedDate) return 0;
  if (a.postedDate === null) return 1;
  if (b.postedDate === null) return -1;
  return a.postedDate < b.postedDate ? -1 : 1;
}

/** Splits digest chunks back into the jobs each one lists (one line per job). */
function digestGroups(chunks: string[], jobs: JobPosting[]): JobPosting[][] | null {
  const groups: JobPosting[][] = [];
  let offset = 0;
  for (const chunk of chunks) {
    const count = chunk.split("\n").length - 1;
    groups.push(jobs.slice(offset, offset + count));
    offset += count;
  }
  return offset === jobs.length ? groups : null;
}

export async function runRadar(opts: RadarOptions, deps: RadarDeps): Promise<RadarResult> {
  const { config, state, now, dryRun } = opts;
  const summary: RunSummary = {
    searches: [],
    requestsUsed: 0,
    matched: 0,
    notified: 0,
    rejected: 0,
    deferred: 0,
    errors: [],
    warnings: [],
  };
  const messages: string[] = [];
  let initializedAt: string | null = state.initializedAt;
  let saveState = !dryRun;

  const results = await collectCards(config, deps.fetcher, summary);
  const jobs = mergeCards(results);

  const classes = new Map<string, TitleClass>();
  const passed: JobPosting[] = [];
  for (const job of jobs) {
    if (Object.hasOwn(state.seen, job.id)) {
      job.decision = "SKIPPED_SEEN";
      continue;
    }
    const cls = classifyTitle(job.title, config);
    if (cls === "exclude" || cls === "none") {
      job.decision = "REJECTED";
      continue;
    }
    classes.set(job.id, cls);
    job.decision = "MATCHED";
    passed.push(job);
  }

  const matchedIds = new Set<string>();

  if (state.firstRun) {
    for (const job of passed) matchedIds.add(job.id);
    const startup = formatStartup(passed.length);
    messages.push(startup);
    if (dryRun) {
      saveState = false;
    } else {
      const [ok] = await sendPaced([startup], deps.send, { sleep: deps.sleep });
      if (ok) {
        for (const job of passed) job.decision = "NOTIFIED";
        initializedAt = now.toISOString();
        saveState = true;
      } else {
        for (const job of passed) job.decision = "DEFERRED";
        summary.errors.push("telegram: failed to send startup message");
        initializedAt = null;
        saveState = false;
      }
    }
  } else {
    const patterns = compileRelocationPatterns(config.relocationPatterns);
    const candidates = passed
      .filter((job) => needsDescription(job, classes.get(job.id)!))
      .sort(byPostedDateOldestFirst);
    let budgetDeferred = 0;

    for (const job of candidates) {
      if (deps.budget.remaining === 0) {
        job.decision = "DEFERRED";
        budgetDeferred++;
        continue;
      }
      let res;
      try {
        res = await deps.fetcher(buildJobPostingUrl(job.id));
      } catch (err) {
        res = { status: "error" as const, error: errorMessage(err) };
      }
      if (res.status === "budget_exhausted") {
        job.decision = "DEFERRED";
        budgetDeferred++;
        continue;
      }
      if (res.status !== "ok") {
        job.decision = "DEFERRED";
        const reason = res.status === "error" ? `error: ${res.error}` : "rate limited";
        summary.warnings.push(`job ${job.id}: description fetch failed (${reason}); deferred`);
        continue;
      }
      const description = parseJobDescription(res.html);
      if (isDescriptionAnomaly(res.html, description) || description === null) {
        job.decision = "DEFERRED";
        summary.errors.push(
          `job ${job.id}: LinkedIn returned a job page but no description could be parsed (layout change?)`,
        );
        continue;
      }
      job.description = description;
      if (
        classes.get(job.id) === "conditional" &&
        !descriptionMatches(description, config.descriptionRequiredTerms)
      ) {
        job.decision = "REJECTED";
        continue;
      }
      if (job.worldwideRemote) job.relocationWarning = hasRelocationWarning(description, patterns);
    }
    if (budgetDeferred > 0) {
      summary.warnings.push(`${budgetDeferred} job(s) deferred: request budget exhausted`);
    }

    const toNotify = passed.filter((job) => job.decision === "MATCHED");
    for (const job of toNotify) matchedIds.add(job.id);

    let batches: Array<{ message: string; jobs: JobPosting[]; label: string }> = [];
    if (toNotify.length > config.digestThreshold) {
      const chunks = formatDigest(toNotify);
      const groups = digestGroups(chunks, toNotify);
      batches = chunks.map((message, i) => ({
        message,
        // Fallback if the chunk/line mapping is ever off: a chunk failure defers every digest job.
        jobs: groups ? groups[i] : toNotify,
        label: `digest chunk ${i + 1}/${chunks.length}`,
      }));
    } else {
      batches = toNotify.map((job) => ({ message: formatJob(job), jobs: [job], label: `job ${job.id}` }));
    }
    messages.push(...batches.map((b) => b.message));

    if (!dryRun && batches.length > 0) {
      const sent = await sendPaced(
        batches.map((b) => b.message),
        deps.send,
        { sleep: deps.sleep },
      );
      batches.forEach((batch, i) => {
        if (sent[i]) return;
        summary.errors.push(`telegram: failed to send alert for ${batch.label}`);
        for (const job of batch.jobs) job.decision = "DEFERRED";
      });
      for (const job of toNotify) if (job.decision === "MATCHED") job.decision = "NOTIFIED";
    }
  }

  const handledIds: string[] = [];
  for (const job of jobs) {
    const d = job.decision;
    if (d === "REJECTED" || d === "NOTIFIED" || (dryRun && d === "MATCHED")) handledIds.push(job.id);
    if (d === "REJECTED") summary.rejected++;
    else if (d === "NOTIFIED") summary.notified++;
    else if (d === "DEFERRED") summary.deferred++;
  }
  summary.matched = matchedIds.size;
  summary.requestsUsed = deps.budget.used;

  return { summary, jobs, handledIds, messages, initializedAt, saveState };
}
