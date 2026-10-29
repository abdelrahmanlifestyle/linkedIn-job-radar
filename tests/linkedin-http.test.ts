import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestBudget, createPoliteFetcher, USER_AGENT, WORLDWIDE_GEO_ID } from "../src/linkedin.ts";

interface Call { url: string; init: RequestInit | undefined }

function stubFetch(statuses: Array<number | Error>) {
  const calls: Call[] = [];
  let i = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const s = statuses[Math.min(i++, statuses.length - 1)];
    if (s instanceof Error) throw s;
    const body = `<li>body ${i}</li>`;
    // Response constructor rejects status 999, so fake the parts the fetcher uses.
    return { status: s, ok: s >= 200 && s < 300, body: null, text: async () => body } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function stubSleep() {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => { sleeps.push(ms); };
  return { sleep, sleeps };
}

test("constants", () => {
  assert.equal(WORLDWIDE_GEO_ID, "92000000");
  assert.match(USER_AGENT, /Chrome\/\d+/);
  assert.match(USER_AGENT, /Windows NT|Macintosh/);
});

test("RequestBudget counts and refuses once used === max", () => {
  const b = new RequestBudget(2);
  assert.equal(b.max, 2);
  assert.equal(b.used, 0);
  assert.equal(b.remaining, 2);
  assert.equal(b.tryConsume(), true);
  assert.equal(b.tryConsume(), true);
  assert.equal(b.used, 2);
  assert.equal(b.remaining, 0);
  assert.equal(b.tryConsume(), false);
  assert.equal(b.used, 2);
});

test("ok response returns html; headers are polite and carry no cookie", async () => {
  const { fetch, calls } = stubFetch([200]);
  const { sleep } = stubSleep();
  const f = createPoliteFetcher(new RequestBudget(5), { min: 2000, max: 5000 }, { fetch, sleep, random: () => 0.5 });
  const r = await f("https://www.linkedin.com/x");
  assert.deepEqual(r, { status: "ok", html: "<li>body 1</li>" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.linkedin.com/x");
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get("user-agent"), USER_AGENT);
  assert.equal(headers.get("accept-language"), "en-US,en;q=0.9");
  assert.equal(headers.get("accept"), "text/html");
  assert.equal(headers.get("cookie"), null);
  assert.notEqual(calls[0].init?.credentials, "include");
});

test("no delay before the first request, delay within [min,max] before later ones", async () => {
  const { fetch } = stubFetch([200]);
  const { sleep, sleeps } = stubSleep();
  const randoms = [0, 0.999, 0.25];
  let ri = 0;
  const f = createPoliteFetcher(new RequestBudget(10), { min: 2000, max: 5000 }, { fetch, sleep, random: () => randoms[ri++] });
  await f("u1");
  assert.deepEqual(sleeps, []);
  await f("u2");
  await f("u3");
  await f("u4");
  assert.equal(sleeps.length, 3);
  for (const s of sleeps) assert.ok(s >= 2000 && s <= 5000, `delay ${s}`);
  assert.equal(sleeps[0], 2000);
  assert.equal(sleeps[2], 2750);
});

test("each attempt consumes budget; exhausted budget returns budget_exhausted without fetching", async () => {
  const { fetch, calls } = stubFetch([200]);
  const { sleep } = stubSleep();
  const budget = new RequestBudget(1);
  const f = createPoliteFetcher(budget, { min: 0, max: 0 }, { fetch, sleep, random: () => 0 });
  assert.equal((await f("a")).status, "ok");
  assert.equal(budget.used, 1);
  assert.deepEqual(await f("b"), { status: "budget_exhausted" });
  assert.equal(calls.length, 1);
});

for (const code of [429, 999]) {
  test(`HTTP ${code} retries after 10s then 30s, then rate_limited (3 attempts)`, async () => {
    const { fetch, calls } = stubFetch([code]);
    const { sleep, sleeps } = stubSleep();
    const budget = new RequestBudget(10);
    const f = createPoliteFetcher(budget, { min: 2000, max: 5000 }, { fetch, sleep, random: () => 0 });
    const r = await f("u");
    assert.deepEqual(r, { status: "rate_limited" });
    assert.equal(calls.length, 3);
    assert.equal(budget.used, 3);
    assert.deepEqual(sleeps, [10000, 30000]);
  });
}

test("rate limit then success returns ok and counts retries in budget", async () => {
  const { fetch, calls } = stubFetch([429, 200]);
  const { sleep, sleeps } = stubSleep();
  const budget = new RequestBudget(10);
  const f = createPoliteFetcher(budget, { min: 2000, max: 5000 }, { fetch, sleep, random: () => 0 });
  const r = await f("u");
  assert.equal(r.status, "ok");
  assert.equal(calls.length, 2);
  assert.equal(budget.used, 2);
  assert.deepEqual(sleeps, [10000]);
});

test("retry stops with budget_exhausted when budget runs out mid-retry", async () => {
  const { fetch, calls } = stubFetch([429]);
  const { sleep } = stubSleep();
  const budget = new RequestBudget(2);
  const f = createPoliteFetcher(budget, { min: 0, max: 0 }, { fetch, sleep, random: () => 0 });
  assert.deepEqual(await f("u"), { status: "budget_exhausted" });
  assert.equal(calls.length, 2);
  assert.equal(budget.used, 2);
});

test("other non-2xx returns error without retry", async () => {
  const { fetch, calls } = stubFetch([500]);
  const { sleep } = stubSleep();
  const f = createPoliteFetcher(new RequestBudget(10), { min: 0, max: 0 }, { fetch, sleep, random: () => 0 });
  const r = await f("u");
  assert.equal(r.status, "error");
  assert.match(r.status === "error" ? r.error : "", /500/);
  assert.equal(calls.length, 1);
});

test("thrown fetch error returns error", async () => {
  const { fetch } = stubFetch([new Error("ECONNRESET")]);
  const { sleep } = stubSleep();
  const f = createPoliteFetcher(new RequestBudget(10), { min: 0, max: 0 }, { fetch, sleep, random: () => 0 });
  const r = await f("u");
  assert.equal(r.status, "error");
  assert.match(r.status === "error" ? r.error : "", /ECONNRESET/);
});
