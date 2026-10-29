import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSearchUrl,
  buildJobPostingUrl,
  parseSearchCards,
  isParseAnomaly,
  parseJobDescription,
  isDescriptionAnomaly,
  deriveWorkType,
  isWorldwideRemote,
  runSearch,
  WORLDWIDE_GEO_ID,
} from "../src/linkedin.ts";
import type { Config, FetchResult, Search } from "../src/types.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const searchPage = fixture("search-page.html");
const emptyPage = fixture("search-page-empty.html");
const brokenPage = fixture("search-page-broken.html");
const jobPosting = fixture("job-posting.html");
const relocationPosting = fixture("job-posting-relocation.html");
const noAngularPosting = fixture("job-posting-no-angular.html");

const egypt: Search = {
  id: "angular-egypt",
  keywords: "Angular",
  geoId: "106155005",
  remoteOnly: false,
  experienceLevels: [4, 5],
  postedWithinSeconds: 86400,
};
const worldwide: Search = {
  id: "frontend-angular-remote",
  keywords: "Frontend Angular",
  geoId: WORLDWIDE_GEO_ID,
  remoteOnly: true,
  experienceLevels: [4, 5],
  postedWithinSeconds: 86400,
};

function config(maxPagesPerSearch: number): Config {
  return {
    maxPagesPerSearch,
    maxRequestsPerRun: 15,
    delayMs: { min: 0, max: 0 },
    digestThreshold: 15,
    stateRetentionDays: 30,
    searches: [egypt],
    includeTitleTerms: ["angular*"],
    conditionalTitleTerms: ["frontend"],
    descriptionRequiredTerms: ["angular*"],
    excludeTitleTerms: ["junior"],
    relocationPatterns: ["relocat"],
  };
}

describeCards();

function describeCards() {
  const cards = parseSearchCards(searchPage);

  test("parseSearchCards reads all 10 cards with numeric ids from data-entity-urn", () => {
    assert.equal(cards.length, 10);
    for (const c of cards) assert.match(c.id, /^\d+$/);
    assert.equal(cards[0].id, "4470095444");
    assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  });

  test("title, company and location are trimmed with whitespace collapsed", () => {
    for (const c of cards) {
      for (const v of [c.title, c.company, c.location]) {
        assert.ok(v.length > 0);
        assert.equal(v, v.trim());
        assert.doesNotMatch(v, /\s{2,}|\n/);
      }
    }
    assert.deepEqual(
      { title: cards[0].title, company: cards[0].company, location: cards[0].location },
      { title: "Engineering Manager - NET+Angular", company: "VeriPark", location: "Egypt" },
    );
    const titles = cards.map((c) => c.title);
    assert.ok(titles.includes("Corporate Lawyer"));
    assert.ok(titles.includes("Junior Angular Developer"));
    assert.ok(titles.includes("Frontend Engineer"));
  });

  test("postedDate is YYYY-MM-DD or null; postedAgo read from listdate--new card", () => {
    for (const c of cards) {
      if (c.postedDate !== null) assert.match(c.postedDate, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(c.postedAgo.length > 0);
    }
    const fresh = cards.find((c) => c.id === "4473235453");
    assert.ok(fresh);
    assert.equal(fresh.postedAgo, "12 minutes ago");
    assert.equal(fresh.postedDate, "2026-09-29");
    assert.equal(cards[0].postedAgo, "4 days ago");
  });

  test("link is normalized to /jobs/view/<id>", () => {
    for (const c of cards) assert.equal(c.link, `https://www.linkedin.com/jobs/view/${c.id}`);
  });

  test("empty page gives [] and is not an anomaly", () => {
    const empty = parseSearchCards(emptyPage);
    assert.deepEqual(empty, []);
    assert.equal(isParseAnomaly(emptyPage, empty), false);
    assert.equal(isParseAnomaly("   \n", []), false);
  });

  test("isParseAnomaly is true for non-empty html with no cards", () => {
    const broken = parseSearchCards(brokenPage);
    assert.deepEqual(broken, []);
    assert.equal(isParseAnomaly(brokenPage, broken), true);
    assert.equal(isParseAnomaly(searchPage, cards), false);
  });
}

test("buildSearchUrl follows contracts/config.md", () => {
  assert.equal(
    buildSearchUrl(egypt, 0),
    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=Angular&geoId=106155005&f_TPR=r86400&f_E=4%2C5&start=0",
  );
  assert.equal(
    buildSearchUrl(worldwide, 1),
    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=Frontend%20Angular&geoId=92000000&f_TPR=r86400&f_E=4%2C5&f_WT=2&start=10",
  );
  assert.doesNotMatch(buildSearchUrl(egypt, 1), /f_WT/);
  assert.match(buildSearchUrl(egypt, 2), /&start=20$/);
});

test("buildJobPostingUrl", () => {
  assert.equal(buildJobPostingUrl("4470095444"), "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4470095444");
});

test("parseJobDescription returns collapsed non-empty text", () => {
  const d = parseJobDescription(jobPosting);
  assert.ok(d && d.length > 100);
  assert.match(d, /Angular/);
  assert.doesNotMatch(d, /\s{2,}/);
  assert.equal(d, d.trim());
  assert.doesNotMatch(d, /Show more|Show less/);
  assert.match(parseJobDescription(relocationPosting) ?? "", /Candidates must be located in the US/);
  assert.doesNotMatch(parseJobDescription(noAngularPosting) ?? "", /angular/i);
  assert.equal(parseJobDescription(brokenPage), null);
  assert.equal(parseJobDescription(""), null);
  assert.equal(parseJobDescription('<div class="description__text">  </div>'), null);
});

test("isDescriptionAnomaly", () => {
  assert.equal(isDescriptionAnomaly(brokenPage, parseJobDescription(brokenPage)), true);
  assert.equal(isDescriptionAnomaly(jobPosting, parseJobDescription(jobPosting)), false);
  assert.equal(isDescriptionAnomaly("", null), false);
  assert.equal(isDescriptionAnomaly(jobPosting, ""), true);
});

test("deriveWorkType follows research R4", () => {
  assert.equal(deriveWorkType(worldwide, "United States"), "Remote");
  assert.equal(deriveWorkType({ ...egypt, remoteOnly: true }, "Cairo (Hybrid)"), "Remote");
  assert.equal(deriveWorkType(egypt, "Cairo, Egypt (Hybrid)"), "Hybrid");
  assert.equal(deriveWorkType(egypt, "Cairo, Egypt (On-site)"), "On-site");
  assert.equal(deriveWorkType(egypt, "Egypt (Remote)"), "Remote");
  assert.equal(deriveWorkType(egypt, "egypt (remote)"), "Remote");
  assert.equal(deriveWorkType(egypt, "Cairo, Cairo, Egypt"), null);
});

test("isWorldwideRemote", () => {
  assert.equal(isWorldwideRemote(worldwide), true);
  assert.equal(isWorldwideRemote({ ...worldwide, remoteOnly: false }), false);
  assert.equal(isWorldwideRemote({ ...egypt, remoteOnly: true }), false);
});

function stubFetcher(pages: FetchResult[]) {
  const urls: string[] = [];
  const fetcher = async (url: string): Promise<FetchResult> => {
    urls.push(url);
    return pages[Math.min(urls.length - 1, pages.length - 1)];
  };
  return { fetcher, urls };
}

test("runSearch fetches pages and stops on an empty page", async () => {
  const { fetcher, urls } = stubFetcher([
    { status: "ok", html: searchPage },
    { status: "ok", html: emptyPage },
    { status: "ok", html: searchPage },
  ]);
  const r = await runSearch(egypt, config(3), fetcher);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], buildSearchUrl(egypt, 0));
  assert.equal(urls[1], buildSearchUrl(egypt, 1));
  assert.equal(r.cards.length, 10);
  assert.deepEqual(r.summary, { id: "angular-egypt", pages: 2, cards: 10, status: "ok" });
  assert.equal(r.warning, undefined);
});

test("runSearch respects maxPagesPerSearch", async () => {
  const { fetcher, urls } = stubFetcher([{ status: "ok", html: searchPage }]);
  const r = await runSearch(egypt, config(1), fetcher);
  assert.equal(urls.length, 1);
  assert.equal(r.summary.status, "ok");
  assert.equal(r.summary.pages, 1);
});

test("runSearch reports parse_error on a broken page and keeps earlier cards", async () => {
  const { fetcher } = stubFetcher([
    { status: "ok", html: searchPage },
    { status: "ok", html: brokenPage },
  ]);
  const r = await runSearch(egypt, config(2), fetcher);
  assert.equal(r.summary.status, "parse_error");
  assert.equal(r.cards.length, 10);

  const first = await runSearch(egypt, config(2), stubFetcher([{ status: "ok", html: brokenPage }]).fetcher);
  assert.equal(first.summary.status, "parse_error");
  assert.deepEqual(first.cards, []);
});

test("runSearch is skipped with a warning when the first page is rate limited", async () => {
  for (const res of [{ status: "rate_limited" }, { status: "budget_exhausted" }, { status: "error", error: "boom" }] as FetchResult[]) {
    const { fetcher, urls } = stubFetcher([res]);
    const r = await runSearch(egypt, config(2), fetcher);
    assert.equal(urls.length, 1);
    assert.equal(r.summary.status, "skipped");
    assert.equal(r.summary.cards, 0);
    assert.deepEqual(r.cards, []);
    assert.ok(r.warning && r.warning.includes("angular-egypt"));
  }
});

test("runSearch keeps earlier cards with a warning when a later page fails", async () => {
  const { fetcher } = stubFetcher([{ status: "ok", html: searchPage }, { status: "rate_limited" }]);
  const r = await runSearch(egypt, config(2), fetcher);
  assert.equal(r.summary.status, "ok");
  assert.equal(r.cards.length, 10);
  assert.equal(r.summary.pages, 1);
  assert.ok(r.warning);
});
