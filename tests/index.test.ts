import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, type MainDeps } from "../src/index.ts";
import type { RadarOptions, RadarDeps, RadarResult } from "../src/radar.ts";
import type { JobPosting, RunSummary } from "../src/types.ts";

const TOKEN = "123456:SECRET-TOKEN-abcdef";
const NOW = new Date("2026-09-29T10:00:00.000Z");

const CONFIG = {
  searches: [{ id: "angular-egypt", keywords: "Angular", geoId: "106155005" }],
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "radar-index-"));
}

function setup(opts: { config?: unknown; state?: string } = {}) {
  const dir = tempDir();
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, typeof opts.config === "string" ? opts.config : JSON.stringify(opts.config ?? CONFIG));
  const statePath = join(dir, "data", "seen.json");
  if (opts.state !== undefined) {
    writeFileSync(join(dir, "seen.json"), opts.state);
    return { dir, configPath, statePath: join(dir, "seen.json") };
  }
  return { dir, configPath, statePath };
}

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return {
    searches: [{ id: "angular-egypt", pages: 1, cards: 2, status: "ok" }],
    requestsUsed: 3,
    matched: 1,
    notified: 1,
    rejected: 1,
    deferred: 0,
    errors: [],
    warnings: [],
    ...over,
  };
}

function job(id: string, decision: JobPosting["decision"]): JobPosting {
  return {
    id,
    title: `Senior Angular Dev ${id}`,
    company: "Acme",
    location: "Cairo, Egypt",
    postedDate: null,
    postedAgo: "1 hour ago",
    link: `https://www.linkedin.com/jobs/view/${id}`,
    workType: null,
    sources: ["angular-egypt"],
    worldwideRemote: false,
    description: null,
    relocationWarning: false,
    decision,
  };
}

function result(over: Partial<RadarResult> = {}): RadarResult {
  return {
    summary: summary(),
    jobs: [job("111", "NOTIFIED"), job("222", "REJECTED")],
    handledIds: ["111", "222"],
    messages: ["<b>Job 111</b>"],
    initializedAt: null,
    saveState: true,
    ...over,
  };
}

function harness(res: RadarResult | (() => Promise<RadarResult>), env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: { opts: RadarOptions; deps: RadarDeps }[] = [];
  const sent: { token: string; chatId: string }[] = [];
  const deps: Partial<MainDeps> = {
    env: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "42", ...env },
    now: () => NOW,
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    runRadar: async (opts, d) => {
      calls.push({ opts, deps: d });
      return typeof res === "function" ? res() : res;
    },
    createFetcher: () => async () => ({ status: "error", error: "no network in tests" }),
    createSender: (token, chatId) => {
      sent.push({ token, chatId });
      return async () => true;
    },
  };
  return {
    deps,
    calls,
    sent,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

test("missing TELEGRAM_BOT_TOKEN -> exit 1, no runRadar call", async () => {
  const { configPath, statePath } = setup();
  const h = harness(result(), { TELEGRAM_BOT_TOKEN: undefined });
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 1);
  assert.equal(h.calls.length, 0);
  assert.match(h.stderr(), /^ERROR .*TELEGRAM_BOT_TOKEN/m);
});

test("missing TELEGRAM_CHAT_ID -> exit 1, no runRadar call", async () => {
  const { configPath, statePath } = setup();
  const h = harness(result(), { TELEGRAM_CHAT_ID: "" });
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 1);
  assert.equal(h.calls.length, 0);
  assert.match(h.stderr(), /^ERROR .*TELEGRAM_CHAT_ID/m);
});

test("dry-run works without secrets, prints decisions and messages, never writes state", async () => {
  const { configPath, statePath } = setup();
  const h = harness(result({ saveState: false, messages: ["msg one", "msg two"] }), {
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_CHAT_ID: undefined,
  });
  const code = await main(["--dry-run", "--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].opts.dryRun, true);
  assert.equal(h.sent.length, 0);
  await assert.rejects(h.calls[0].deps.send("x"));
  const out = h.stdout();
  assert.ok(out.includes("111 | Senior Angular Dev 111 | Acme | Cairo, Egypt | NOTIFIED\n"));
  assert.ok(out.includes("222 | Senior Angular Dev 222 | Acme | Cairo, Egypt | REJECTED\n"));
  assert.ok(out.includes("--- messages that would be sent (2) ---\nmsg one\n\nmsg two\n"));
  assert.ok(out.includes("Run summary"));
  assert.equal(existsSync(statePath), false);
});

test("dry-run never writes state even if result says saveState", async () => {
  const { configPath, statePath } = setup();
  const h = harness(result({ saveState: true }), { TELEGRAM_BOT_TOKEN: undefined });
  const code = await main(["--dry-run", "--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 0);
  assert.equal(existsSync(statePath), false);
});

test("invalid config -> exit 1, no runRadar call", async () => {
  const { configPath, statePath } = setup({ config: { searches: [] } });
  const h = harness(result());
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 1);
  assert.equal(h.calls.length, 0);
  assert.match(h.stderr(), /^ERROR searches/m);
});

test("missing config file -> exit 1", async () => {
  const dir = tempDir();
  const h = harness(result());
  const code = await main(["--config", join(dir, "nope.json"), "--state", join(dir, "s.json")], h.deps);
  assert.equal(code, 1);
  assert.match(h.stderr(), /^ERROR /m);
});

test("invalid state file -> exit 1 and file unchanged", async () => {
  const bad = "{ not json";
  const { configPath, statePath } = setup({ state: bad });
  const h = harness(result());
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 1);
  assert.equal(h.calls.length, 0);
  assert.match(h.stderr(), /^ERROR /m);
  assert.equal(readFileSync(statePath, "utf8"), bad);
});

test("normal run saves handled ids with timestamps and keeps existing timestamps", async () => {
  const existing = {
    version: 1,
    initializedAt: "2026-09-20T00:00:00.000Z",
    seen: { "111": "2026-09-28T00:00:00.000Z", "999": "2026-09-27T00:00:00.000Z" },
  };
  const { configPath, statePath } = setup({ state: JSON.stringify(existing) });
  const h = harness(result({ handledIds: ["111", "222"] }));
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 0);
  assert.equal(h.calls[0].opts.dryRun, false);
  assert.equal(h.calls[0].opts.now, NOW);
  assert.deepEqual(h.sent, [{ token: TOKEN, chatId: "42" }]);
  const saved = JSON.parse(readFileSync(statePath, "utf8"));
  assert.deepEqual(saved, {
    version: 1,
    initializedAt: "2026-09-20T00:00:00.000Z",
    seen: {
      "111": "2026-09-28T00:00:00.000Z",
      "222": NOW.toISOString(),
      "999": "2026-09-27T00:00:00.000Z",
    },
  });
});

test("first run persists initializedAt and creates parent folder", async () => {
  const { configPath, statePath } = setup();
  const h = harness(async () => {
    assert.equal(h.calls[0].opts.state.firstRun, true);
    return result({ initializedAt: NOW.toISOString(), handledIds: ["111"] });
  });
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 0);
  const saved = JSON.parse(readFileSync(statePath, "utf8"));
  assert.deepEqual(saved, { version: 1, initializedAt: NOW.toISOString(), seen: { "111": NOW.toISOString() } });
});

test("saveState false -> no file written", async () => {
  const { configPath, statePath } = setup();
  const h = harness(result({ saveState: false, summary: summary({ errors: ["telegram: startup message failed"] }) }));
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 1);
  assert.equal(existsSync(statePath), false);
});

test("summary errors -> exit 1 with ERROR on stderr, handled ids still saved", async () => {
  const { configPath, statePath } = setup();
  const h = harness(result({ summary: summary({ errors: ["angular-egypt: parse anomaly"] }), handledIds: ["222"] }));
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 1);
  assert.match(h.stderr(), /^ERROR angular-egypt: parse anomaly$/m);
  const saved = JSON.parse(readFileSync(statePath, "utf8"));
  assert.deepEqual(Object.keys(saved.seen), ["222"]);
});

test("warnings -> WARN on stderr, exit 0, summary printed", async () => {
  const { configPath, statePath } = setup();
  const h = harness(
    result({
      summary: summary({
        warnings: ["angular-egypt: rate limited, skipped"],
        searches: [{ id: "angular-egypt", pages: 0, cards: 0, status: "skipped" }],
      }),
    }),
  );
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 0);
  assert.match(h.stderr(), /^WARN angular-egypt: rate limited, skipped$/m);
  assert.doesNotMatch(h.stderr(), /ERROR/);
  const out = h.stdout();
  assert.match(out, /^Run summary$/m);
  assert.match(out, /^ {2}angular-egypt: skipped, 0 page\(s\), 0 card\(s\)$/m);
  for (const label of ["requests used: 3", "matched: 1", "notified: 1", "rejected: 1", "deferred: 0"]) {
    assert.ok(out.includes(label), label);
  }
});

test("token never appears in stdout or stderr", async () => {
  const { configPath, statePath } = setup();
  const h = harness(
    result({
      summary: summary({ errors: [`telegram failed for bot${TOKEN}/sendMessage`], warnings: [`warn ${TOKEN}`] }),
    }),
  );
  const code = await main(["--config", configPath, "--state", statePath], h.deps);
  assert.equal(code, 1);
  assert.ok(!h.stdout().includes(TOKEN));
  assert.ok(!h.stderr().includes(TOKEN));
  assert.ok(h.stderr().includes("***"));

  const h2 = harness(async () => {
    throw new Error(`boom ${TOKEN}`);
  });
  assert.equal(await main(["--config", configPath, "--state", statePath], h2.deps), 1);
  assert.ok(!h2.stderr().includes(TOKEN));
});

test("unknown flag -> exit 1", async () => {
  const h = harness(result());
  assert.equal(await main(["--verbose"], h.deps), 1);
  assert.match(h.stderr(), /^ERROR .*--verbose/m);
  assert.equal(h.calls.length, 0);
});

test("flag missing its value -> exit 1", async () => {
  const h = harness(result());
  assert.equal(await main(["--config"], h.deps), 1);
  assert.equal(await main(["--state", "--dry-run"], h.deps), 1);
  assert.equal(h.calls.length, 0);
});

test("budget and fetcher are built from config and passed to runRadar", async () => {
  const { configPath, statePath } = setup({ config: { ...CONFIG, maxRequestsPerRun: 7 } });
  const h = harness(result());
  let seenDelay: unknown;
  h.deps.createFetcher = (budget, delayMs) => {
    seenDelay = delayMs;
    assert.equal(budget.max, 7);
    return async () => ({ status: "budget_exhausted" });
  };
  assert.equal(await main(["--config", configPath, "--state", statePath], h.deps), 0);
  assert.equal(h.calls[0].deps.budget.max, 7);
  assert.deepEqual(seenDelay, { min: 2000, max: 5000 });
});
