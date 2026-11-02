import { stripVTControlCharacters } from "node:util";
import type { Provider } from "../shared/contracts";

// CLI output is untrusted. Only official authorization pages become clickable links.
export function authUrl(raw: string, provider: Provider): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return;
    const hosts =
      provider === "codex"
        ? ["auth.openai.com", "auth0.openai.com"]
        : ["claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com"];
    if (!hosts.includes(url.hostname)) return;
    if (!/(?:^|\/)(?:oauth|authorize|deviceauth|device)(?:\/|$)/.test(url.pathname)) return;
    return url.href;
  } catch {
    return;
  }
}
export function parseOutput(raw: string, provider: Provider) {
  const text = stripVTControlCharacters(raw);
  let url: string | undefined;
  // eslint-disable-next-line no-control-regex -- exclude terminal control bytes from links
  for (const match of text.matchAll(/https:\/\/[^\s<>"\x00-\x1f]+/g)) {
    const candidate = authUrl(match[0], provider);
    const end = (match.index ?? 0) + match[0].length;
    if (candidate && end < text.length) url = candidate;
  }
  const deviceCode =
    provider === "codex" ? /\b([A-Z0-9]{4}-[A-Z0-9]{4,5})\b/.exec(text)?.[1] : undefined;
  return {
    url,
    deviceCode,
    expectsCode: provider === "claude" && /paste (?:the )?code here/i.test(text),
  };
}
// Raw output can contain tokens, echoed codes, paths or unrelated secrets.
export function failureMessage(raw: string): string {
  const text = stripVTControlCharacters(raw);
  if (/device.{0,40}(?:disabled|not enabled|not allowed)|enable.{0,30}device/i.test(text))
    return "请在 ChatGPT 安全设置中启用设备码登录；组织账号可能需要管理员允许。";
  if (/expired|timed? ?out/i.test(text)) return "授权已过期，请重新开始登录。";
  if (/ENOTFOUND|ECONN|fetch failed|network|certificate|TLS/i.test(text))
    return "无法连接认证服务，请检查主机网络或证书配置后重试。";
  if (/unknown (?:option|command)|unexpected argument/i.test(text))
    return "当前 CLI 不支持此登录命令，请更新对应的 Claude Code 或 Codex CLI。";
  if (/denied|access_denied|canceled|cancelled/i.test(text))
    return "授权被取消或拒绝，请重新登录。";
  return "登录未完成。请重新尝试，并确认账号与组织允许使用此登录方式。";
}
