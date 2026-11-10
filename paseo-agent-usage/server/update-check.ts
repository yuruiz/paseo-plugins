import { PLUGIN_VERSION } from "../shared/version";
import { st } from "./i18n";

const MAIN_REF_API = "https://api.github.com/repos/yuruiz/paseo-plugins/git/ref/heads/main";
const REPO_RAW = "https://raw.githubusercontent.com/yuruiz/paseo-plugins";
const REPO_API = "https://api.github.com/repos/yuruiz/paseo-plugins/contents";
const PACKAGE_PATH = "paseo-agent-usage/package.json";
const CACHE_TTL_MS = 3_600_000;
const FETCH_TIMEOUT_MS = 10_000;

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  latestCommit: string;
  updateAvailable: boolean;
  checkedAt: string;
}

let cache: { at: number; result: UpdateCheckResult } | null = null;

function parseVersion(value: string): number[] | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

async function fetchText(url: string, accept?: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "agent-usage-plugin-update-check",
        ...(accept ? { Accept: accept } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFirst(candidates: Array<{ url: string; accept?: string }>): Promise<string> {
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await fetchText(candidate.url, candidate.accept);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(st("更新检查请求失败", "Update check request failed"));
}

/** Read the collection main revision, then this plugin's package at that exact commit. */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.result;
  const reference = JSON.parse(await fetchText(MAIN_REF_API)) as { object?: { sha?: unknown } };
  const commit = typeof reference.object?.sha === "string" ? reference.object.sha : "";
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(st("仓库 main 分支缺少有效的 commit", "The repository main branch has no valid commit"));
  const packageText = await fetchFirst([
    { url: `${REPO_RAW}/${commit}/${PACKAGE_PATH}` },
    { url: `${REPO_API}/${PACKAGE_PATH}?ref=${commit}`, accept: "application/vnd.github.raw" },
  ]);
  const pkg = JSON.parse(packageText) as { version?: unknown };
  const latestVersion = typeof pkg.version === "string" ? pkg.version : "";
  if (latestVersion.length === 0) throw new Error(st("pinned package.json 缺少版本号", "The pinned package.json has no version"));
  const result: UpdateCheckResult = {
    currentVersion: PLUGIN_VERSION,
    latestVersion,
    latestCommit: commit,
    updateAvailable: compareVersions(latestVersion, PLUGIN_VERSION) > 0,
    checkedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), result };
  return result;
}
