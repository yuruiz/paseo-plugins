export const supportedProviders = ["codex", "claude", "opencode", "copilot"];

interface LoopbackEnvironment {
  env: Record<string, string>;
  inheritedEnv?: NodeJS.ProcessEnv;
  providerEnv?: Record<string, string>;
}

export function withLoopbackBypass({
  env,
  inheritedEnv = process.env,
  providerEnv = {},
}: LoopbackEnvironment) {
  const entries = new Set<string>();
  for (const source of [inheritedEnv, providerEnv, env]) {
    for (const key of ["NO_PROXY", "no_proxy"]) {
      for (const entry of (source[key] ?? "").split(",")) {
        const trimmed = entry.trim();
        if (trimmed) entries.add(trimmed);
      }
    }
  }
  // The agent talks to the loopback MCP server directly; only Connect's outbound calls use its proxy.
  for (const host of ["127.0.0.1", "localhost", "::1"]) entries.add(host);
  const exclusions = [...entries].join(",");
  return { ...env, NO_PROXY: exclusions, no_proxy: exclusions };
}
