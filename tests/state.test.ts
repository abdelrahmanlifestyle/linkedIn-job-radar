import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, StateError } from "../src/state.ts";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString();

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(join(tmpdir(), "radar-state-"));
  file = join(dir, "seen.json");
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

async function writeJson(value: unknown): Promise<void> {
  await fsp.writeFile(file, JSON.stringify(value), "utf8");
}

describe("loadState", () => {
  test("missing file is a first run with empty seen", async () => {
    const s = await loadState(file, NOW, 30);
    assert.deepEqual(s, { firstRun: true, initializedAt: null, seen: {} });
  });

  test("file without initializedAt is a first run and keeps seen", async () => {
    await writeJson({ version: 1, seen: { "1": ago(1) } });
    const s = await loadState(file, NOW, 30);
    assert.equal(s.firstRun, true);
    assert.equal(s.initializedAt, null);
    assert.deepEqual(s.seen, { "1": ago(1) });
  });

  test("file with initializedAt is not a first run", async () => {
    await writeJson({ version: 1, initializedAt: ago(5), seen: { "1": ago(1) } });
    const s = await loadState(file, NOW, 30);
    assert.equal(s.firstRun, false);
    assert.equal(s.initializedAt, ago(5));
  });

  test("prunes entries older than retentionDays, keeps the boundary", async () => {
    await writeJson({
      version: 1,
      initializedAt: ago(100),
      seen: {
        fresh: ago(1),
        boundary: ago(30),
        justOld: new Date(NOW.getTime() - 30 * DAY - 1).toISOString(),
        old: ago(45),
      },
    });
    const s = await loadState(file, NOW, 30);
    assert.deepEqual(s.seen, { fresh: ago(1), boundary: ago(30) });
  });

  test("initializedAt with seen pruned to empty is not a first run", async () => {
    await writeJson({ version: 1, initializedAt: ago(90), seen: { "1": ago(60) } });
    const s = await loadState(file, NOW, 30);
    assert.equal(s.firstRun, false);
    assert.deepEqual(s.seen, {});
  });

  test("invalid JSON throws StateError and leaves file byte-for-byte unchanged", async () => {
    const bad = '{"version": 1, "seen": {\n';
    await fsp.writeFile(file, bad, "utf8");
    const before = await fsp.readFile(file);
    await assert.rejects(loadState(file, NOW, 30), StateError);
    assert.deepEqual(await fsp.readFile(file), before);
  });

  const badShapes: [string, unknown][] = [
    ["seen is an array", { version: 1, initializedAt: ago(1), seen: [] }],
    ["seen missing", { version: 1, initializedAt: ago(1) }],
    ["version is 2", { version: 2, initializedAt: ago(1), seen: {} }],
    ["version missing", { initializedAt: ago(1), seen: {} }],
    ["non-string seen timestamp", { version: 1, initializedAt: ago(1), seen: { "1": 12345 } }],
    ["unparseable seen timestamp", { version: 1, seen: { "1": "yesterday-ish" } }],
    ["non-string initializedAt", { version: 1, initializedAt: 5, seen: {} }],
    ["top-level array", []],
    ["top-level null", null],
  ];
  for (const [name, value] of badShapes) {
    test(`wrong shape (${name}) throws StateError without touching the file`, async () => {
      await writeJson(value);
      const before = await fsp.readFile(file);
      await assert.rejects(loadState(file, NOW, 30), StateError);
      assert.deepEqual(await fsp.readFile(file), before);
    });
  }
});

describe("saveState", () => {
  test("writes keys sorted by id with 2-space indentation and trailing newline", async () => {
    const init = "2026-09-29T10:00:12.345Z";
    const ok = await saveState(file, {
      version: 1,
      initializedAt: init,
      seen: { "4473235453": "2026-09-29T10:30:40.001Z", "4470095444": init, "12": init },
    });
    assert.equal(ok, true);
    const text = await fsp.readFile(file, "utf8");
    assert.equal(
      text,
      "{\n" +
        '  "version": 1,\n' +
        `  "initializedAt": "${init}",\n` +
        '  "seen": {\n' +
        `    "12": "${init}",\n` +
        `    "4470095444": "${init}",\n` +
        '    "4473235453": "2026-09-29T10:30:40.001Z"\n' +
        "  }\n" +
        "}\n",
    );
    assert.deepEqual(Object.keys(JSON.parse(text).seen), ["12", "4470095444", "4473235453"]);
  });

  test("writes through path.tmp then renames", async () => {
    const calls: string[] = [];
    const ok = await saveState(
      file,
      { version: 1, initializedAt: ago(0), seen: { "1": ago(0) } },
      {
        fs: {
          writeFile: async (p, d, e) => {
            calls.push(`write ${p}`);
            await fsp.writeFile(p, d, e);
          },
          rename: async (a, b) => {
            calls.push(`rename ${a} -> ${b}`);
            await fsp.rename(a, b);
          },
        },
      },
    );
    assert.equal(ok, true);
    assert.deepEqual(calls, [`write ${file}.tmp`, `rename ${file}.tmp -> ${file}`]);
    assert.deepEqual(await fsp.readdir(dir), ["seen.json"]);
  });

  test("no .tmp file remains after save", async () => {
    await saveState(file, { version: 1, seen: { "1": ago(0) } });
    const entries = await fsp.readdir(dir);
    assert.deepEqual(entries, ["seen.json"]);
  });

  test("returns false and does not write when content is unchanged", async () => {
    const state = { version: 1 as const, initializedAt: ago(2), seen: { b: ago(1), a: ago(1) } };
    assert.equal(await saveState(file, state), true);
    const mtimeBefore = (await fsp.stat(file)).mtimeMs;
    let wrote = false;
    const again = await saveState(
      file,
      { version: 1, initializedAt: ago(2), seen: { a: ago(1), b: ago(1) } },
      { fs: { writeFile: async () => { wrote = true; }, rename: async () => { wrote = true; } } },
    );
    assert.equal(again, false);
    assert.equal(wrote, false);
    assert.equal((await fsp.stat(file)).mtimeMs, mtimeBefore);
  });

  test("returns true when content changed", async () => {
    await saveState(file, { version: 1, initializedAt: ago(2), seen: { a: ago(1) } });
    assert.equal(await saveState(file, { version: 1, initializedAt: ago(2), seen: { a: ago(1), b: ago(0) } }), true);
    assert.deepEqual(Object.keys(JSON.parse(await fsp.readFile(file, "utf8")).seen), ["a", "b"]);
  });

  test("omits initializedAt when not set", async () => {
    await saveState(file, { version: 1, seen: {} });
    const text = await fsp.readFile(file, "utf8");
    assert.equal(text, '{\n  "version": 1,\n  "seen": {}\n}\n');
    assert.equal("initializedAt" in JSON.parse(text), false);
  });

  test("creates a missing parent folder", async () => {
    const nested = join(dir, "missing-dir", "seen.json");
    assert.equal(await saveState(nested, { version: 1, initializedAt: ago(0), seen: {} }), true);
    const loaded = await loadState(nested, NOW, 30);
    assert.equal(loaded.firstRun, false);
  });

  test("round-trips through loadState", async () => {
    const seen = { "4470095444": ago(3), "4473235453": ago(2) };
    await saveState(file, { version: 1, initializedAt: ago(10), seen });
    const s = await loadState(file, NOW, 30);
    assert.deepEqual(s, { firstRun: false, initializedAt: ago(10), seen });
  });
});
