import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConfig } from "../src/config.ts";
import { RequestBudget } from "../src/linkedin.ts";
import { formatStartup } from "../src/telegram.ts";
import { runRadar } from "../src/radar.ts";
import type { Config, FetchResult, JobPosting, LoadedState } from "../src/types.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const SEARCH_PAGE = fixture("search-page.html");
const BROKEN = fixture("search-page-broken.html");
const POSTING = fixture("job-posting.html");
const POSTING_RELOCATION = fixture("job-posting-relocation.html");
const POSTING_NO_ANGULAR = fixture("job-posting-no-angular.html");

const NOW = new Date("2026-09-29T12:00:00.000Z");
const BASE_CONFIG = parseConfig(JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8")));

function makeConfig(overrides: Partial<Config> = {}): Config {
  return { ...structuredClone(BASE_CONFIG), ...overrides };
}

const NORMAL_STATE: LoadedState = { firstRun: false, initializedAt: "2026-09-01T00:00:00.000Z", seen: {} };
const FIRST_RUN_STATE: LoadedState = { firstRun: true, initializedAt: null, seen: {} };

interface CardSpec { id: string; title: string; company?: string; location?: string; date?: string | null; ago?: string }

function cardHtml(c: CardSpec): string {
  const date = c.date === undefined ? "2026-09-29" : c.date;
  const dt = date === null ? "" : ` datetime="${date}"`;
  return `<li>
  <div class="base-card relative w-full base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:${c.id}">
    <div class="base-search-card__info">
      <h3 class="base-search-card__title">${c.title}</h3>
      <h4 class="base-search-card__subtitle"><a class="hidden-nested-link">${c.company ?? "Acme"}</a></h4>
      <div class="base-search-card__metadata">
        <span class="job-search-card__location">${c.location ?? "Cairo, Egypt"}</span>
        <time class="job-search-card__listdate"${dt}>${c.ago ?? "1 hour ago"}</time>
      </div>
    </div>
  </div>
</li>`;
}

const pageOf = (...cards: CardSpec[]) => cards.map(cardHtml).join("\n");

type Route = string | FetchResult | Error;

interface Harness {
  config: Config;
  budget: RequestBudget;
  urls: string[];
  postingFetches: string[];
  sent: string[];
  sleeps: number[];
  run: (state?: LoadedState, dryRun?: boolean) => ReturnType<typeof runRadar>;
}

/**
 * searches: searchId -> list of pages (index = page number); missing pages are empty.
 * postings: jobId -> posting route; default is job-posting.html.
 * sendOk: decides per message (and call index) whether the send succeeds.
 */
function harness(opts: {
  config?: Config;
  searches?: Record<string, Route[]>;
  postings?: Record<string, Route>;
  sendOk?: (html: string, index: number) => boolean;
}): Harness {
  const config = opts.config ?? makeConfig();
  const budget = new RequestBudget(config.maxRequestsPerRun);
  const urls: string[] = [];
  const postingFetches: string[] = [];
  const sent: string[] = [];
  const sleeps: number[] = [];

  const resolve = (route: Route | undefined): FetchResult => {
    if (route === undefined) return { status: "ok", html: "" };
    if (route instanceof Error) throw route;
    if (typeof route === "string") return { status: "ok", html: route };
    return route;
  };

  const fetcher = async (url: string): Promise<FetchResult> => {
    if (!budget.tryConsume()) return { status: "budget_exhausted" };
    urls.push(url);
    const u = new URL(url);
    const posting = /\/jobPosting\/(\d+)$/.exec(u.pathname);
    if (posting) {
      postingFetches.push(posting[1]);
      const route = opts.postings?.[posting[1]];
      return resolve(route === undefined ? POSTING : route);
    }
    const keywords = u.searchParams.get("keywords");
    const geoId = u.searchParams.get("geoId");
    const page = Number(u.searchParams.get("start")) / 10;
    const search = config.searches.find((s) => s.keywords === keywords && s.geoId === geoId);
    assert.ok(search, `unexpected search url ${url}`);
    return resolve(opts.searches?.[search.id]?.[page]);
  };

  const send = async (html: string) => {
    const index = sent.length;
    sent.push(html);
    return opts.sendOk ? opts.sendOk(html, index) : true;
  };
  const sleep = async (ms: number) => { sleeps.push(ms); };

  return {
    config,
    budget,
    urls,
    postingFetches,
    sent,
    sleeps,
    run: (state = NORMAL_STATE, dryRun = false) =>
      runRadar({ config, state, now: NOW, dryRun }, { fetcher, budget, send, sleep }),
  };
}

const byId = (jobs: JobPosting[], id: string) => {
  const job = jobs.find((j) => j.id === id);
  assert.ok(job, `job ${id} not found`);
  return job;
};

// Fixture card ids (search-page.html)
const F = {
  netManager: "4470095444", // include
  netSupervisor: "4473235453", // include
  seniorFrontEnd: "4469456486", // conditional
  lawyer: "4470812175", // none
  frontendEngineer: "4470850325", // conditional
  uiux: "4461300459", // none
  juniorAngular: "4470595714", // exclude
  fullStack: "4471201853", // none
  software: "4471291353", // none
  attorney: "4473207977", // none
};

// ---------- US1 ----------

test("same id from 2 searches gives 1 job with both sources", async () => {
  const shared = { id: "100", title: "Senior Angular Developer" };
  const h = harness({
    searches: {
      "angular-egypt": [pageOf(shared, { id: "101", title: "Angular Lead" })],
      "frontend-angular-remote": [pageOf(shared)],
    },
    postings: { "100": POSTING },
  });
  const res = await h.run();
  const matches = res.jobs.filter((j) => j.id === "100");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].sources, ["angular-egypt", "frontend-angular-remote"]);
  assert.equal(matches[0].workType, "Remote");
  assert.equal(matches[0].worldwideRemote, true);
  assert.deepEqual(res.jobs.map((j) => j.id), ["100", "101"]);
  assert.equal(h.sent.filter((m) => m.includes("jobs/view/100")).length, 1);
});

test("merged job keeps first card fields and derives work type from location", async () => {
  const h = harness({
    searches: {
      "angular-egypt": [pageOf({ id: "200", title: "Angular Dev", location: "Cairo, Egypt (Hybrid)", company: "First" })],
      "frontend-egypt": [pageOf({ id: "200", title: "Angular Dev v2", location: "Elsewhere", company: "Second" })],
    },
  });
  const res = await h.run();
  const job = byId(res.jobs, "200");
  assert.equal(job.company, "First");
  assert.equal(job.title, "Angular Dev");
  assert.equal(job.workType, "Hybrid");
  assert.equal(job.worldwideRemote, false);
});

test("fixture search page: decisions, handledIds and sends", async () => {
  const h = harness({
    searches: { "angular-egypt": [SEARCH_PAGE] },
    postings: { [F.frontendEngineer]: POSTING, [F.seniorFrontEnd]: POSTING_NO_ANGULAR },
  });
  const res = await h.run();

  assert.equal(byId(res.jobs, F.lawyer).decision, "REJECTED");
  assert.equal(byId(res.jobs, F.juniorAngular).decision, "REJECTED");
  assert.equal(byId(res.jobs, F.netManager).decision, "NOTIFIED");
  assert.equal(byId(res.jobs, F.netSupervisor).decision, "NOTIFIED");
  assert.equal(byId(res.jobs, F.frontendEngineer).decision, "NOTIFIED");
  assert.equal(byId(res.jobs, F.seniorFrontEnd).decision, "REJECTED");
  assert.ok(byId(res.jobs, F.frontendEngineer).description?.toLowerCase().includes("angular"));

  for (const id of [F.lawyer, F.juniorAngular, F.netManager, F.netSupervisor, F.frontendEngineer, F.seniorFrontEnd]) {
    assert.ok(res.handledIds.includes(id), `${id} should be handled`);
  }
  assert.equal(res.handledIds.length, 10);

  // Egypt include titles need no description; only the 2 conditional titles are fetched.
  assert.deepEqual([...h.postingFetches].sort(), [F.frontendEngineer, F.seniorFrontEnd].sort());
  assert.equal(h.sent.length, 3);
  assert.ok(h.sent.every((m) => !m.includes("Lawyer") && !m.includes("Junior")));
  assert.deepEqual(res.messages, h.sent);

  assert.equal(res.summary.notified, 3);
  assert.equal(res.summary.matched, 3);
  assert.equal(res.summary.rejected, 7);
  assert.equal(res.summary.deferred, 0);
  assert.deepEqual(res.summary.errors, []);
  assert.equal(res.summary.requestsUsed, h.budget.used);
  assert.equal(res.saveState, true);
  assert.equal(res.initializedAt, NORMAL_STATE.initializedAt);
  assert.equal(res.summary.searches.length, 4);
  assert.deepEqual(res.summary.searches[0], { id: "angular-egypt", pages: 2, cards: 10, status: "ok" });
});

test("already-seen id is SKIPPED_SEEN and never sent", async () => {
  const h = harness({ searches: { "angular-egypt": [pageOf({ id: "300", title: "Angular Developer" })] } });
  const res = await h.run({ ...NORMAL_STATE, seen: { "300": "2026-09-28T00:00:00.000Z" } });
  assert.equal(byId(res.jobs, "300").decision, "SKIPPED_SEEN");
  assert.equal(h.sent.length, 0);
  assert.deepEqual(res.handledIds, []);
  assert.deepEqual(res.messages, []);
});

test("failed description fetch leads to DEFERRED, not handled, with a warning", async () => {
  const h = harness({
    searches: { "angular-egypt": [pageOf({ id: "400", title: "Frontend Engineer" }, { id: "401", title: "Web Developer" })] },
    postings: { "400": { status: "error", error: "HTTP 500" }, "401": { status: "rate_limited" } },
  });
  const res = await h.run();
  assert.equal(byId(res.jobs, "400").decision, "DEFERRED");
  assert.equal(byId(res.jobs, "401").decision, "DEFERRED");
  assert.deepEqual(res.handledIds, []);
  assert.equal(h.sent.length, 0);
  assert.equal(res.summary.deferred, 2);
  assert.deepEqual(res.summary.errors, []);
  assert.ok(res.summary.warnings.some((w) => w.includes("400")));
  assert.ok(res.summary.warnings.some((w) => w.includes("401")));
});

test("thrown description fetch leads to DEFERRED", async () => {
  const h = harness({
    searches: { "angular-egypt": [pageOf({ id: "402", title: "Frontend Engineer" })] },
    postings: { "402": new Error("boom") },
  });
  const res = await h.run();
  assert.equal(byId(res.jobs, "402").decision, "DEFERRED");
  assert.deepEqual(res.handledIds, []);
});

test("description anomaly leads to DEFERRED plus a summary error naming the job", async () => {
  const h = harness({
    searches: { "angular-egypt": [pageOf({ id: "500", title: "Frontend Engineer" })] },
    postings: { "500": BROKEN },
  });
  const res = await h.run();
  assert.equal(byId(res.jobs, "500").decision, "DEFERRED");
  assert.deepEqual(res.handledIds, []);
  assert.equal(res.summary.errors.length, 1);
  assert.match(res.summary.errors[0], /job 500: .*no description could be parsed/);
});

test("failed send leads to DEFERRED, not handled, with a summary error; others still notified", async () => {
  const h = harness({
    searches: { "angular-egypt": [pageOf({ id: "600", title: "Angular Developer" }, { id: "601", title: "Angular Lead" })] },
    sendOk: (html) => !html.includes("jobs/view/600"),
  });
  const res = await h.run();
  assert.equal(byId(res.jobs, "600").decision, "DEFERRED");
  assert.equal(byId(res.jobs, "601").decision, "NOTIFIED");
  assert.deepEqual(res.handledIds, ["601"]);
  assert.deepEqual(res.summary.errors, ["telegram: failed to send alert for job 600"]);
  assert.equal(res.summary.deferred, 1);
  assert.equal(res.summary.notified, 1);
  assert.equal(res.summary.matched, 2);
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.sleeps, [1100]);
});

// ---------- US2 ----------

test("rate-limited search is skipped with a warning; other searches continue; no errors", async () => {
  const h = harness({
    searches: {
      "angular-egypt": [{ status: "rate_limited" }],
      "frontend-egypt": [pageOf({ id: "700", title: "Angular Developer" })],
    },
  });
  const res = await h.run();
  assert.equal(res.summary.searches[0].status, "skipped");
  assert.equal(res.summary.searches[1].status, "ok");
  assert.equal(res.summary.searches.length, 4);
  assert.ok(res.summary.warnings.some((w) => w.includes("angular-egypt")));
  assert.deepEqual(res.summary.errors, []);
  assert.equal(byId(res.jobs, "700").decision, "NOTIFIED");
});

test("a search that throws is skipped with a warning and the rest continue", async () => {
  const h = harness({
    searches: {
      "angular-egypt": [new Error("socket hang up")],
      "frontend-egypt": [pageOf({ id: "701", title: "Angular Developer" })],
    },
  });
  const res = await h.run();
  assert.deepEqual(res.summary.searches[0], { id: "angular-egypt", pages: 0, cards: 0, status: "skipped" });
  assert.ok(res.summary.warnings.some((w) => w.includes("angular-egypt") && w.includes("socket hang up")));
  assert.deepEqual(res.summary.errors, []);
  assert.equal(byId(res.jobs, "701").decision, "NOTIFIED");
});

test("broken search page gives parse_error and a summary error", async () => {
  const h = harness({ searches: { "frontend-egypt": [BROKEN] } });
  const res = await h.run();
  assert.equal(res.summary.searches[1].status, "parse_error");
  assert.equal(res.summary.errors.length, 1);
  assert.match(res.summary.errors[0], /search "frontend-egypt": .*no job cards could be parsed/);
});

test("budget exhaustion: oldest postedDate first (null last, ties by search then card order), rest DEFERRED", async () => {
  // 4 searches x 1 page = 4 requests; 2 left for descriptions.
  const config = makeConfig({ maxPagesPerSearch: 1, maxRequestsPerRun: 6 });
  const [A, B, C, D, E] = ["1201", "1202", "1203", "1204", "1205"];
  const h = harness({
    config,
    searches: {
      "angular-egypt": [pageOf(
        { id: A, title: "Frontend Engineer", date: "2026-09-28" },
        { id: B, title: "Frontend Engineer", date: "2026-09-20" },
      )],
      "frontend-egypt": [pageOf(
        { id: C, title: "Frontend Engineer", date: null },
        { id: D, title: "Frontend Engineer", date: "2026-09-20" },
        { id: E, title: "Frontend Engineer", date: "2026-09-15" },
      )],
    },
  });
  const res = await h.run();
  assert.equal(res.summary.requestsUsed, 6);
  assert.ok(res.summary.requestsUsed <= config.maxRequestsPerRun);
  const decisions = Object.fromEntries(res.jobs.map((j) => [j.id, j.decision]));
  assert.deepEqual(decisions, { [A]: "DEFERRED", [B]: "NOTIFIED", [C]: "DEFERRED", [D]: "DEFERRED", [E]: "NOTIFIED" });
  assert.deepEqual(h.postingFetches, [E, B]);
  assert.deepEqual(res.handledIds.sort(), [B, E].sort());
  assert.ok(res.summary.warnings.includes("3 job(s) deferred: request budget exhausted"));
  assert.deepEqual(res.summary.errors, []);
});

test("budget ordering without exhaustion: null postedDate is fetched last", async () => {
  const config = makeConfig({ maxPagesPerSearch: 1 });
  const h = harness({
    config,
    searches: {
      "angular-egypt": [pageOf(
        { id: "1301", title: "Frontend Engineer", date: null },
        { id: "1302", title: "Frontend Engineer", date: "2026-09-29" },
      )],
    },
  });
  await h.run();
  assert.deepEqual(h.postingFetches, ["1302", "1301"]);
});

// ---------- US3 ----------

test("first run: 0 description fetches, exactly 1 startup message, all title matches handled", async () => {
  const h = harness({
    searches: {
      "angular-egypt": [SEARCH_PAGE],
      "angular-worldwide-remote": [pageOf({ id: "800", title: "Senior Angular Engineer", location: "Worldwide" })],
    },
  });
  const res = await h.run(FIRST_RUN_STATE);
  assert.deepEqual(h.postingFetches, []);
  // 2 include + 2 conditional from the fixture + 1 worldwide include
  assert.deepEqual(h.sent, [formatStartup(5)]);
  assert.deepEqual(res.messages, [formatStartup(5)]);
  for (const id of [F.netManager, F.netSupervisor, F.seniorFrontEnd, F.frontendEngineer, "800"]) {
    assert.equal(byId(res.jobs, id).decision, "NOTIFIED");
  }
  assert.equal(res.handledIds.length, 11);
  assert.ok(res.handledIds.includes(F.lawyer));
  assert.equal(res.initializedAt, NOW.toISOString());
  assert.equal(res.saveState, true);
  assert.equal(res.summary.notified, 5);
  assert.equal(res.summary.matched, 5);
  assert.equal(res.summary.rejected, 6);
});

test("first run: failed startup send returns saveState false", async () => {
  const h = harness({ searches: { "angular-egypt": [SEARCH_PAGE] }, sendOk: () => false });
  const res = await h.run(FIRST_RUN_STATE);
  assert.equal(h.sent.length, 1);
  assert.equal(res.saveState, false);
  assert.equal(res.initializedAt, null);
  assert.equal(byId(res.jobs, F.netManager).decision, "DEFERRED");
  assert.equal(res.summary.errors.length, 1);
  assert.equal(res.summary.deferred, 4);
});

test("first run with seen ids keeps them SKIPPED_SEEN", async () => {
  const h = harness({ searches: { "angular-egypt": [SEARCH_PAGE] } });
  const res = await h.run({ ...FIRST_RUN_STATE, seen: { [F.netManager]: "2026-09-28T00:00:00.000Z" } });
  assert.equal(byId(res.jobs, F.netManager).decision, "SKIPPED_SEEN");
  assert.deepEqual(h.sent, [formatStartup(3)]);
});

const manyCards = (n: number, prefix: string, title = (i: number) => `Angular Developer ${i}`) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${String(i).padStart(3, "0")}`, title: title(i) }));

test("16 new matches send one digest; 15 send individual messages", async () => {
  const h16 = harness({ searches: { "angular-egypt": [pageOf(...manyCards(16, "9"))] } });
  const r16 = await h16.run();
  assert.equal(h16.sent.length, 1);
  assert.match(h16.sent[0], /^🅰️ <b>16 new Angular jobs<\/b>/);
  assert.equal(r16.summary.notified, 16);
  assert.equal(r16.handledIds.length, 16);

  const h15 = harness({ searches: { "angular-egypt": [pageOf(...manyCards(15, "9"))] } });
  const r15 = await h15.run();
  assert.equal(h15.sent.length, 15);
  assert.ok(h15.sent.every((m) => m.startsWith("🅰️ <b>Angular Developer")));
  assert.equal(r15.summary.notified, 15);
});

test("a failed digest chunk only defers the jobs listed in it", async () => {
  const longTitle = (i: number) => `Senior Angular Developer ${i} ${"x".repeat(120)}`;
  const cards = manyCards(60, "8", longTitle);
  const h = harness({
    searches: { "angular-egypt": [pageOf(...cards)] },
    sendOk: (_html, index) => index !== 1,
  });
  const res = await h.run();
  assert.ok(h.sent.length >= 3, `expected >= 3 chunks, got ${h.sent.length}`);
  assert.ok(h.sent.slice(1).every((m) => m.startsWith("(cont.)\n")));
  assert.ok(h.sent.every((m) => m.length <= 4096));

  const chunkOf = (id: string) => {
    const idx = h.sent.map((m, i) => (m.includes(`jobs/view/${id}"`) ? i : -1)).filter((i) => i >= 0);
    assert.equal(idx.length, 1, `job ${id} must be in exactly one chunk`);
    return idx[0];
  };
  for (const c of cards) {
    const job = byId(res.jobs, c.id);
    assert.equal(job.decision, chunkOf(c.id) === 1 ? "DEFERRED" : "NOTIFIED", c.id);
  }
  const deferred = res.jobs.filter((j) => j.decision === "DEFERRED").length;
  assert.ok(deferred > 0 && deferred < 60);
  assert.equal(res.summary.deferred, deferred);
  assert.equal(res.handledIds.length, 60 - deferred);
  assert.deepEqual(res.summary.errors, [`telegram: failed to send alert for digest chunk 2/${h.sent.length}`]);
});

// ---------- US4 ----------

test("worldwide-remote include title: description fetched, relocation flagged, alert has ⚠️", async () => {
  const h = harness({
    searches: { "angular-worldwide-remote": [pageOf({ id: "1000", title: "Senior Angular Engineer", location: "United States" })] },
    postings: { "1000": POSTING_RELOCATION },
  });
  const res = await h.run();
  const job = byId(res.jobs, "1000");
  assert.equal(job.worldwideRemote, true);
  assert.deepEqual(h.postingFetches, ["1000"]);
  assert.equal(job.relocationWarning, true);
  assert.equal(job.decision, "NOTIFIED");
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0].includes("⚠️ mentions relocation / location restriction"));
});

test("worldwide-remote include title without relocation text is not flagged", async () => {
  const h = harness({
    searches: { "angular-worldwide-remote": [pageOf({ id: "1001", title: "Senior Angular Engineer", location: "Worldwide" })] },
    postings: { "1001": POSTING_NO_ANGULAR },
  });
  const res = await h.run();
  const job = byId(res.jobs, "1001");
  assert.equal(job.relocationWarning, false);
  assert.equal(job.decision, "NOTIFIED");
  assert.ok(!h.sent[0].includes("⚠️"));
});

test("same title from an Egypt-only search gets no description fetch", async () => {
  const h = harness({
    searches: { "angular-egypt": [pageOf({ id: "1100", title: "Senior Angular Engineer" })] },
    postings: { "1100": POSTING_RELOCATION },
  });
  const res = await h.run();
  assert.deepEqual(h.postingFetches, []);
  const job = byId(res.jobs, "1100");
  assert.equal(job.worldwideRemote, false);
  assert.equal(job.relocationWarning, false);
  assert.equal(job.decision, "NOTIFIED");
});

test("digest line for a flagged job ends with ⚠️", async () => {
  const config = makeConfig({ maxRequestsPerRun: 40 });
  const cards = manyCards(16, "7");
  const h = harness({
    config,
    searches: { "angular-worldwide-remote": [pageOf(...cards)] },
    postings: Object.fromEntries(cards.map((c, i) => [c.id, i === 0 ? POSTING_RELOCATION : POSTING])),
  });
  const res = await h.run();
  assert.equal(h.sent.length, 1);
  const lines = h.sent[0].split("\n");
  const flagged = lines.find((l) => l.includes(`jobs/view/${cards[0].id}"`));
  assert.ok(flagged?.endsWith(" ⚠️"));
  assert.equal(lines.filter((l) => l.endsWith(" ⚠️")).length, 1);
  assert.equal(res.summary.notified, 16);
});

// ---------- US6 ----------

test("dry run: send never called, handledIds computed, messages returned, state not saved", async () => {
  const h = harness({
    searches: { "angular-egypt": [SEARCH_PAGE] },
    postings: { [F.frontendEngineer]: POSTING, [F.seniorFrontEnd]: POSTING_NO_ANGULAR },
  });
  const res = await h.run(NORMAL_STATE, true);
  assert.equal(h.sent.length, 0);
  assert.equal(res.messages.length, 3);
  assert.equal(byId(res.jobs, F.netManager).decision, "MATCHED");
  assert.equal(res.handledIds.length, 10);
  assert.equal(res.saveState, false);
  assert.equal(res.summary.notified, 0);
  assert.equal(res.summary.matched, 3);
  assert.equal(res.jobs.length, 10);
});

test("dry run on first run: startup message returned but not sent", async () => {
  const h = harness({ searches: { "angular-egypt": [SEARCH_PAGE] } });
  const res = await h.run(FIRST_RUN_STATE, true);
  assert.equal(h.sent.length, 0);
  assert.deepEqual(res.messages, [formatStartup(4)]);
  assert.equal(res.saveState, false);
  assert.equal(res.initializedAt, null);
  assert.equal(res.handledIds.length, 10);
  assert.equal(byId(res.jobs, F.netManager).decision, "MATCHED");
});
