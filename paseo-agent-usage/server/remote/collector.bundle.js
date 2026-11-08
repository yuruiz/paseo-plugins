"use strict";

// server/remote/collector.ts
var import_node_os5 = require("os");
var import_node_path7 = require("path");

// server/scan/scanner.ts
var import_promises3 = require("fs/promises");

// server/scan/claude.ts
var import_node_os = require("os");
var import_node_path3 = require("path");

// server/scan/state.ts
var import_promises = require("fs/promises");
var import_node_path = require("path");
var STATE_VERSION = 13;
var SESSION_KEEP_LIMIT = 8e3;
function pruneSessions(sessions) {
  for (const key of Object.keys(sessions)) {
    const entry = sessions[key];
    if (!entry || entry.r <= 0) delete sessions[key];
  }
  const keys = Object.keys(sessions);
  if (keys.length <= SESSION_KEEP_LIMIT) return;
  keys.sort((a, b) => {
    var _a, _b;
    return (((_a = sessions[b]) == null ? void 0 : _a.e) ?? 0) - (((_b = sessions[a]) == null ? void 0 : _b.e) ?? 0);
  });
  for (const key of keys.slice(SESSION_KEEP_LIMIT)) delete sessions[key];
}
function applySession(sessions, harness, sid, delta) {
  if (!sid) return;
  const key = `${harness}${sid}`;
  let entry = sessions[key];
  if (!entry) {
    if (delta.r <= 0) return;
    entry = { s: delta.t ?? 0, e: delta.t ?? 0, r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0, p: delta.p ?? "" };
    sessions[key] = entry;
  }
  entry.r += delta.r;
  entry.i += delta.i ?? 0;
  entry.o += delta.o ?? 0;
  entry.cr += delta.cr ?? 0;
  entry.cw += delta.cw ?? 0;
  entry.rz += delta.rz ?? 0;
  entry.cost += delta.cost ?? 0;
  entry.credits += delta.credits ?? 0;
  if (delta.p) entry.p = delta.p;
  if (delta.title && !entry.title) entry.title = delta.title;
  if (typeof delta.t === "number" && Number.isFinite(delta.t)) {
    if (delta.t < entry.s) entry.s = delta.t;
    if (delta.t > entry.e) entry.e = delta.t;
  }
}
var MAX_RECENT_PER_AGENT = 400;
function emptyState() {
  return {
    version: STATE_VERSION,
    buckets: {},
    sessions: {},
    files: {},
    recent: {},
    opencode: { watermark: 0, lastId: "" },
    pi: { seen: [] },
    hosts: {},
    meta: { lastScanAt: null, scanError: null }
  };
}
function bucketKey(hourKey, harness, model, project) {
  return [hourKey, harness, model, project].join("");
}
function addBucket(buckets, hourKey, harness, model, project, delta) {
  const key = bucketKey(hourKey, harness, model, project);
  let bucket = buckets[key];
  if (!bucket) {
    bucket = { r: 0, i: 0, o: 0, cr: 0, cw: 0, rz: 0, cost: 0, credits: 0 };
    buckets[key] = bucket;
  }
  bucket.r += delta.r;
  bucket.i += delta.i ?? 0;
  bucket.o += delta.o ?? 0;
  bucket.cr += delta.cr ?? 0;
  bucket.cw += delta.cw ?? 0;
  bucket.rz += delta.rz ?? 0;
  bucket.cost += delta.cost ?? 0;
  bucket.credits += delta.credits ?? 0;
  if (bucket.r <= 0 && bucket.i <= 0 && bucket.o <= 0 && bucket.cr <= 0 && bucket.cw <= 0 && bucket.rz <= 0 && bucket.cost <= 0 && bucket.credits <= 0) {
    delete buckets[key];
  }
}
function recordCall(state, harness, record, replaceId) {
  var _a;
  let list = state.recent[harness];
  if (!list) {
    list = [];
    state.recent[harness] = list;
  }
  if (replaceId) {
    const floor = Math.max(0, list.length - 32);
    for (let index = list.length - 1; index >= floor; index -= 1) {
      if (((_a = list[index]) == null ? void 0 : _a.id) === replaceId) {
        list[index] = record;
        return;
      }
    }
  }
  list.push(record);
  if (list.length > MAX_RECENT_PER_AGENT) list.splice(0, list.length - MAX_RECENT_PER_AGENT);
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function sanitizeBuckets(raw) {
  const buckets = {};
  if (!raw || typeof raw !== "object") return buckets;
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const record = value;
    buckets[key] = {
      r: finite(record.r),
      i: finite(record.i),
      o: finite(record.o),
      cr: finite(record.cr),
      cw: finite(record.cw),
      rz: finite(record.rz),
      cost: finite(record.cost),
      credits: finite(record.credits)
    };
  }
  return buckets;
}
function sanitizeSessions(raw) {
  const sessions = {};
  if (!raw || typeof raw !== "object") return sessions;
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const record = value;
    sessions[key] = {
      s: finite(record.s),
      e: finite(record.e),
      r: finite(record.r),
      i: finite(record.i),
      o: finite(record.o),
      cr: finite(record.cr),
      cw: finite(record.cw),
      rz: finite(record.rz),
      cost: finite(record.cost),
      credits: finite(record.credits),
      p: typeof record.p === "string" ? record.p : "",
      title: typeof record.title === "string" ? record.title : void 0
    };
  }
  return sessions;
}
async function loadState(dir) {
  var _a, _b, _c, _d, _e;
  try {
    const text = await (0, import_promises.readFile)((0, import_node_path.join)(dir, "state.json"), "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || parsed.version !== STATE_VERSION) return emptyState();
    const state = emptyState();
    state.buckets = sanitizeBuckets(parsed.buckets);
    state.sessions = sanitizeSessions(parsed.sessions);
    state.files = parsed.files ?? {};
    state.recent = parsed.recent ?? {};
    state.opencode = {
      watermark: finite((_a = parsed.opencode) == null ? void 0 : _a.watermark),
      lastId: typeof ((_b = parsed.opencode) == null ? void 0 : _b.lastId) === "string" ? parsed.opencode.lastId : ""
    };
    state.pi = { seen: Array.isArray((_c = parsed.pi) == null ? void 0 : _c.seen) ? parsed.pi.seen.filter((k) => typeof k === "string") : [] };
    state.hosts = parsed.hosts ?? {};
    state.meta = {
      lastScanAt: typeof ((_d = parsed.meta) == null ? void 0 : _d.lastScanAt) === "number" ? parsed.meta.lastScanAt : null,
      scanError: typeof ((_e = parsed.meta) == null ? void 0 : _e.scanError) === "string" ? parsed.meta.scanError : null
    };
    return state;
  } catch {
    return emptyState();
  }
}
async function saveState(dir, state) {
  pruneSessions(state.sessions);
  for (const host of Object.values(state.hosts ?? {})) if (host == null ? void 0 : host.sessions) pruneSessions(host.sessions);
  await (0, import_promises.mkdir)(dir, { recursive: true, mode: 448 }).catch(() => {
  });
  const file = (0, import_node_path.join)(dir, "state.json");
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  await (0, import_promises.writeFile)(temporary, JSON.stringify(state), { mode: 384 });
  await (0, import_promises.rename)(temporary, file);
  await (0, import_promises.chmod)(dir, 448).catch(() => {
  });
}

// server/scan/util.ts
var import_promises2 = require("fs/promises");
var import_node_path2 = require("path");
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function clipTitle(text) {
  if (typeof text !== "string") return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const chars = [...clean];
  return chars.length > 60 ? `${chars.slice(0, 60).join("")}\u2026` : clean;
}
var MACHINE_LABEL = /^(# AGENTS\.md|<environment_context|<user_instructions|<permissions|<chat-history-summary|<paseo-system|<paseo-agent|this session is being continued|caveat: the messages below)/i;
function firstMessageText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block && typeof block === "object" && typeof block.text === "string") {
      const kind = block.type;
      if (kind === "text" || kind === "input_text") return block.text;
    }
  }
  return "";
}
function localDateKey(ms) {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
function localHourKey(ms) {
  const date = new Date(ms);
  return `${localDateKey(ms)}T${String(date.getHours()).padStart(2, "0")}`;
}
async function listJsonlFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    let entries;
    try {
      entries = await (0, import_promises2.readdir)(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push((0, import_node_path2.join)(dir, entry.name));
      else if (entry.name.endsWith(".jsonl")) files.push((0, import_node_path2.join)(dir, entry.name));
    }
  }
  return files;
}
var CHUNK = 4 * 1024 * 1024;
async function forEachNewLine(path, fromOffset, onLine) {
  let handle;
  try {
    handle = await (0, import_promises2.open)(path, "r");
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

// server/scan/claude.ts
var CLAUDE = "claude";
function claudeRoots(env = process.env) {
  var _a;
  const home = (0, import_node_os.homedir)();
  const base = ((_a = env.CLAUDE_CONFIG_DIR) == null ? void 0 : _a.trim()) || (0, import_node_path3.join)(home, ".claude");
  return [.../* @__PURE__ */ new Set([(0, import_node_path3.join)(base, "projects"), (0, import_node_path3.join)(home, ".config", "claude", "projects")])];
}
async function scanClaudeFile(state, path) {
  const previousState = state.files[path];
  const recent = /* @__PURE__ */ new Map();
  let sessionTitle = (previousState == null ? void 0 : previousState.sessionTitle) ?? "";
  if (previousState == null ? void 0 : previousState.recent) {
    for (const contribution of previousState.recent) recent.set(contribution.id, contribution);
  }
  const result = await forEachNewLine(path, (previousState == null ? void 0 : previousState.offset) ?? 0, (line) => {
    var _a, _b;
    if (!line.includes('"sessionId"')) return;
    if (line.includes('"type":"user"')) {
      try {
        const entry2 = JSON.parse(line);
        if ((entry2 == null ? void 0 : entry2.type) === "user") {
          const raw = firstMessageText((_a = entry2.message) == null ? void 0 : _a.content);
          const text = raw && !MACHINE_LABEL.test(raw.trim()) ? clipTitle(raw) : "";
          if (text && !sessionTitle) sessionTitle = text;
          return;
        }
      } catch {
      }
    }
    if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if ((entry == null ? void 0 : entry.type) !== "assistant") return;
    const message = entry.message;
    if (!message || typeof message !== "object") return;
    const usage = message.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;
    const id = typeof message.id === "string" && message.id ? message.id : null;
    const sid = typeof entry.sessionId === "string" ? entry.sessionId : "";
    const contribution = {
      id: id ?? "",
      d: localHourKey(ts),
      m: typeof message.model === "string" && message.model ? message.model : "unknown",
      p: typeof entry.cwd === "string" ? entry.cwd : "",
      i: num(usage.input_tokens),
      o: num(usage.output_tokens),
      cr: num(usage.cache_read_input_tokens),
      cw: num(usage.cache_creation_input_tokens),
      rz: num((_b = usage.output_tokens_details) == null ? void 0 : _b.thinking_tokens)
    };
    if (id && recent.has(id)) {
      const before = recent.get(id);
      addBucket(state.buckets, before.d, CLAUDE, before.m, before.p, {
        r: -1,
        i: -before.i,
        o: -before.o,
        cr: -before.cr,
        cw: -before.cw,
        rz: -before.rz
      });
      applySession(state.sessions, CLAUDE, sid, {
        r: -1,
        i: -before.i,
        o: -before.o,
        cr: -before.cr,
        cw: -before.cw,
        rz: -before.rz
      });
    }
    if (id) {
      recent.set(id, contribution);
      if (recent.size > 96) {
        const oldest = recent.keys().next().value;
        if (typeof oldest === "string" && oldest !== id) recent.delete(oldest);
      }
    }
    addBucket(state.buckets, contribution.d, CLAUDE, contribution.m, contribution.p, {
      r: 1,
      i: contribution.i,
      o: contribution.o,
      cr: contribution.cr,
      cw: contribution.cw,
      rz: contribution.rz
    });
    applySession(state.sessions, CLAUDE, sid, {
      t: ts,
      r: 1,
      p: contribution.p,
      i: contribution.i,
      o: contribution.o,
      cr: contribution.cr,
      cw: contribution.cw,
      rz: contribution.rz,
      title: sessionTitle || void 0
    });
    recordCall(
      state,
      CLAUDE,
      {
        t: ts,
        m: contribution.m,
        p: contribution.p,
        s: sid,
        i: contribution.i,
        o: contribution.o,
        cr: contribution.cr,
        cw: contribution.cw,
        rz: contribution.rz,
        cost: 0,
        credits: 0,
        id: id ?? void 0
      },
      id ?? void 0
    );
  });
  if (!result) return;
  const fileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs };
  if (sessionTitle) fileState.sessionTitle = sessionTitle;
  if (recent.size > 0) fileState.recent = [...recent.values()].slice(-96);
  state.files[path] = fileState;
}

// server/scan/codex.ts
var import_node_os2 = require("os");
var import_node_path4 = require("path");
var CODEX = "codex";
function codexRoots(env = process.env) {
  var _a;
  const home = ((_a = env.CODEX_HOME) == null ? void 0 : _a.trim()) || (0, import_node_path4.join)((0, import_node_os2.homedir)(), ".codex");
  return [(0, import_node_path4.join)(home, "sessions"), (0, import_node_path4.join)(home, "archived_sessions")];
}
var BURST_WINDOW_MS = 2e3;
async function scanCodexFile(state, path) {
  const previousState = state.files[path];
  let project = (previousState == null ? void 0 : previousState.project) ?? "";
  let model = (previousState == null ? void 0 : previousState.model) ?? "";
  let session = (previousState == null ? void 0 : previousState.session) ?? "";
  let title = (previousState == null ? void 0 : previousState.sessionTitle) ?? "";
  let totals = (previousState == null ? void 0 : previousState.totals) ?? null;
  let fork = (previousState == null ? void 0 : previousState.codexFork) ?? { forked: false, point: null, baselineDone: false, firstTs: null };
  const result = await forEachNewLine(path, (previousState == null ? void 0 : previousState.offset) ?? 0, (line) => {
    var _a, _b;
    if (!title && (line.includes('"response_item"') || line.includes('"user_message"'))) {
      try {
        const entry2 = JSON.parse(line);
        const payload = entry2 == null ? void 0 : entry2.payload;
        if ((payload == null ? void 0 : payload.type) === "user_message") {
          const text = clipTitle(payload.message);
          if (text) title = text;
        } else if ((payload == null ? void 0 : payload.type) === "message" && payload.role === "user") {
          const text = firstMessageText(payload.content);
          if (text && !MACHINE_LABEL.test(text)) {
            const label = clipTitle(text);
            if (label) title = label;
          }
        }
      } catch {
      }
    }
    if (line.includes('"session_meta"')) {
      try {
        const entry2 = JSON.parse(line);
        const payload = (entry2 == null ? void 0 : entry2.payload) ?? {};
        if (!project && typeof payload.cwd === "string") project = payload.cwd;
        const metaSession = payload.id ?? payload.session_id;
        if (!session && typeof metaSession === "string") session = metaSession;
        if (typeof payload.forked_from_id === "string" && payload.forked_from_id) {
          fork = {
            forked: true,
            point: typeof payload.forked_from_ordinal_exclusive === "number" ? payload.forked_from_ordinal_exclusive : null,
            baselineDone: false,
            firstTs: null
          };
        }
      } catch {
      }
      return;
    }
    if (line.includes('"turn_context"')) {
      try {
        const entry2 = JSON.parse(line);
        const value = (_a = entry2 == null ? void 0 : entry2.payload) == null ? void 0 : _a.model;
        if (typeof value === "string" && value) model = value;
      } catch {
      }
      return;
    }
    if (!line.includes('"token_count"')) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    const info = (_b = entry == null ? void 0 : entry.payload) == null ? void 0 : _b.info;
    if (!info) return;
    const total = info.total_token_usage;
    if (!total || typeof total !== "object") return;
    const current = [
      num(total.input_tokens),
      num(total.cached_input_tokens),
      num(total.cache_write_input_tokens),
      num(total.output_tokens),
      num(total.reasoning_output_tokens),
      num(total.total_tokens)
    ];
    const ts = Date.parse(entry.timestamp);
    const ordinal = num(entry.ordinal);
    if (fork.forked && !fork.baselineDone) {
      if (fork.point !== null) {
        if (!(ordinal > 0 && ordinal > fork.point)) {
          totals = current;
          return;
        }
        const last = info.last_token_usage;
        if (last && typeof last === "object" && Number.isFinite(ts)) {
          const lCached = num(last.cached_input_tokens);
          const lInput = num(last.input_tokens);
          const lOutput = num(last.output_tokens);
          if (lInput + lCached + lOutput > 0) {
            const input2 = Math.max(0, lInput - lCached);
            addBucket(state.buckets, localHourKey(ts), CODEX, model || "codex", project, {
              r: 1,
              i: input2,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens)
            });
            applySession(state.sessions, CODEX, session, {
              t: ts,
              r: 1,
              p: project,
              title: title || void 0,
              i: input2,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens)
            });
            recordCall(state, CODEX, {
              t: ts,
              m: model || "codex",
              p: project,
              s: session,
              i: input2,
              o: lOutput,
              cr: lCached,
              cw: num(last.cache_write_input_tokens),
              rz: num(last.reasoning_output_tokens),
              cost: 0,
              credits: 0
            });
          }
        }
        fork.baselineDone = true;
        totals = current;
        return;
      }
      if (fork.firstTs === null && Number.isFinite(ts)) fork.firstTs = ts;
      if (!Number.isFinite(ts) || fork.firstTs === null || ts - fork.firstTs <= BURST_WINDOW_MS) {
        totals = current;
        return;
      }
      fork.baselineDone = true;
    }
    if (fork.forked && fork.baselineDone && fork.point !== null && ordinal > 0 && ordinal <= fork.point) {
      totals = current;
      return;
    }
    const before = totals;
    totals = current;
    const delta = before ? current.map((value, index) => Math.max(0, value - (before[index] ?? 0))) : current.slice();
    const dInput = delta[0] ?? 0;
    const dCached = delta[1] ?? 0;
    const dCacheWrite = delta[2] ?? 0;
    const dOutput = delta[3] ?? 0;
    const dReasoning = delta[4] ?? 0;
    const dTotal = delta[5] ?? 0;
    if (dTotal <= 0) return;
    if (!Number.isFinite(ts)) return;
    const input = Math.max(0, dInput - dCached);
    addBucket(state.buckets, localHourKey(ts), CODEX, model || "codex", project, {
      r: 1,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning
    });
    applySession(state.sessions, CODEX, session, {
      t: ts,
      r: 1,
      p: project,
      title: title || void 0,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning
    });
    recordCall(state, CODEX, {
      t: ts,
      m: model || "codex",
      p: project,
      s: session,
      i: input,
      o: dOutput,
      cr: dCached,
      cw: dCacheWrite,
      rz: dReasoning,
      cost: 0,
      credits: 0
    });
  });
  if (!result) return;
  const fileState = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs, project, model, session };
  if (title) fileState.sessionTitle = title;
  if (totals) fileState.totals = totals;
  if (fork.forked) fileState.codexFork = fork;
  state.files[path] = fileState;
}

// server/scan/opencode.ts
var import_node_fs = require("fs");
var import_node_module = require("module");
var import_node_os3 = require("os");
var import_node_path5 = require("path");
var OPENCODE = "opencode";
var sqliteModule;
async function loadSqlite() {
  if (sqliteModule !== void 0) return sqliteModule;
  try {
    const requireFn = (0, import_node_module.createRequire)((0, import_node_path5.join)(process.cwd(), "agent-usage-sqlite.cjs"));
    sqliteModule = requireFn("node:sqlite");
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}
function opencodeDbPath(env = process.env) {
  var _a;
  const dataHome = ((_a = env.XDG_DATA_HOME) == null ? void 0 : _a.trim()) || (0, import_node_path5.join)((0, import_node_os3.homedir)(), ".local", "share");
  return (0, import_node_path5.join)(dataHome, "opencode", "opencode.db");
}
async function scanOpencode(state) {
  var _a, _b;
  const path = opencodeDbPath();
  if (!(0, import_node_fs.existsSync)(path)) return;
  const sqlite = await loadSqlite();
  if (!sqlite) {
    console.warn("[agent-usage] opencode skipped: node:sqlite unavailable (needs Node >= 22.5)");
    return;
  }
  let db = null;
  try {
    try {
      db = new sqlite.DatabaseSync(path, { readOnly: true });
    } catch (error) {
      console.warn("[agent-usage] opencode skipped: cannot open the database read-only", error);
      return;
    }
    let cursorTime = state.opencode.watermark;
    let cursorId = state.opencode.lastId ?? "";
    const sessionTitles = /* @__PURE__ */ new Map();
    try {
      const titleStatement = db.prepare("SELECT id, title FROM session WHERE title IS NOT NULL AND title <> ''");
      for (const row of titleStatement.all()) {
        if (typeof row.id === "string" && typeof row.title === "string") sessionTitles.set(row.id, clipTitle(row.title));
      }
    } catch {
    }
    const statement = db.prepare(
      "SELECT id, session_id, time_created, time_updated, data FROM message WHERE time_updated > ? OR (time_updated = ? AND id > ?) ORDER BY time_updated ASC, id ASC LIMIT 4000"
    );
    for (let batch = 0; batch < 500; batch += 1) {
      const rows = statement.all(cursorTime, cursorTime, cursorId);
      if (rows.length === 0) break;
      for (const row of rows) {
        const id = typeof row.id === "string" ? row.id : "";
        const updated = num(row.time_updated);
        if (updated > cursorTime || updated === cursorTime && id > cursorId) {
          cursorTime = updated;
          cursorId = id;
        }
        let data;
        try {
          data = JSON.parse(row.data);
        } catch {
          continue;
        }
        if ((data == null ? void 0 : data.role) !== "assistant") continue;
        const tokens = data.tokens ?? {};
        const cache = tokens.cache ?? {};
        const input = num(tokens.input);
        const output = num(tokens.output);
        const reasoning = num(tokens.reasoning);
        const cacheRead = num(cache.read);
        const cacheWrite = num(cache.write);
        const cost = typeof data.cost === "number" && data.cost > 0 ? data.cost : 0;
        if (input + output + reasoning + cacheRead + cacheWrite <= 0 && cost <= 0) continue;
        const ts = num((_a = data.time) == null ? void 0 : _a.created) || num(row.time_created);
        const model = typeof data.modelID === "string" && data.modelID ? data.modelID : "unknown";
        const project = typeof ((_b = data.path) == null ? void 0 : _b.cwd) === "string" ? data.path.cwd : "";
        const outputWithReasoning = output + reasoning;
        const sid = typeof row.session_id === "string" ? row.session_id : "";
        addBucket(state.buckets, localHourKey(ts), OPENCODE, model, project, {
          r: 1,
          i: input,
          o: outputWithReasoning,
          cr: cacheRead,
          cw: cacheWrite,
          rz: reasoning,
          cost
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
          title: sessionTitles.get(sid)
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
          credits: 0
        });
      }
      if (rows.length < 4e3) break;
    }
    state.opencode.watermark = cursorTime;
    state.opencode.lastId = cursorId;
  } finally {
    db == null ? void 0 : db.close();
  }
}

// server/scan/pi.ts
var import_node_os4 = require("os");
var import_node_path6 = require("path");
var PI = "pi";
var PI_SEEN_LIMIT = 4e5;
var seenCache = /* @__PURE__ */ new WeakMap();
function piRoots(env = process.env) {
  var _a, _b;
  const home = (0, import_node_os4.homedir)();
  const roots = [];
  const sessionDir = (_a = env.PI_CODING_AGENT_SESSION_DIR) == null ? void 0 : _a.trim();
  if (sessionDir) roots.push(sessionDir);
  const agentDir = ((_b = env.PI_CODING_AGENT_DIR) == null ? void 0 : _b.trim()) || (0, import_node_path6.join)(home, ".pi", "agent");
  roots.push((0, import_node_path6.join)(agentDir, "sessions"));
  return [...new Set(roots)];
}
async function scanPiFile(state, path) {
  const previousState = state.files[path];
  let project = (previousState == null ? void 0 : previousState.project) ?? "";
  let title = (previousState == null ? void 0 : previousState.sessionTitle) ?? "";
  const base = path.split("/").pop() ?? "";
  const underscore = base.lastIndexOf("_");
  const session = (underscore >= 0 ? base.slice(underscore + 1) : base).replace(/\.jsonl$/, "");
  const cached = seenCache.get(state);
  const ledger = !cached || cached.keys !== state.pi.seen ? { keys: state.pi.seen, set: new Set(state.pi.seen) } : cached;
  seenCache.set(state, ledger);
  const seen = ledger.set;
  const result = await forEachNewLine(path, (previousState == null ? void 0 : previousState.offset) ?? 0, (line) => {
    var _a, _b;
    if (line.includes('"role":"user"')) {
      try {
        const entry2 = JSON.parse(line);
        const raw = (entry2 == null ? void 0 : entry2.type) === "message" && ((_a = entry2.message) == null ? void 0 : _a.role) === "user" ? firstMessageText(entry2.message.content) : "";
        const text = raw && !MACHINE_LABEL.test(raw.trim()) ? clipTitle(raw) : "";
        if (text && !title) title = text;
      } catch {
      }
    }
    if (!project && line.includes('"type":"session"')) {
      try {
        const entry2 = JSON.parse(line);
        if (typeof (entry2 == null ? void 0 : entry2.cwd) === "string") project = entry2.cwd;
      } catch {
      }
      return;
    }
    if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if ((entry == null ? void 0 : entry.type) !== "message") return;
    const message = entry.message;
    if (!message || typeof message !== "object" || message.role !== "assistant") return;
    const usage = message.usage;
    if (!usage || typeof usage !== "object") return;
    const ts = Date.parse(entry.timestamp);
    if (!Number.isFinite(ts)) return;
    const entryId = typeof entry.id === "string" ? entry.id : "";
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
    if (entryId && timestamp) {
      const key = `${entryId}@${timestamp}`;
      if (seen.has(key)) return;
      seen.add(key);
      state.pi.seen.push(key);
    }
    const cost = typeof ((_b = usage.cost) == null ? void 0 : _b.total) === "number" && usage.cost.total > 0 ? usage.cost.total : 0;
    const model = typeof message.model === "string" && message.model ? message.model : "unknown";
    const input = num(usage.input);
    const output = num(usage.output);
    const cacheRead = num(usage.cacheRead);
    const cacheWrite = num(usage.cacheWrite);
    const reasoning = num(usage.reasoning);
    addBucket(state.buckets, localHourKey(ts), PI, model, project, {
      r: 1,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost
    });
    applySession(state.sessions, PI, session, {
      t: ts,
      r: 1,
      p: project,
      title: title || void 0,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost
    });
    recordCall(state, PI, {
      t: ts,
      m: model,
      p: project,
      s: session,
      i: input,
      o: output,
      cr: cacheRead,
      cw: cacheWrite,
      rz: reasoning,
      cost,
      credits: 0
    });
  });
  if (!result) return;
  if (state.pi.seen.length > PI_SEEN_LIMIT) {
    const removed = state.pi.seen.splice(0, state.pi.seen.length - PI_SEEN_LIMIT);
    for (const key of removed) seen.delete(key);
  }
  state.files[path] = { offset: result.offset, size: result.size, mtimeMs: result.mtimeMs, project, sessionTitle: title || void 0 };
}

// server/scan/scanner.ts
async function scanAll(state, callbacks, enabledHarnesses) {
  if (await filesShrank(state)) {
    console.warn("[agent-usage] log file shrank; resetting counters and rescanning from zero");
    resetCounters(state);
  }
  const on = (id) => !enabledHarnesses || enabledHarnesses.has(id);
  const [claudeFiles, piFiles, codexFiles] = await Promise.all([
    collectRoots(claudeRoots()),
    collectRoots(piRoots()),
    collectRoots(codexRoots())
  ]);
  const total = (on("claude") ? claudeFiles.length : 0) + (on("pi") ? piFiles.length : 0) + (on("codex") ? codexFiles.length : 0) + (on("opencode") ? 1 : 0);
  let done = 0;
  let checkpointAt = Date.now();
  callbacks.onProgress(done, total);
  const tick = () => {
    done += 1;
    callbacks.onProgress(done, total);
    const now = Date.now();
    if (now - checkpointAt > 5e3) {
      checkpointAt = now;
      callbacks.onCheckpoint();
    }
  };
  const run = async (files, scanOne) => {
    for (const file of files) {
      if (callbacks.shouldStop()) return false;
      try {
        await scanOne(state, file);
      } catch (error) {
        console.error("[agent-usage] scan failed for", file, error);
      }
      tick();
    }
    return true;
  };
  if (on("claude") && !await run(claudeFiles, scanClaudeFile)) return;
  if (on("pi") && !await run(piFiles, scanPiFile)) return;
  if (on("opencode")) {
    if (callbacks.shouldStop()) return;
    try {
      await scanOpencode(state);
    } catch (error) {
      console.error("[agent-usage] opencode scan failed", error);
    }
    tick();
  }
  if (on("codex") && !await run(codexFiles, scanCodexFile)) return;
  callbacks.onCheckpoint();
}
async function collectRoots(roots) {
  const seen = /* @__PURE__ */ new Set();
  for (const root of roots) {
    for (const file of await listJsonlFiles(root)) seen.add(file);
  }
  return [...seen].sort();
}
async function filesShrank(state) {
  for (const [path, file] of Object.entries(state.files)) {
    if (!file || !(file.offset > 0)) continue;
    try {
      const info = await (0, import_promises3.stat)(path);
      if (info.isFile() && info.size < file.offset) return true;
    } catch {
    }
  }
  return false;
}
function resetCounters(state) {
  state.buckets = {};
  state.sessions = {};
  state.files = {};
  state.recent = {};
  state.opencode = { watermark: 0, lastId: "" };
  state.pi = { seen: [] };
}

// server/remote/collector.ts
function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] ?? null : null;
}
async function main() {
  const args = process.argv.slice(2);
  const cacheDir = argValue(args, "--cache-dir") || (0, import_node_path7.join)((0, import_node_os5.homedir)(), ".cache", "agent-usage-plugin");
  const fresh = args.includes("--fresh");
  process.stderr.write(`agent-usage collector: node ${process.version}, cache ${cacheDir}${fresh ? ", fresh" : ""}
`);
  const state = fresh ? emptyState() : await loadState(cacheDir);
  let lastLog = 0;
  await scanAll(state, {
    shouldStop: () => false,
    onProgress: (done, total) => {
      const now = Date.now();
      if (now - lastLog > 3e3 || done === total) {
        lastLog = now;
        process.stderr.write(`progress ${done}/${total}
`);
      }
    },
    onCheckpoint: () => {
      void saveState(cacheDir, state).catch(() => {
      });
    }
  });
  state.meta.lastScanAt = Date.now();
  state.meta.scanError = null;
  await saveState(cacheDir, state);
  const projection = {
    v: 2,
    generatedAt: Date.now(),
    node: process.version,
    buckets: state.buckets,
    sessions: state.sessions,
    recent: state.recent
  };
  process.stdout.write(JSON.stringify(projection));
  process.stderr.write(`agent-usage collector: done, ${Object.keys(state.buckets).length} buckets
`);
}
main().catch((error) => {
  process.stderr.write(`agent-usage collector failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  process.exitCode = 1;
});
