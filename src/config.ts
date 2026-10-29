import { readFileSync } from "node:fs";
import type { Config, Search } from "./types.ts";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const DEFAULT_CONFIG: Omit<Config, "searches"> = {
  maxPagesPerSearch: 2,
  maxRequestsPerRun: 15,
  delayMs: { min: 2000, max: 5000 },
  digestThreshold: 15,
  stateRetentionDays: 30,
  includeTitleTerms: ["angular*"],
  conditionalTitleTerms: ["front-end", "frontend", "front end", "ui engineer", "web developer"],
  descriptionRequiredTerms: ["angular*"],
  excludeTitleTerms: ["junior", "intern", "internship", "trainee", "react only", "php", "wordpress", ".net developer"],
  relocationPatterns: [
    "relocat",
    "must (?:be )?(?:located|based|resid\\w*) in",
    "(?:located|based) in the (?:us|usa|uk|eu|united states|united kingdom|european union)\\b",
    "\\b(?:us|uk|eu)[- ]based (?:only|candidates)",
    "only (?:open to|accepting) (?:candidates|applicants) (?:from|in)",
  ],
};

const DEFAULT_SEARCH = {
  remoteOnly: false,
  experienceLevels: [4, 5],
  postedWithinSeconds: 86400,
};

const TOP_KEYS = [
  "maxPagesPerSearch",
  "maxRequestsPerRun",
  "delayMs",
  "digestThreshold",
  "stateRetentionDays",
  "searches",
  "includeTitleTerms",
  "conditionalTitleTerms",
  "descriptionRequiredTerms",
  "excludeTitleTerms",
  "relocationPatterns",
];
const DELAY_KEYS = ["min", "max"];
const SEARCH_KEYS = ["id", "keywords", "geoId", "remoteOnly", "experienceLevels", "postedWithinSeconds"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Obj = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new ConfigError(`${path}: ${message}`);
}

function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "string") return JSON.stringify(v);
  return String(typeof v === "object" ? "an object" : v);
}

function objectAt(v: unknown, path: string, allowed: string[]): Obj {
  if (!isObject(v)) fail(path, `must be an object, got ${describe(v)}`);
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) {
      const at = path ? `${path}.${key}` : key;
      fail(at, `unknown key "${key}" (allowed keys: ${allowed.join(", ")})`);
    }
  }
  return v;
}

function int(v: unknown, path: string, def: number | undefined, min?: number, max?: number): number {
  if (v === undefined) {
    if (def === undefined) fail(path, "is required");
    return def;
  }
  if (typeof v !== "number" || !Number.isInteger(v)) fail(path, `must be a whole number, got ${describe(v)}`);
  if (min !== undefined && v < min) {
    fail(path, max !== undefined ? `must be between ${min} and ${max}, got ${v}` : `must be at least ${min}, got ${v}`);
  }
  if (max !== undefined && v > max) {
    fail(path, min !== undefined ? `must be between ${min} and ${max}, got ${v}` : `must be at most ${max}, got ${v}`);
  }
  return v;
}

function nonEmptyString(v: unknown, path: string): string {
  if (typeof v !== "string") fail(path, `must be a text value, got ${describe(v)}`);
  if (v.trim() === "") fail(path, "must not be empty");
  return v;
}

function stringList(v: unknown, path: string, def: string[], minEntries = 0): string[] {
  if (v === undefined) return [...def];
  if (!Array.isArray(v)) fail(path, `must be a list of text values, got ${describe(v)}`);
  if (v.length < minEntries) fail(path, `must have at least ${minEntries} entr${minEntries === 1 ? "y" : "ies"}`);
  return v.map((item, i) => nonEmptyString(item, `${path}[${i}]`));
}

function parseSearch(v: unknown, path: string): Search {
  const o = objectAt(v, path, SEARCH_KEYS);
  const id = nonEmptyString(o.id, `${path}.id`);
  if (!SLUG.test(id)) {
    fail(`${path}.id`, `must be a slug of lowercase letters, digits and dashes (e.g. "angular-egypt"), got ${JSON.stringify(id)}`);
  }
  const keywords = nonEmptyString(o.keywords, `${path}.keywords`);
  const geoId = nonEmptyString(o.geoId, `${path}.geoId`);
  let remoteOnly = DEFAULT_SEARCH.remoteOnly;
  if (o.remoteOnly !== undefined) {
    if (typeof o.remoteOnly !== "boolean") fail(`${path}.remoteOnly`, `must be true or false, got ${describe(o.remoteOnly)}`);
    remoteOnly = o.remoteOnly;
  }
  let experienceLevels = [...DEFAULT_SEARCH.experienceLevels];
  if (o.experienceLevels !== undefined) {
    const levels = o.experienceLevels;
    if (!Array.isArray(levels)) fail(`${path}.experienceLevels`, `must be a list of numbers from 1 to 6, got ${describe(levels)}`);
    experienceLevels = levels.map((lv, i) => int(lv, `${path}.experienceLevels[${i}]`, undefined, 1, 6));
  }
  const postedWithinSeconds = int(o.postedWithinSeconds, `${path}.postedWithinSeconds`, DEFAULT_SEARCH.postedWithinSeconds, 1);
  return { id, keywords, geoId, remoteOnly, experienceLevels, postedWithinSeconds };
}

export function parseConfig(raw: unknown): Config {
  if (!isObject(raw)) throw new ConfigError(`config: must be a JSON object, got ${describe(raw)}`);
  const o = objectAt(raw, "", TOP_KEYS);

  const maxPagesPerSearch = int(o.maxPagesPerSearch, "maxPagesPerSearch", DEFAULT_CONFIG.maxPagesPerSearch, 1, 5);
  const maxRequestsPerRun = int(o.maxRequestsPerRun, "maxRequestsPerRun", DEFAULT_CONFIG.maxRequestsPerRun, 1, 30);

  let delayMs = { ...DEFAULT_CONFIG.delayMs };
  if (o.delayMs !== undefined) {
    const d = objectAt(o.delayMs, "delayMs", DELAY_KEYS);
    const min = int(d.min, "delayMs.min", DEFAULT_CONFIG.delayMs.min, 2000);
    const max = int(d.max, "delayMs.max", Math.max(min, DEFAULT_CONFIG.delayMs.max));
    if (max < min) fail("delayMs.max", `must be at least delayMs.min (${min}), got ${max}`);
    delayMs = { min, max };
  }

  const digestThreshold = int(o.digestThreshold, "digestThreshold", DEFAULT_CONFIG.digestThreshold, 0);
  const stateRetentionDays = int(o.stateRetentionDays, "stateRetentionDays", DEFAULT_CONFIG.stateRetentionDays, 1);

  if (o.searches === undefined) fail("searches", "is required (1 to 8 searches)");
  if (!Array.isArray(o.searches)) fail("searches", `must be a list of searches, got ${describe(o.searches)}`);
  if (o.searches.length < 1 || o.searches.length > 8) {
    fail("searches", `must have 1 to 8 entries, got ${o.searches.length}`);
  }
  const searches: Search[] = [];
  const seen = new Set<string>();
  o.searches.forEach((s, i) => {
    const search = parseSearch(s, `searches[${i}]`);
    if (seen.has(search.id)) fail(`searches[${i}].id`, `duplicate id "${search.id}" (each search needs its own id)`);
    seen.add(search.id);
    searches.push(search);
  });

  const includeTitleTerms = stringList(o.includeTitleTerms, "includeTitleTerms", DEFAULT_CONFIG.includeTitleTerms, 1);
  const conditionalTitleTerms = stringList(o.conditionalTitleTerms, "conditionalTitleTerms", DEFAULT_CONFIG.conditionalTitleTerms);
  const descriptionRequiredTerms = stringList(o.descriptionRequiredTerms, "descriptionRequiredTerms", DEFAULT_CONFIG.descriptionRequiredTerms);
  const excludeTitleTerms = stringList(o.excludeTitleTerms, "excludeTitleTerms", DEFAULT_CONFIG.excludeTitleTerms);
  const relocationPatterns = stringList(o.relocationPatterns, "relocationPatterns", DEFAULT_CONFIG.relocationPatterns);
  relocationPatterns.forEach((src, i) => {
    try {
      new RegExp(src, "i");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fail(`relocationPatterns[${i}]`, `${JSON.stringify(src)} is not a valid regular expression (${reason})`);
    }
  });

  return {
    maxPagesPerSearch,
    maxRequestsPerRun,
    delayMs,
    digestThreshold,
    stateRetentionDays,
    searches,
    includeTitleTerms,
    conditionalTitleTerms,
    descriptionRequiredTerms,
    excludeTitleTerms,
    relocationPatterns,
  };
}

export function loadConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`config: cannot read ${path} (${reason})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`config: ${path} is not valid JSON (${reason})`);
  }
  return parseConfig(raw);
}
