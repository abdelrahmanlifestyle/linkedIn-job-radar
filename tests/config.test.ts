import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/config.ts";
import { classifyTitle } from "../src/filter.ts";

const REPO_CONFIG = fileURLToPath(new URL("../config.json", import.meta.url));

function minimal(): Record<string, unknown> {
  return { searches: [{ id: "angular-egypt", keywords: "Angular", geoId: "106155005" }] };
}

function rejects(raw: unknown, pathPrefix: string, extra?: RegExp): void {
  assert.throws(
    () => parseConfig(raw),
    (err: unknown) => {
      assert.ok(err instanceof ConfigError, `expected ConfigError, got ${String(err)}`);
      assert.ok(err.message.startsWith(pathPrefix), `message should start with "${pathPrefix}": ${err.message}`);
      if (extra) assert.match(err.message, extra);
      return true;
    },
  );
}

test("repository config.json loads", () => {
  const config = loadConfig(REPO_CONFIG);
  assert.equal(config.searches.length, 4);
  assert.deepEqual(config.searches.map((s) => s.id), [
    "angular-egypt",
    "frontend-egypt",
    "angular-worldwide-remote",
    "frontend-angular-remote",
  ]);
  assert.deepEqual(config.includeTitleTerms, ["angular*"]);
  assert.equal(config.relocationPatterns.length, 5);
});

test("defaults are applied when optional fields are left out", () => {
  const config = parseConfig(minimal());
  assert.equal(config.maxPagesPerSearch, 2);
  assert.equal(config.maxRequestsPerRun, 15);
  assert.deepEqual(config.delayMs, { min: 2000, max: 5000 });
  assert.equal(config.digestThreshold, 15);
  assert.equal(config.stateRetentionDays, 30);
  assert.deepEqual(config.includeTitleTerms, ["angular*"]);
  assert.deepEqual(config.conditionalTitleTerms, DEFAULT_CONFIG.conditionalTitleTerms);
  assert.deepEqual(config.descriptionRequiredTerms, ["angular*"]);
  assert.deepEqual(config.excludeTitleTerms, DEFAULT_CONFIG.excludeTitleTerms);
  assert.deepEqual(config.relocationPatterns, DEFAULT_CONFIG.relocationPatterns);
  assert.deepEqual(config.searches[0], {
    id: "angular-egypt",
    keywords: "Angular",
    geoId: "106155005",
    remoteOnly: false,
    experienceLevels: [4, 5],
    postedWithinSeconds: 86400,
  });
});

test("unknown top-level key is rejected with its path", () => {
  const raw = minimal();
  raw.serches = [];
  rejects(raw, "serches", /unknown key/);
});

test("unknown search key is rejected with its path", () => {
  const raw = { searches: [{ id: "a", keywords: "Angular", geoId: "1", remotOnly: true }] };
  rejects(raw, "searches[0].remotOnly", /unknown key/);
});

test("unknown delayMs key is rejected with its path", () => {
  rejects({ ...minimal(), delayMs: { min: 2000, max: 5000, avg: 3000 } }, "delayMs.avg", /unknown key/);
});

test("delayMs.min below 2000 is rejected", () => {
  rejects({ ...minimal(), delayMs: { min: 1000, max: 5000 } }, "delayMs.min");
});

test("delayMs.max below min is rejected", () => {
  rejects({ ...minimal(), delayMs: { min: 4000, max: 3000 } }, "delayMs.max");
});

test("duplicate search ids are rejected", () => {
  const raw = {
    searches: [
      { id: "x", keywords: "Angular", geoId: "1" },
      { id: "x", keywords: "Frontend", geoId: "1" },
    ],
  };
  rejects(raw, "searches[1].id", /duplicate id "x"/);
});

test("maxRequestsPerRun 31 is rejected", () => {
  rejects({ ...minimal(), maxRequestsPerRun: 31 }, "maxRequestsPerRun");
});

test("other range and type rules", () => {
  rejects({ ...minimal(), maxPagesPerSearch: 6 }, "maxPagesPerSearch");
  rejects({ ...minimal(), maxPagesPerSearch: 1.5 }, "maxPagesPerSearch");
  rejects({ searches: [] }, "searches");
  rejects({}, "searches");
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, keywords: "Angular", geoId: "1" }));
  rejects({ searches: nine }, "searches");
  rejects({ searches: [{ id: "a", keywords: "  ", geoId: "1" }] }, "searches[0].keywords");
  rejects({ searches: [{ id: "a", keywords: "Angular", geoId: 1 }] }, "searches[0].geoId");
  rejects({ searches: [{ id: "Not A Slug", keywords: "Angular", geoId: "1" }] }, "searches[0].id");
  rejects({ searches: [{ id: "a", keywords: "Angular", geoId: "1", experienceLevels: [4, 7] }] }, "searches[0].experienceLevels[1]");
  rejects({ ...minimal(), includeTitleTerms: [] }, "includeTitleTerms");
  rejects({ ...minimal(), excludeTitleTerms: ["php", ""] }, "excludeTitleTerms[1]");
});

test("invalid regex in relocationPatterns is rejected with the pattern named", () => {
  rejects({ ...minimal(), relocationPatterns: ["relocat", "(unclosed"] }, "relocationPatterns[1]", /\(unclosed/);
});

test("JSON syntax errors become ConfigError", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-config-"));
  const file = join(dir, "config.json");
  writeFileSync(file, "{ \"searches\": [ }");
  assert.throws(() => loadConfig(file), ConfigError);
});

test("adding \"engineer\" to excludeTitleTerms excludes \"Angular Engineer\"", () => {
  const base = parseConfig(minimal());
  assert.notEqual(classifyTitle("Angular Engineer", base), "exclude");
  const config = parseConfig({ ...minimal(), excludeTitleTerms: [...DEFAULT_CONFIG.excludeTitleTerms, "engineer"] });
  assert.equal(classifyTitle("Angular Engineer", config), "exclude");
});
