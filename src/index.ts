import { pathToFileURL } from "node:url";
import { ConfigError, loadConfig } from "./config.ts";
import { createPoliteFetcher, RequestBudget } from "./linkedin.ts";
import { runRadar as realRunRadar } from "./radar.ts";
import type { RadarOptions, RadarDeps, RadarResult } from "./radar.ts";
import { loadState, saveState, StateError } from "./state.ts";
import { createSender as realCreateSender } from "./telegram.ts";
import type { Config, Fetcher, LoadedState, RunSummary, Sender } from "./types.ts";

export interface MainDeps {
  env: Record<string, string | undefined>;
  now: () => Date;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  runRadar: (opts: RadarOptions, deps: RadarDeps) => Promise<RadarResult>;
  createFetcher: (budget: RequestBudget, delayMs: { min: number; max: number }) => Fetcher;
  createSender: (token: string, chatId: string) => Sender;
}

export interface CliArgs {
  dryRun: boolean;
  configPath: string;
  statePath: string;
}

export class ArgsError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, configPath: "./config.json", statePath: "./data/seen.json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      args.dryRun = true;
    } else if (a === "--config" || a === "--state") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new ArgsError(`${a} needs a path value`);
      if (a === "--config") args.configPath = value;
      else args.statePath = value;
      i++;
    } else {
      throw new ArgsError(`unknown argument ${JSON.stringify(a)} (allowed: --dry-run, --config <path>, --state <path>)`);
    }
  }
  return args;
}

function defaultDeps(): MainDeps {
  return {
    env: process.env,
    now: () => new Date(),
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
    runRadar: realRunRadar,
    createFetcher: (budget, delayMs) => createPoliteFetcher(budget, delayMs),
    createSender: (token, chatId) => realCreateSender(token, chatId),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function formatSummary(summary: RunSummary): string {
  const lines = ["Run summary"];
  for (const s of summary.searches) {
    lines.push(`  ${s.id}: ${s.status}, ${s.pages} page(s), ${s.cards} card(s)`);
  }
  lines.push(`  requests used: ${summary.requestsUsed}`);
  lines.push(`  matched: ${summary.matched}`);
  lines.push(`  notified: ${summary.notified}`);
  lines.push(`  rejected: ${summary.rejected}`);
  lines.push(`  deferred: ${summary.deferred}`);
  return lines.join("\n") + "\n";
}

function formatDryRun(result: RadarResult): string {
  const lines = result.jobs.map((j) => `${j.id} | ${j.title} | ${j.company} | ${j.location} | ${j.decision}`);
  lines.push(`--- messages that would be sent (${result.messages.length}) ---`);
  let out = lines.join("\n") + "\n";
  if (result.messages.length > 0) out += result.messages.join("\n\n") + "\n";
  return out;
}

export async function main(argv: string[], deps: Partial<MainDeps> = {}): Promise<number> {
  const d: MainDeps = { ...defaultDeps(), ...deps };
  const error = (msg: string) => d.stderr(`ERROR ${msg}\n`);

  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    error(errorMessage(err));
    return 1;
  }

  let token = "";
  let chatId = "";
  if (!args.dryRun) {
    token = d.env.TELEGRAM_BOT_TOKEN ?? "";
    chatId = d.env.TELEGRAM_CHAT_ID ?? "";
    if (token.trim() === "") {
      error("TELEGRAM_BOT_TOKEN is not set (required unless --dry-run)");
      return 1;
    }
    if (chatId.trim() === "") {
      error("TELEGRAM_CHAT_ID is not set (required unless --dry-run)");
      return 1;
    }
  }
  const redact = (s: string) => (token ? s.split(token).join("***") : s);

  let config: Config;
  try {
    config = loadConfig(args.configPath);
  } catch (err) {
    error(err instanceof ConfigError ? err.message : `config: ${errorMessage(err)}`);
    return 1;
  }

  const now = d.now();
  let state: LoadedState;
  try {
    state = await loadState(args.statePath, now, config.stateRetentionDays);
  } catch (err) {
    error(err instanceof StateError ? err.message : `state: ${errorMessage(err)}`);
    return 1;
  }

  const budget = new RequestBudget(config.maxRequestsPerRun);
  const fetcher = d.createFetcher(budget, config.delayMs);
  const send: Sender = args.dryRun
    ? async () => {
        throw new Error("dry-run: sending is disabled");
      }
    : d.createSender(token, chatId);

  let result: RadarResult;
  try {
    result = await d.runRadar({ config, state, now, dryRun: args.dryRun }, { fetcher, budget, send });
  } catch (err) {
    error(redact(`run failed: ${errorMessage(err)}`));
    return 1;
  }

  let failed = false;

  if (args.dryRun) {
    d.stdout(redact(formatDryRun(result)));
  } else if (result.saveState) {
    const stamp = now.toISOString();
    const seen: Record<string, string> = { ...state.seen };
    for (const id of result.handledIds) {
      if (seen[id] === undefined) seen[id] = stamp;
    }
    const initializedAt = result.initializedAt ?? state.initializedAt ?? undefined;
    try {
      await saveState(args.statePath, { version: 1, initializedAt, seen });
    } catch (err) {
      error(`${args.statePath}: cannot save state: ${errorMessage(err)}`);
      failed = true;
    }
  }

  d.stdout(redact(formatSummary(result.summary)));
  for (const w of result.summary.warnings) d.stderr(redact(`WARN ${w}\n`));
  for (const e of result.summary.errors) d.stderr(redact(`ERROR ${e}\n`));

  if (result.summary.errors.length > 0) failed = true;
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`ERROR ${errorMessage(err)}\n`);
      process.exit(1);
    },
  );
}
