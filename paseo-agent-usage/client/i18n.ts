import { browserLanguages } from "./web";
import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "./data";

export type Locale = "zh" | "en";
export type LanguageMode = "auto" | Locale;

const listeners = new Set<() => void>();
let mode: LanguageMode = "auto";
let locale: Locale = resolveLocale("auto");

/** Best-effort system locale detection (navigator / Intl), defaulting to Chinese. */
export function detectSystemLocale(): Locale {
  try {
    const candidates = browserLanguages();
    try {
      const intl = Intl.DateTimeFormat().resolvedOptions().locale;
      if (intl) candidates.push(intl);
    } catch {
      /* ignore */
    }
    for (const raw of candidates) if (/^zh/i.test(raw)) return "zh";
    for (const raw of candidates) if (/^en/i.test(raw)) return "en";
  } catch {
    /* ignore */
  }
  return "zh";
}

function resolveLocale(next: LanguageMode): Locale {
  return next === "auto" ? detectSystemLocale() : next;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function setLanguageMode(next: LanguageMode): void {
  if (next === mode && resolveLocale(next) === locale) return;
  mode = next;
  locale = resolveLocale(next);
  notify();
}

export function getLocale(): Locale {
  return locale;
}

const zh = {
  "fleet.all": "所有 Paseo 主机",
  "fleet.selected": "当前主机 + SSH",
  "fleet.ready": "{ready}/{total} 台主机已汇总",
  "fleet.partial": "部分数据 · {ready}/{total} 台主机可用",
  "fleet.partialHint": "不可用主机保留本次连接中最后成功读取的数据；尚无数据的主机未计入",
  "fleet.refreshFailed": "刷新失败，请检查主机连接",
  "fleet.footer": "所有主机 · Token",
  "fleet.day": "近 24 小时",
  "fleet.week": "近 7 天",
  "fleet.month": "近 30 天",
  "common.loading": "加载中…",
  "common.save": "保存",
  "common.saving": "保存中…",
  "common.saved": "已保存",
  "common.cancel": "取消",
  "common.edit": "编辑",
  "common.delete": "删除",
  "common.test": "测试连接",
  "common.testing": "测试中…",
  "common.back": "← 返回",
  "common.close": "关闭",
  "common.saveFailed": "保存失败",
  "common.saveFailedDetail": "保存失败：{message}",

  "unit.requests": "{n} 次",
  "unit.credits": "{n} 积分",
  "unit.creditsShort": "{n} 分",
  "unit.in": "入",
  "unit.out": "出",
  "unit.cache": "缓存",
  "unit.minutes": "{n} 分钟",
  "unit.hours": "{h} 小时 {m} 分",
  "unit.days": "{d} 天 {h} 小时",

  "app.title": "Agent 用量",
  "app.subtitleSince": "数据自 {day} 起 · 基于本地会话日志",
  "app.subtitle": "基于本地会话日志统计",
  "app.config": "配置",
  "app.refresh": "刷新",
  "app.refreshing": "刷新中…",
  "app.a11yOpenConfig": "打开配置",
  "app.a11yRefresh": "刷新用量",
  "community.title": "开源共创",
  "community.hint": "Agent Usage 因你而更好。发现问题或有新想法？欢迎提 Issue、提 PR。",
  "community.issue": "提 Issue",
  "community.pr": "提 PR",
  "community.issueA11y": "在 GitHub 提 Issue",
  "community.prA11y": "在 GitHub 提 Pull Request",
  "community.dismissA11y": "关闭共创提示",
  "community.dismissFailed": "关闭提示失败，请重试",
  "update.available": "发现新版本 v{latest}（当前 v{current}）· 更新：paseo plugin update agent-usage-plugin",
  "update.dismiss": "关闭",

  "range.24h": "近24小时",
  "range.today": "今日",
  "range.7d": "近 7 天",
  "range.30d": "近 30 天",
  "range.12w": "近 12 周",
  "range.12m": "近 12 月",
  "range.custom": "自定义",

  "granularity.hour": "小时",
  "granularity.day": "日",
  "granularity.week": "周",
  "granularity.month": "月",

  "chart.bar": "柱状图",
  "chart.line": "折线图",
  "chart.hoverHint": "悬浮（或点按）图表查看当期明细。",
  "toolbar.device": "设备",
  "toolbar.agent": "Agent",
  "toolbar.range": "范围",
  "toolbar.granularity": "粒度",
  "toolbar.editDates": "编辑日期",
  "toolbar.hideDates": "收起日期",
  "chart.pointA11y": "{label} 用量",

  "origin.aggregate": "聚合",
  "origin.local": "本机",
  "origin.pulling": "拉取中…",
  "origin.error": "拉取失败",
  "origin.never": "未拉取",
  "origin.ok": "正常",
  "origin.synced": "已同步 {time}",
  "origin.pullFailed": "{label} 拉取失败：{error}",

  "scan.scanning": "正在扫描本地日志 {done}/{total}",
  "scan.firstHint": "（首次扫描，Codex 历史日志较大，可能需要一会儿）",
  "scan.error": "上次扫描出错：{error}",

  "tab.overview": "总览",
  "page.prev": "上一页",
  "page.next": "下一页",
  "page.state": "{x} / {y} 页",
  "sessions.list": "会话（{n}）",
  "sessions.footer": "区间内共 {total} 个会话，仅显示最近 {n} 个。",
  "sessions.empty": "所选范围内没有会话（按会话首次请求时间归类），数据需要重新扫描：刷新页面或稍等片刻。",
  "card.totalTokens": "总 Tokens",
  "card.requests": "请求数",
  "card.cacheShare": "缓存读取占比",
  "card.credits": "积分",
  "card.info": "查看图表说明",
  "section.trend": "趋势",
  "section.byAgent": "按 Agent",
  "section.models": "模型明细",
  "section.projects": "项目明细",
  "section.agentTrend": "{label} 趋势",
  "section.requestLog": "请求日志（最近 {n} 条）",
  "log.empty": "所选范围内暂无记录；日志只保留最近约 400 条调用。",
  "log.footer": "日志仅保留最近约 400 条调用，更早的会滚动淘汰。",

  "notes.title": "统计口径与已知差异",
  "notes.collapse": "收起",
  "notes.expand": "展开",
  "notes.collapsedHint": "与 CC Switch 对比时存在少量口径差异，展开查看原因。",
  "notes.item1":
    "· 本插件仅统计本地（及远端）会话日志；CC Switch 等代理工具还会记录「代理层」流量，口径天然不同。",
  "notes.item2":
    "· Codex 少量「一次性 App Server 线程」请求不写入任何本地日志（仅代理可见），本插件无法统计；量级通常小于 0.1%。",
  "notes.item3":
    "· 请求数：CC Switch 的请求数包含其自身探针、限流与失败请求，通常略高；对比时建议以 token 总量为准。",
  "notes.item4":
    "· 历史差异：源端清理过的记录（如 Claude Code 约 30 天自动清理）无法补回；本插件也会统计部分 CC Switch 不扫描的内容（Pi forks/子会话、Codex fork 恢复事件），个别数字可能更大。",
  "notes.item5": "以上均为数据源结构差异，不是统计误差。",

  "empty.preparing": "正在准备数据…",
  "empty.noData": "暂无数据",
  "empty.firstScan": "首次扫描完成后，这里会显示统计。",
  "empty.none": "未找到本地会话日志，或所选设备范围内没有用量。",

  "date.pickStart": "请选择起始日期",
  "date.pickEnd": "{from} ~ 请选择结束日期",
  "date.clear": "清除",
  "date.ym": "{year}年{month}月",

  "project.unknown": "(未知项目)",

  "config.title": "配置",
  "config.general": "通用",
  "config.language": "语言",
  "config.language.system": "跟随系统",
  "config.autoRefresh": "定时刷新",
  "config.autoRefreshHint": "定时自动扫描本地日志并同步远端主机。",
  "config.localAlias": "本机标签（默认「{default}」）",
  "config.localAliasHint": "设备页签、主机对比和数据源列表里「{default}」的自定义显示名称，留空恢复默认。",
  "config.defaultRange": "默认时间范围",
  "config.defaultGranularity": "默认趋势粒度",
  "config.defaultHint": "打开用量页时使用的时间范围与趋势粒度。",
  "config.budget": "月度预算（USD，可选）",
  "config.budgetHint": "用于预算卡；留空或 0 表示关闭。只统计有成本上报的 Agent。",
  "config.budgetPlaceholder": "例如 100",
  "config.refresh.off": "关闭",
  "config.refresh.5": "5 分钟",
  "config.refresh.15": "15 分钟",
  "config.refresh.30": "30 分钟",
  "config.refresh.60": "1 小时",
  "config.refresh.360": "6 小时",
  "config.refresh.1440": "24 小时",
  "config.agents": "Agent 开关",
  "config.agentsHint": "关闭的 Agent 不展示、不拉取。",

  "config.feedback": "反馈与扩展",
  "config.feedbackHint": "发现问题、想要新功能，或希望接入新的 Agent？在 GitHub 上告诉我们。关闭看板顶部提示后，这里仍会保留入口。",
  "config.feedback.bug": "报告问题",
  "config.feedback.bugHint": "附上 Paseo 与插件版本、复现步骤和预期结果。",
  "config.feedback.feature": "提功能需求",
  "config.feedback.featureHint": "描述使用场景、期望的交互和替代方案。",
  "config.feedback.provider": "接入新的 Agent",
  "config.feedback.providerHint": "提供 Agent 名称、日志位置和脱敏后的示例记录。",

  "hosts.title": "远端主机（SSH）",
  "hosts.add": "新增主机",
  "hosts.empty": "还没有远端主机。点击「新增主机」添加，支持 SSH 密钥或账号密码认证。",
  "hosts.auth.passwordCommand": "取密命令",
  "hosts.auth.password": "密码认证",
  "hosts.auth.key": "密钥认证",
  "hosts.edit": "编辑「{name}」",
  "hosts.nameLabel": "名称（唯一标识）",
  "hosts.targetLabel": "地址（user@host 或 ~/.ssh/config 别名）",
  "hosts.targetPlaceholder": "例如 dev1 或 user@host",
  "hosts.portLabel": "端口（可选）",
  "hosts.timeoutLabel": "超时（秒）",
  "hosts.authLabel": "认证方式",
  "hosts.passwordSaved": "密码（已保存，留空保持不变）",
  "hosts.password": "密码",
  "hosts.passwordPlaceholder": "输入密码",
  "hosts.passwordCommandLabel": "取密命令（在本机执行，输出即密码）",
  "hosts.identityLabel": "密钥文件（可选）",
  "hosts.nodePathLabel": "远端 node 路径（可选）",
  "hosts.cacheDirLabel": "远端缓存目录（可选）",
  "hosts.saved": "已保存（新主机或变更的主机会自动拉取）",
  "hosts.needNameTarget": "请填写名称和地址（target）",
  "hosts.notes1":
    "说明：远端无需安装任何东西——自动探测 JS 运行时（PATH / nvm / volta / fnm / homebrew）；仅当探测不到时才需填 nodePath。",
  "hosts.notes2": "密码只保存在本机（hosts.json，权限 600），也可用取密命令从钥匙串读取。",
} as const;

export type DictKey = keyof typeof zh;

const en: Record<DictKey, string> = {
  "fleet.all": "All Paseo hosts",
  "fleet.selected": "Selected host + SSH",
  "fleet.ready": "{ready}/{total} hosts included",
  "fleet.partial": "Partial data · {ready}/{total} hosts available",
  "fleet.partialHint": "Unavailable hosts retain their last successful snapshot in this connection; hosts without data are excluded",
  "fleet.refreshFailed": "Refresh failed; check the host connection",
  "fleet.footer": "All hosts · Tokens",
  "fleet.day": "Last 24 hours",
  "fleet.week": "Last 7 days",
  "fleet.month": "Last 30 days",
  "common.loading": "Loading…",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.saved": "Saved",
  "common.cancel": "Cancel",
  "common.edit": "Edit",
  "common.delete": "Delete",
  "common.test": "Test connection",
  "common.testing": "Testing…",
  "common.back": "← Back",
  "common.close": "Close",
  "common.saveFailed": "Save failed",
  "common.saveFailedDetail": "Save failed: {message}",

  "unit.requests": "{n} reqs",
  "unit.credits": "{n} credits",
  "unit.creditsShort": "{n} cr",
  "unit.in": "in",
  "unit.out": "out",
  "unit.cache": "cache",
  "unit.minutes": "{n} min",
  "unit.hours": "{h}h {m}m",
  "unit.days": "{d}d {h}h",

  "app.title": "Agent Usage",
  "app.subtitleSince": "Since {day} · from local session logs",
  "app.subtitle": "Based on local session logs",
  "app.config": "Settings",
  "app.refresh": "Refresh",
  "app.refreshing": "Refreshing…",
  "app.a11yOpenConfig": "Open settings",
  "app.a11yRefresh": "Refresh usage",
  "community.title": "Open source, built together",
  "community.hint": "Agent Usage gets better with you. Found a bug or have an idea? Open an issue or send a PR.",
  "community.issue": "Open issue",
  "community.pr": "Open PR",
  "community.issueA11y": "Open a GitHub issue",
  "community.prA11y": "Open a GitHub pull request",
  "community.dismissA11y": "Dismiss co-creation banner",
  "community.dismissFailed": "Could not dismiss the banner. Try again.",
  "update.available": "New version v{latest} is available (current v{current}) · Update: paseo plugin update agent-usage-plugin",
  "update.dismiss": "Dismiss",

  "range.24h": "Last 24 hours",
  "range.today": "Today",
  "range.7d": "Last 7 days",
  "range.30d": "Last 30 days",
  "range.12w": "Last 12 weeks",
  "range.12m": "Last 12 months",
  "range.custom": "Custom",

  "granularity.hour": "Hour",
  "granularity.day": "Day",
  "granularity.week": "Week",
  "granularity.month": "Month",

  "chart.bar": "Bars",
  "chart.line": "Line",
  "chart.hoverHint": "Hover (or tap) the chart for details.",
  "toolbar.device": "Device",
  "toolbar.agent": "Agent",
  "toolbar.range": "Range",
  "toolbar.granularity": "Granularity",
  "toolbar.editDates": "Edit dates",
  "toolbar.hideDates": "Hide dates",
  "chart.pointA11y": "{label} usage",

  "origin.aggregate": "All",
  "origin.local": "Local",
  "origin.pulling": "Pulling…",
  "origin.error": "Pull failed",
  "origin.never": "Not yet",
  "origin.ok": "OK",
  "origin.synced": "Synced {time}",
  "origin.pullFailed": "{label} pull failed: {error}",

  "scan.scanning": "Scanning local logs {done}/{total}",
  "scan.firstHint": " (first scan may take a while — large Codex history)",
  "scan.error": "Last scan error: {error}",

  "tab.overview": "Overview",
  "page.prev": "Prev",
  "page.next": "Next",
  "page.state": "{x} / {y}",
  "sessions.list": "Sessions ({n})",
  "sessions.footer": "{total} sessions in range, showing the latest {n}.",
  "sessions.empty": "No sessions in the selected range (grouped by first request); a rescan is needed — refresh the page or wait a moment.",
  "card.totalTokens": "Total tokens",
  "card.requests": "Requests",
  "card.cacheShare": "Cache read share",
  "card.credits": "Credits",
  "card.info": "Show chart description",
  "section.trend": "Trend",
  "section.byAgent": "By agent",
  "section.models": "Models",
  "section.projects": "Projects",
  "section.agentTrend": "{label} trend",
  "section.requestLog": "Request log (latest {n})",
  "log.empty": "No records in this range; only the latest ~400 calls are kept.",
  "log.footer": "Only the latest ~400 calls are kept; older entries roll off.",

  "notes.title": "Scope & known differences",
  "notes.collapse": "Collapse",
  "notes.expand": "Expand",
  "notes.collapsedHint": "A few differences vs CC Switch are expected — expand for details.",
  "notes.item1":
    "· This plugin only reads local (and remote) session logs; proxy tools like CC Switch also record proxy-layer traffic, so scopes differ by design.",
  "notes.item2":
    "· A few Codex \"one-shot app-server thread\" requests are never written to local logs (proxy-only) and cannot be counted here; usually under 0.1%.",
  "notes.item3":
    "· Request counts: CC Switch includes its own probes, throttled and failed requests, so its count runs a bit higher; compare token totals instead.",
  "notes.item4":
    "· History: records cleaned at the source (e.g. Claude Code's ~30-day cleanup) cannot be recovered; this plugin also counts things CC Switch skips (Pi forks/sub-runs, recovered Codex fork events), so occasional numbers can be larger here.",
  "notes.item5": "These are structural data-source differences, not counting errors.",

  "empty.preparing": "Preparing data…",
  "empty.noData": "No data",
  "empty.firstScan": "Stats appear here once the first scan finishes.",
  "empty.none": "No local session logs found, or no usage in the selected scope.",

  "date.pickStart": "Select start date",
  "date.pickEnd": "{from} ~ select end date",
  "date.clear": "Clear",
  "date.ym": "{month}/{year}",

  "project.unknown": "(unknown project)",

  "config.title": "Settings",
  "config.general": "General",
  "config.language": "Language",
  "config.language.system": "System",
  "config.autoRefresh": "Auto refresh",
  "config.autoRefreshHint": "Periodically scan local logs and sync remote hosts.",
  "config.localAlias": "Local tab label (default \"{default}\")",
  "config.localAliasHint": "Custom display name for \"{default}\" in device tabs, host comparison, and the source list; leave empty to use the default.",
  "config.defaultRange": "Default range",
  "config.defaultGranularity": "Default granularity",
  "config.defaultHint": "Range and trend granularity used when the usage screen opens.",
  "config.budget": "Monthly budget (USD, optional)",
  "config.budgetHint": "Used by the budget card; blank or 0 disables it. Only agents that report cost are counted.",
  "config.budgetPlaceholder": "e.g. 100",
  "config.refresh.off": "Off",
  "config.refresh.5": "5 min",
  "config.refresh.15": "15 min",
  "config.refresh.30": "30 min",
  "config.refresh.60": "1 hour",
  "config.refresh.360": "6 hours",
  "config.refresh.1440": "24 hours",
  "config.agents": "Agents",
  "config.agentsHint": "Disabled agents are hidden and not scanned.",

  "config.feedback": "Feedback & extensions",
  "config.feedbackHint": "Found a bug, want a feature, or need another agent supported? Tell us on GitHub. These links remain available after you dismiss the dashboard banner.",
  "config.feedback.bug": "Report a bug",
  "config.feedback.bugHint": "Include the Paseo and plugin versions, steps to reproduce, and expected behavior.",
  "config.feedback.feature": "Request a feature",
  "config.feedback.featureHint": "Describe the use case, the interaction you expect, and alternatives.",
  "config.feedback.provider": "Add an agent",
  "config.feedback.providerHint": "Share the agent name, where it stores logs, and a desensitized sample record.",

  "hosts.title": "Remote hosts (SSH)",
  "hosts.add": "Add host",
  "hosts.empty": "No remote hosts yet. Click \"Add host\" to add one — SSH key or password auth supported.",
  "hosts.auth.passwordCommand": "Password command",
  "hosts.auth.password": "Password",
  "hosts.auth.key": "SSH key",
  "hosts.edit": "Edit \"{name}\"",
  "hosts.nameLabel": "Name (unique id)",
  "hosts.targetLabel": "Address (user@host or ~/.ssh/config alias)",
  "hosts.targetPlaceholder": "e.g. dev1 or user@host",
  "hosts.portLabel": "Port (optional)",
  "hosts.timeoutLabel": "Timeout (seconds)",
  "hosts.authLabel": "Authentication",
  "hosts.passwordSaved": "Password (saved — leave blank to keep)",
  "hosts.password": "Password",
  "hosts.passwordPlaceholder": "Enter password",
  "hosts.passwordCommandLabel": "Password command (runs locally; stdout is the password)",
  "hosts.identityLabel": "Identity file (optional)",
  "hosts.nodePathLabel": "Remote node path (optional)",
  "hosts.cacheDirLabel": "Remote cache dir (optional)",
  "hosts.saved": "Saved (new or changed hosts pull automatically)",
  "hosts.needNameTarget": "Please fill in a name and target",
  "hosts.notes1":
    "Notes: nothing needs to be installed on the remote — the JS runtime is auto-detected (PATH / nvm / volta / fnm / homebrew); set nodePath only if detection fails.",
  "hosts.notes2": "Passwords stay on this machine only (hosts.json, mode 600); a password command can read from the Keychain instead.",
};

const DICT: Record<Locale, Record<DictKey, string>> = { zh, en };

export type Translate = (key: DictKey, params?: Record<string, string | number>) => string;

function makeTranslate(loc: Locale): Translate {
  const table = DICT[loc];
  return (key, params) => {
    let text = table[key] ?? DICT.zh[key] ?? String(key);
    if (params) {
      for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value));
    }
    return text;
  };
}

/** Non-reactive translation for helpers outside components (uses the current locale). */
export function translateNow(key: DictKey, params?: Record<string, string | number>): string {
  return makeTranslate(locale)(key, params);
}

/** Localized strings + reactive locale; subscribes to the shared language store. */
export function useI18n(): { locale: Locale; mode: LanguageMode; t: Translate } {
  const [, setTick] = useState(0);
  const prefs = usePrefs(detectSystemLocale());
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    const language = prefs.data?.language;
    if (language) setLanguageMode(language);
  }, [prefs.data?.language]);
  const current = locale;
  const t = useMemo(() => makeTranslate(current), [current]);
  return { locale: current, mode, t };
}
