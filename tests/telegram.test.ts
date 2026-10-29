import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  TELEGRAM_MAX_LENGTH,
  escapeHtml,
  formatJob,
  formatDigest,
  formatStartup,
  sendMessage,
  createSender,
  sendPaced,
} from "../src/telegram.ts";
import type { JobPosting } from "../src/types.ts";

function job(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "4473271098",
    title: "Senior Angular Developer",
    company: "Acme",
    location: "Cairo, Egypt",
    postedDate: "2026-09-29",
    postedAgo: "12 minutes ago",
    link: "https://www.linkedin.com/jobs/view/4473271098",
    workType: "Hybrid",
    sources: ["s1"],
    worldwideRemote: false,
    description: null,
    relocationWarning: false,
    decision: "MATCHED",
    ...overrides,
  };
}

describe("escapeHtml", () => {
  test("escapes & < > only", () => {
    assert.equal(escapeHtml(`a & <b> "c" 'd'`), `a &amp; &lt;b&gt; "c" 'd'`);
  });
});

describe("formatJob", () => {
  test("hybrid job matches the contract exactly", () => {
    assert.equal(
      formatJob(job()),
      [
        "🅰️ <b>Senior Angular Developer</b>",
        "🏢 Acme · 📍 Cairo, Egypt (Hybrid)",
        "🕒 posted 12 minutes ago",
        "🔗 https://www.linkedin.com/jobs/view/4473271098",
      ].join("\n"),
    );
  });

  test("workType null -> no parentheses", () => {
    const lines = formatJob(job({ workType: null })).split("\n");
    assert.equal(lines[1], "🏢 Acme · 📍 Cairo, Egypt");
  });

  test("workType already in location is not duplicated", () => {
    const lines = formatJob(job({ workType: "Remote", location: "Egypt (Remote)" })).split("\n");
    assert.equal(lines[1], "🏢 Acme · 📍 Egypt (Remote)");
  });

  test("relocation warning appended to the posted line", () => {
    const lines = formatJob(job({ relocationWarning: true })).split("\n");
    assert.equal(lines[2], "🕒 posted 12 minutes ago  ⚠️ mentions relocation / location restriction");
    assert.ok(lines[2].endsWith("  ⚠️ mentions relocation / location restriction"));
  });

  test("escapes HTML in title, company, location and postedAgo", () => {
    const out = formatJob(
      job({
        title: "Angular <Dev> & Co",
        company: "A&B <Corp>",
        location: "Cairo <Egypt> & more",
        postedAgo: "<1 hour & ago>",
        workType: null,
      }),
    );
    assert.equal(
      out,
      [
        "🅰️ <b>Angular &lt;Dev&gt; &amp; Co</b>",
        "🏢 A&amp;B &lt;Corp&gt; · 📍 Cairo &lt;Egypt&gt; &amp; more",
        "🕒 posted &lt;1 hour &amp; ago&gt;",
        "🔗 https://www.linkedin.com/jobs/view/4473271098",
      ].join("\n"),
    );
  });
});

describe("formatStartup", () => {
  test("matches contract text", () => {
    assert.equal(
      formatStartup(7),
      "📡 <b>Radar started</b> — 7 jobs currently open. You'll get alerts for new ones from now on.",
    );
  });
});

describe("formatDigest", () => {
  test("header and one line per job", () => {
    const chunks = formatDigest([
      job({ id: "1", link: "https://www.linkedin.com/jobs/view/1", title: "Angular Dev" }),
      job({ id: "2", link: "https://www.linkedin.com/jobs/view/2", title: "Angular Lead", relocationWarning: true }),
    ]);
    assert.deepEqual(chunks, [
      [
        "🅰️ <b>2 new Angular jobs</b>",
        '• <a href="https://www.linkedin.com/jobs/view/1">Angular Dev</a> — Acme · Cairo, Egypt',
        '• <a href="https://www.linkedin.com/jobs/view/2">Angular Lead</a> — Acme · Cairo, Egypt ⚠️',
      ].join("\n"),
    ]);
  });

  test("escapes values", () => {
    const [chunk] = formatDigest([job({ title: "A <b> & c", company: "X&Y", location: "<Here>" })]);
    assert.equal(
      chunk.split("\n")[1],
      '• <a href="https://www.linkedin.com/jobs/view/4473271098">A &lt;b&gt; &amp; c</a> — X&amp;Y · &lt;Here&gt;',
    );
  });

  test("splits long digests at line boundaries without losing lines", () => {
    const jobs = Array.from({ length: 200 }, (_, i) =>
      job({
        id: String(i),
        link: `https://www.linkedin.com/jobs/view/${i}`,
        title: `Senior Angular Developer number ${i} ${"x".repeat(40)}`,
        company: `Company ${i}`,
        location: "Somewhere Far Away, Some Country",
      }),
    );
    const chunks = formatDigest(jobs);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= TELEGRAM_MAX_LENGTH, `chunk length ${c.length}`);
    assert.ok(chunks[0].startsWith("🅰️ <b>200 new Angular jobs</b>\n"));
    for (const c of chunks.slice(1)) assert.ok(c.startsWith("(cont.)\n"));

    const jobLines = chunks.flatMap((c) => c.split("\n")).filter((l) => l.startsWith("• "));
    assert.equal(jobLines.length, 200);
    for (let i = 0; i < 200; i++) {
      assert.ok(jobLines[i].includes(`href="https://www.linkedin.com/jobs/view/${i}"`), `line ${i}`);
      assert.ok(jobLines[i].endsWith("· Somewhere Far Away, Some Country"), `line ${i} intact`);
    }
    const allLines = chunks.flatMap((c) => c.split("\n"));
    assert.equal(allLines.filter((l) => l === "(cont.)").length, chunks.length - 1);
    assert.equal(allLines.length, 1 + 200 + (chunks.length - 1));
  });
});

interface Call {
  url: string;
  init: RequestInit;
}

function stubFetch(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

function stubSleep() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}

const TOKEN = "123456:SECRET-TOKEN-abc";

describe("sendMessage", () => {
  const logged: string[] = [];
  const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const capture = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  console.info = capture;

  afterEach(() => {
    for (const line of logged) assert.ok(!line.includes(TOKEN), "token must never be logged");
  });

  test("posts the contract body and returns true on ok", async () => {
    const { fn, calls } = stubFetch([{ status: 200, body: { ok: true, result: {} } }]);
    const { sleep, sleeps } = stubSleep();
    const ok = await sendMessage(TOKEN, "42", "<b>hi</b>", { fetch: fn, sleep });
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
    assert.equal(calls[0].init.method, "POST");
    const headers = new Headers(calls[0].init.headers);
    assert.equal(headers.get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      chat_id: "42",
      text: "<b>hi</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    assert.deepEqual(sleeps, []);
  });

  test("429 waits retry_after once and retries successfully", async () => {
    const { fn, calls } = stubFetch([
      { status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 3 } } },
      { status: 200, body: { ok: true } },
    ]);
    const { sleep, sleeps } = stubSleep();
    assert.equal(await sendMessage(TOKEN, "42", "x", { fetch: fn, sleep }), true);
    assert.deepEqual(sleeps, [3000]);
    assert.equal(calls.length, 2);
  });

  test("second 429 returns false", async () => {
    const r429 = { status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 3 } } };
    const { fn, calls } = stubFetch([r429, r429, r429]);
    const { sleep, sleeps } = stubSleep();
    assert.equal(await sendMessage(TOKEN, "42", "x", { fetch: fn, sleep }), false);
    assert.deepEqual(sleeps, [3000]);
    assert.equal(calls.length, 2);
  });

  test("other failure returns false without retry", async () => {
    const { fn, calls } = stubFetch([{ status: 400, body: { ok: false, description: "Bad Request" } }]);
    const { sleep, sleeps } = stubSleep();
    assert.equal(await sendMessage(TOKEN, "42", "x", { fetch: fn, sleep }), false);
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });

  test("thrown fetch returns false", async () => {
    const { fn } = stubFetch([new Error(`network down for https://api.telegram.org/bot${TOKEN}`)]);
    const { sleep } = stubSleep();
    assert.equal(await sendMessage(TOKEN, "42", "x", { fetch: fn, sleep }), false);
  });

  test("createSender binds token and chat id", async () => {
    const { fn, calls } = stubFetch([{ status: 200, body: { ok: true } }]);
    const send = createSender(TOKEN, "99", { fetch: fn, sleep: async () => {} });
    assert.equal(await send("hello"), true);
    assert.equal(JSON.parse(String(calls[0].init.body)).chat_id, "99");
  });

  test("restore console", () => {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    console.info = originals.info;
    for (const line of logged) assert.ok(!line.includes(TOKEN));
  });
});

describe("sendPaced", () => {
  test("sleeps >= 1100 ms between sends, not before the first; continues after failure", async () => {
    const events: string[] = [];
    const sleep = async (ms: number) => {
      assert.ok(ms >= 1100);
      events.push(`sleep ${ms}`);
    };
    const send = async (html: string) => {
      events.push(`send ${html}`);
      return html !== "b";
    };
    const results = await sendPaced(["a", "b", "c"], send, { sleep });
    assert.deepEqual(results, [true, false, true]);
    assert.deepEqual(events, ["send a", "sleep 1100", "send b", "sleep 1100", "send c"]);
  });

  test("empty list sends nothing", async () => {
    const { sleep, sleeps } = stubSleep();
    assert.deepEqual(await sendPaced([], async () => true, { sleep }), []);
    assert.deepEqual(sleeps, []);
  });
});
