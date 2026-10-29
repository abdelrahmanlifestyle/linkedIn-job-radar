import * as fsp from "node:fs/promises";
import { dirname } from "node:path";
import type { LoadedState, SeenState } from "./types.ts";

export class StateError extends Error {}

export interface StateFs {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  writeFile: (path: string, data: string, encoding: "utf8") => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  mkdir: (path: string, opts: { recursive: true }) => Promise<unknown>;
}

const defaultFs: StateFs = {
  readFile: (p, enc) => fsp.readFile(p, enc),
  writeFile: (p, d, enc) => fsp.writeFile(p, d, enc),
  rename: (a, b) => fsp.rename(a, b),
  mkdir: (p, o) => fsp.mkdir(p, o),
};

const DAY_MS = 24 * 60 * 60 * 1000;

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}

function isTimestamp(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

export async function loadState(
  path: string,
  now: Date,
  retentionDays: number,
  deps: { fs?: Partial<StateFs> } = {},
): Promise<LoadedState> {
  const fs = { ...defaultFs, ...deps.fs };
  let text: string;
  try {
    text = await fs.readFile(path, "utf8");
  } catch (err) {
    if (isEnoent(err)) return { firstRun: true, initializedAt: null, seen: {} };
    throw new StateError(`${path}: cannot read state file: ${(err as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new StateError(`${path}: invalid JSON: ${(err as Error).message}`);
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StateError(`${path}: state must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) throw new StateError(`${path}: version must be 1`);
  if (obj.initializedAt !== undefined && !isTimestamp(obj.initializedAt)) {
    throw new StateError(`${path}: initializedAt must be an ISO datetime string`);
  }
  const seenRaw = obj.seen;
  if (typeof seenRaw !== "object" || seenRaw === null || Array.isArray(seenRaw)) {
    throw new StateError(`${path}: seen must be an object`);
  }

  const cutoff = now.getTime() - retentionDays * DAY_MS;
  const seen: Record<string, string> = {};
  for (const [id, ts] of Object.entries(seenRaw as Record<string, unknown>)) {
    if (!isTimestamp(ts)) throw new StateError(`${path}: seen["${id}"] must be an ISO datetime string`);
    if (Date.parse(ts) >= cutoff) seen[id] = ts;
  }

  const initializedAt = (obj.initializedAt as string | undefined) ?? null;
  return { firstRun: initializedAt === null, initializedAt, seen };
}

function compareIds(a: string, b: string): number {
  const digits = /^\d+$/;
  if (digits.test(a) && digits.test(b) && a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Built by hand because JS objects reorder integer-like keys, which would break the sort.
export function serializeState(state: SeenState): string {
  const lines = ['  "version": 1'];
  if (state.initializedAt !== undefined) lines.push(`  "initializedAt": ${JSON.stringify(state.initializedAt)}`);
  const ids = Object.keys(state.seen).sort(compareIds);
  if (ids.length === 0) {
    lines.push('  "seen": {}');
  } else {
    const entries = ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(state.seen[id])}`);
    lines.push(`  "seen": {\n${entries.join(",\n")}\n  }`);
  }
  return `{\n${lines.join(",\n")}\n}\n`;
}

export async function saveState(
  path: string,
  state: SeenState,
  deps: { fs?: Partial<StateFs> } = {},
): Promise<boolean> {
  const fs = { ...defaultFs, ...deps.fs };
  const content = serializeState(state);
  await fs.mkdir(dirname(path), { recursive: true });
  try {
    if ((await fs.readFile(path, "utf8")) === content) return false;
  } catch (err) {
    if (!isEnoent(err)) throw err;
  }
  const tmp = path + ".tmp";
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, path);
  return true;
}
