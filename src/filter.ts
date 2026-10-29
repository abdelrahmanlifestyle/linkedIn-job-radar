import type { Config, TitleClass } from "./types.ts";

const cache = new Map<string, RegExp>();

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
}

export function compileTerm(term: string): RegExp {
  const cached = cache.get(term);
  if (cached) return cached;
  let body = term.trim().toLowerCase();
  const prefix = body.endsWith("*");
  if (prefix) body = body.slice(0, -1);
  const source = body
    .split(/[\s-]+/)
    .filter((part) => part.length > 0)
    .map(escapeRegex)
    .join("[\\s-]+");
  const re = new RegExp(`(?<![a-z0-9])${source}${prefix ? "" : "(?![a-z0-9])"}`, "i");
  cache.set(term, re);
  return re;
}

export function matchTerm(term: string, text: string): boolean {
  return compileTerm(term).test(text);
}

function matchesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => matchTerm(term, text));
}

export function classifyTitle(
  title: string,
  config: Pick<Config, "includeTitleTerms" | "conditionalTitleTerms" | "excludeTitleTerms">,
): TitleClass {
  if (matchesAny(title, config.excludeTitleTerms)) return "exclude";
  if (matchesAny(title, config.includeTitleTerms)) return "include";
  if (matchesAny(title, config.conditionalTitleTerms)) return "conditional";
  return "none";
}

export function descriptionMatches(text: string, terms: string[]): boolean {
  return matchesAny(text, terms);
}

export function needsDescription(job: { worldwideRemote: boolean }, cls: TitleClass): boolean {
  return cls === "conditional" || (cls === "include" && job.worldwideRemote);
}

export function compileRelocationPatterns(sources: string[]): RegExp[] {
  return sources.map((src) => new RegExp(src, "i"));
}

export function hasRelocationWarning(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}
