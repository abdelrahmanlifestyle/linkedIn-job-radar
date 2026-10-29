import type { JobPosting, Sender, Sleep } from "./types.ts";

export const TELEGRAM_MAX_LENGTH = 4096;

const CONT_PREFIX = "(cont.)\n";
const RELOCATION_NOTE = "  ⚠️ mentions relocation / location restriction";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatJob(job: JobPosting): string {
  let locationLine = `🏢 ${escapeHtml(job.company)} · 📍 ${escapeHtml(job.location)}`;
  if (job.workType && !job.location.toLowerCase().includes(job.workType.toLowerCase())) {
    locationLine += ` (${job.workType})`;
  }
  let postedLine = `🕒 posted ${escapeHtml(job.postedAgo)}`;
  if (job.relocationWarning) postedLine += RELOCATION_NOTE;
  return [
    `🅰️ <b>${escapeHtml(job.title)}</b>`,
    locationLine,
    postedLine,
    `🔗 ${escapeHtml(job.link)}`,
  ].join("\n");
}

function digestLine(job: JobPosting): string {
  const line =
    `• <a href="${escapeHtml(job.link).replace(/"/g, "&quot;")}">${escapeHtml(job.title)}</a>` +
    ` — ${escapeHtml(job.company)} · ${escapeHtml(job.location)}`;
  return job.relocationWarning ? `${line} ⚠️` : line;
}

export function formatDigest(jobs: JobPosting[]): string[] {
  const lines = [`🅰️ <b>${jobs.length} new Angular jobs</b>`, ...jobs.map(digestLine)];
  const chunks: string[] = [];
  let current = lines[0];
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.slice(0, TELEGRAM_MAX_LENGTH - CONT_PREFIX.length);
    if (current.length + 1 + line.length <= TELEGRAM_MAX_LENGTH) {
      current += "\n" + line;
    } else {
      chunks.push(current);
      current = CONT_PREFIX + line;
    }
  }
  chunks.push(current);
  return chunks;
}

export function formatStartup(n: number): string {
  return `📡 <b>Radar started</b> — ${n} jobs currently open. You'll get alerts for new ones from now on.`;
}

export interface TelegramDeps {
  fetch: typeof fetch;
  sleep: Sleep;
}

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendMessage(
  token: string,
  chatId: string,
  html: string,
  deps: Partial<TelegramDeps> = {},
): Promise<boolean> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch {
      return false;
    }
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok && data?.ok === true) return true;
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Number(data?.parameters?.retry_after);
      const seconds = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 1;
      await sleep(seconds * 1000);
      continue;
    }
    return false;
  }
  return false;
}

export function createSender(token: string, chatId: string, deps: Partial<TelegramDeps> = {}): Sender {
  return (html) => sendMessage(token, chatId, html, deps);
}

export async function sendPaced(
  messages: string[],
  send: Sender,
  deps: { sleep?: Sleep; intervalMs?: number } = {},
): Promise<boolean[]> {
  const sleep = deps.sleep ?? defaultSleep;
  const intervalMs = deps.intervalMs ?? 1100;
  const results: boolean[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) await sleep(intervalMs);
    let ok = false;
    try {
      ok = await send(messages[i]);
    } catch {
      ok = false;
    }
    results.push(ok);
  }
  return results;
}
