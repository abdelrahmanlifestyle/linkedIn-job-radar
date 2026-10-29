import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  classifyTitle,
  compileRelocationPatterns,
  compileTerm,
  descriptionMatches,
  hasRelocationWarning,
  matchTerm,
  needsDescription,
} from "../src/filter.ts";
import type { Config } from "../src/types.ts";

const configUrl = new URL("../config.json", import.meta.url);
const config = JSON.parse(readFileSync(configUrl, "utf8")) as Config;

test("intern does not match International or Internal", () => {
  assert.equal(matchTerm("intern", "International Angular Lead"), false);
  assert.equal(matchTerm("intern", "Internal Tools"), false);
  assert.equal(matchTerm("intern", "Software Intern"), true);
});

test("front end matches Front-End Developer", () => {
  assert.equal(matchTerm("front end", "Front-End Developer"), true);
  assert.equal(matchTerm("front end", "Front End Developer"), true);
  assert.equal(matchTerm("front-end", "Front End Developer"), true);
  assert.equal(matchTerm("front-end", "Front-End Developer"), true);
});

test("angular* matches as a prefix", () => {
  assert.equal(matchTerm("angular*", "AngularJS Developer"), true);
  assert.equal(matchTerm("angular*", "Angular2+ Engineer"), true);
  assert.equal(matchTerm("angular*", "Senior Angular Developer"), true);
  assert.equal(matchTerm("angular*", "Rectangular Widgets"), false);
});

test(".net developer matches and escapes regex specials", () => {
  assert.equal(matchTerm(".net developer", "Senior .NET Developer"), true);
  assert.equal(matchTerm(".net developer", "Senior anet developer"), false);
  assert.equal(compileTerm(".net developer").test("xnet developer"), false);
});

test("web developer matches Web-Developer", () => {
  assert.equal(matchTerm("web developer", "Senior Web-Developer"), true);
});

test("matching is case-insensitive", () => {
  assert.equal(matchTerm("PHP", "senior php engineer"), true);
  assert.equal(matchTerm("php", "Senior PHP Engineer"), true);
  assert.equal(compileTerm("junior").flags.includes("i"), true);
});

test("compileTerm caches compiled regexes", () => {
  assert.equal(compileTerm("frontend"), compileTerm("frontend"));
});

test("classifyTitle uses real config terms with precedence", () => {
  assert.equal(classifyTitle("Senior Angular Developer", config), "include");
  assert.equal(classifyTitle("Junior Angular Developer", config), "exclude");
  assert.equal(classifyTitle("Frontend Engineer", config), "conditional");
  assert.equal(classifyTitle("Corporate Lawyer", config), "none");
  assert.equal(classifyTitle("International Angular Lead", config), "include");
  assert.equal(classifyTitle("Front-End Developer (PHP)", config), "exclude");
});

test("descriptionMatches", () => {
  const terms = config.descriptionRequiredTerms;
  assert.equal(descriptionMatches("We build apps with Angular and RxJS.", terms), true);
  assert.equal(descriptionMatches("We build apps with React and Redux.", terms), false);
});

test("needsDescription truth table", () => {
  assert.equal(needsDescription({ worldwideRemote: false }, "conditional"), true);
  assert.equal(needsDescription({ worldwideRemote: true }, "conditional"), true);
  assert.equal(needsDescription({ worldwideRemote: true }, "include"), true);
  assert.equal(needsDescription({ worldwideRemote: false }, "include"), false);
  assert.equal(needsDescription({ worldwideRemote: true }, "none"), false);
  assert.equal(needsDescription({ worldwideRemote: true }, "exclude"), false);
  assert.equal(needsDescription({ worldwideRemote: false }, "none"), false);
  assert.equal(needsDescription({ worldwideRemote: false }, "exclude"), false);
});

const relocation = compileRelocationPatterns(config.relocationPatterns);

test("compileRelocationPatterns builds case-insensitive regexes", () => {
  assert.equal(relocation.length, config.relocationPatterns.length);
  for (const re of relocation) assert.equal(re.flags.includes("i"), true);
});

test("hasRelocationWarning flags location restrictions", () => {
  for (const text of [
    "Candidates must be located in the US",
    "relocation package provided",
    "US-based only",
    "must be based in the UK",
    "located in the United States",
  ]) {
    assert.equal(hasRelocationWarning(text, relocation), true, text);
  }
});

test("hasRelocationWarning ignores unrestricted text", () => {
  assert.equal(hasRelocationWarning("fully remote, work from anywhere", relocation), false);
  assert.equal(hasRelocationWarning("We use Angular and RxJS", relocation), false);
});

const relocationFixture = new URL("./fixtures/job-posting-relocation.html", import.meta.url);

test("hasRelocationWarning on job-posting-relocation.html", { skip: !existsSync(relocationFixture) }, () => {
  const html = readFileSync(relocationFixture, "utf8");
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.equal(hasRelocationWarning(text, relocation), true);
  assert.equal(descriptionMatches(text, config.descriptionRequiredTerms), true);
});
