import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { addBucket, applySession, recordCall, type ScanState } from "./state";
import { clipTitle, localHourKey, num } from "./util";

export const OPENCODE = "opencode";

/**
 * Minimal structural types for the optional node:sqlite builtin. The module
 * ships with Node >= 22.5 and is loaded at runtime through createRequire,
 * never through a static or type-level import: install-time build checks on
 * machines running older Node versions fail to resolve node:sqlite type
 * dependencies, because the builtin does not exist there yet.
 */
interface SqliteStatement {
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

let sqliteModule: SqliteModule | null | undefined;

/** Loads node:sqlite, or null on runtimes older than Node 22.5. */
export async function loadSqlite(): Promise<SqliteModule | null> {
  if (sqliteModule !== undefined) return sqliteModule;
  try {
    const requireFn = createRequire(join(process.cwd(), "agent-usage-sqlite.cjs"));
    sqliteModule = requireFn("node:sqlite") as SqliteModule;
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

export function opencodeDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export async function scanOpencode(state: ScanState): Promise<void> {
  const path = opencodeDbPath();
  if (!existsSync(path)) return;
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.warn("[agent-usage] opencode skipped: node:sqlite unavailable (needs Node >= 22.5)");
    return;
  }
  let db: SqliteDatabase | null = null;
  try {
    try {
      db = new sqlite.DatabaseSync(path, { readOnly: true });
    } catch (error) {
      console.warn("[agent-usage] opencode skipped: cannot open the database read-only", error);
      return;
    }
    let cursorTime = state.opencode.watermark;
    let cursorId = state.opencode.lastId ?? "";
    const sessionTitles = new Map<string, string>();
    try {
      const titleStatement = db.prepare("SELECT id, title FROM session WHERE title IS NOT NULL AND title <> ''");
      for (const row of titleStatement.all() as unknown as Array<Record<string, unknown>>) {
        if (typeof row.id === "string" && typeof row.title === "string") sessionTitles.set(row.id, clipTitle(row.title));
      }
    } catch {
      /* older schema without the title column */
    }
    const statement = db.prepare(
      "SELECT id, session_id, time_created, time_updated, data FROM message WHERE time_updated > ? OR (time_updated = ? AND id > ?) ORDER BY time_updated ASC, id ASC LIMIT 4000",
    );
    for (let batch = 0; batch < 500; batch += 1) {
      const rows = statement.all(cursorTime, cursorTime, cursorId) as unknown as MessageRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : "";
        const updated = num(row.time_updated);
        // Advance the cursor for every row, including ones we skip, so a
        // non-usage row can never wedge the scanner on the same batch.
        if (updated > cursorTime || (updated === cursorTime && id > cursorId)) {
          cursorTime = updated;
          cursorId = id;
        }
        let data: any;
        try {
          data = JSON.parse(row.data);
        } catch {
          continue;
        }
        if (data?.role !== "assistant") continue;
        const tokens = data.tokens ?? {};
        const cache = tokens.cache ?? {};
        const input = num(tokens.input);
        const output = num(tokens.output);
        const reasoning = num(tokens.reasoning);
        const cacheRead = num(cache.read);
        const cacheWrite = num(cache.write);
        const cost = typeof data.cost === "number" && data.cost > 0 ? data.cost : 0;
        if (input + output + reasoning + cacheRead + cacheWrite <= 0 && cost <= 0) continue;
        const ts = num(data.time?.created) || num(row.time_created);
        const model = typeof data.modelID === "string" && data.modelID ? data.modelID : "unknown";
        const project = typeof data.path?.cwd === "string" ? data.path.cwd : "";
        // Billing semantics: reasoning tokens are part of the generated output,
        // so fold them into `o` (matches CC Switch and real spend). `rz` keeps
        // the reasoning share for display only.
        const outputWithReasoning = output + reasoning;
        const sid = typeof row.session_id === "string" ? row.session_id : "";
        addBucket(state.buckets, localHourKey(ts), OPENCODE, model, project, {
          r: 1,
          i: input,
          o: outputWithReasoning,
          cr: cacheRead,
          cw: cacheWrite,
          rz: reasoning,
          cost,
        });
        applySession(state.sessions, OPENCODE, sid, {
          t: ts,
          r: 1,
          p: project,
          i: input,
          o: outputWithReasoning,
          cr: cacheRead,
          cw: cacheWrite,
          rz: reasoning,
          cost,
          title: sessionTitles.get(sid),
        });
        recordCall(state, OPENCODE, {
          t: ts,
          m: model,
          p: project,
          s: sid,
          i: input,
          o: outputWithReasoning,
          cr: cacheRead,
          cw: cacheWrite,
          rz: reasoning,
          cost,
          credits: 0,
        });
      }
      if (rows.length < 4000) break;
    }
    state.opencode.watermark = cursorTime;
    state.opencode.lastId = cursorId;
  } finally {
    db?.close();
  }
}
