// Shared types. See specs/001-linkedin-job-radar/data-model.md.

export type WorkType = "Remote" | "Hybrid" | "On-site";

export type Decision = "SKIPPED_SEEN" | "REJECTED" | "MATCHED" | "DEFERRED" | "NOTIFIED";

export type TitleClass = "exclude" | "include" | "conditional" | "none";

export type SearchStatus = "ok" | "skipped" | "parse_error";

export interface Search {
  id: string;
  keywords: string;
  geoId: string;
  remoteOnly: boolean;
  experienceLevels: number[];
  postedWithinSeconds: number;
}

export interface Config {
  maxPagesPerSearch: number;
  maxRequestsPerRun: number;
  delayMs: { min: number; max: number };
  digestThreshold: number;
  stateRetentionDays: number;
  searches: Search[];
  includeTitleTerms: string[];
  conditionalTitleTerms: string[];
  descriptionRequiredTerms: string[];
  excludeTitleTerms: string[];
  relocationPatterns: string[];
}

/** One job as read from a search result card. */
export interface JobCard {
  id: string;
  title: string;
  company: string;
  location: string;
  postedDate: string | null;
  postedAgo: string;
  link: string;
}

/** A job after merging cards from all searches, enriched during the run. */
export interface JobPosting extends JobCard {
  workType: WorkType | null;
  sources: string[];
  worldwideRemote: boolean;
  description: string | null;
  relocationWarning: boolean;
  decision: Decision;
}

/** On-disk format of data/seen.json. */
export interface SeenState {
  version: 1;
  initializedAt?: string;
  seen: Record<string, string>;
}

/** SeenState after loading and pruning. */
export interface LoadedState {
  firstRun: boolean;
  initializedAt: string | null;
  seen: Record<string, string>;
}

export interface SearchSummary {
  id: string;
  pages: number;
  cards: number;
  status: SearchStatus;
}

export interface RunSummary {
  searches: SearchSummary[];
  requestsUsed: number;
  matched: number;
  notified: number;
  rejected: number;
  deferred: number;
  errors: string[];
  warnings: string[];
}

export type FetchResult =
  | { status: "ok"; html: string }
  | { status: "rate_limited" }
  | { status: "budget_exhausted" }
  | { status: "error"; error: string };

/** Fetches one LinkedIn URL politely (delay, budget, backoff). */
export type Fetcher = (url: string) => Promise<FetchResult>;

/** Sends one Telegram HTML message; resolves true on success. */
export type Sender = (html: string) => Promise<boolean>;

export type Sleep = (ms: number) => Promise<void>;
