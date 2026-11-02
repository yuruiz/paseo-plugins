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
    return "Enable device code sign-in in ChatGPT security settings. Organization accounts may require administrator approval.";
  if (/expired|timed? ?out/i.test(text)) return "Authorization expired. Start sign-in again.";
  if (/ENOTFOUND|ECONN|fetch failed|network|certificate|TLS/i.test(text))
    return "Could not connect to the authentication service. Check the host network or certificate settings and try again.";
  if (/unknown (?:option|command)|unexpected argument/i.test(text))
    return "This CLI version does not support the sign-in command. Update Claude Code or Codex.";
  if (/denied|access_denied|canceled|cancelled/i.test(text))
    return "Authorization was canceled or denied. Sign in again.";
  return "Sign-in did not complete. Try again and make sure your account and organization allow this sign-in method.";
}
