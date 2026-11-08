import { open, readdir } from "node:fs/promises";
import { join } from "node:path";

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** First user message as the session label: collapsed whitespace, capped length. */
export function clipTitle(text: unknown): string {
  if (typeof text !== "string") return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const chars = [...clean];
  return chars.length > 60 ? `${chars.slice(0, 60).join("")}…` : clean;
}

/** Rollout/system-injected text that must never become the session label. */
export const MACHINE_LABEL = /^(# AGENTS\.md|<environment_context|<user_instructions|<permissions|<chat-history-summary|<paseo-system|<paseo-agent|this session is being continued|caveat: the messages below)/i;

/** Pulls the first text out of a message `content` (string or block array).
 *  Covers both `type:"text"` (claude/pi) and `type:"input_text"` (codex). */
export function firstMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
      const kind = (block as { type?: unknown }).type;
      if (kind === "text" || kind === "input_text") return (block as { text: string }).text;
    }
  }
  return "";
}

export function localDateKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function localHourKey(ms: number): string {
  const date = new Date(ms);
  return `${localDateKey(ms)}T${String(date.getHours()).padStart(2, "0")}`;
}

export async function listJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.pop() as string;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(join(dir, entry.name));
      else if (entry.name.endsWith(".jsonl")) files.push(join(dir, entry.name));
    }
  }
  return files;
}

export interface FileReadResult {
  offset: number;
  size: number;
  mtimeMs: number;
}

const CHUNK = 4 * 1024 * 1024;

/**
 * Reads complete lines appended after `fromOffset`. The returned offset stops
 * at the last newline, so a partial trailing line is read again next time.
 */
export async function forEachNewLine(
  path: string,
  fromOffset: number,
  onLine: (line: string) => void,
): Promise<FileReadResult | null> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return null;
    let pos = fromOffset > info.size ? 0 : fromOffset;
    let carry = Buffer.alloc(0);
    const buffer = Buffer.allocUnsafe(CHUNK);
    while (pos < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, info.size - pos), pos);
      if (bytesRead <= 0) break;
      pos += bytesRead;
      const view = carry.length > 0 ? Buffer.concat([carry, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      let start = 0;
      let newline = -1;
      while ((newline = view.indexOf(10, start)) !== -1) {
        onLine(view.subarray(start, newline).toString("utf8"));
        start = newline + 1;
      }
      carry = Buffer.from(view.subarray(start));
    }
    return { offset: pos - carry.length, size: info.size, mtimeMs: info.mtimeMs };
  } finally {
    await handle.close();
  }
}
