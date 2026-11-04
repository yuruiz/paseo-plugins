function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveProvider(
  id: string,
  providers: Record<string, unknown>,
  baseEnv: NodeJS.ProcessEnv = process.env,
) {
  let provider = id;
  const env = new Map<string, string>();
  const visited = new Set<string>();
  while (true) {
    if (visited.has(provider)) throw new Error(`Circular provider inheritance: ${id}`);
    visited.add(provider);
    const config = object(providers[provider]);
    for (const [key, value] of Object.entries(object(config.env))) {
      if (typeof value === "string" && !env.has(key)) env.set(key, value);
    }
    // ACP is a transport, not a provider with its own discovery directories.
    if (typeof config.extends !== "string" || config.extends === "acp") break;
    provider = config.extends;
  }
  return { provider, env: { ...baseEnv, ...Object.fromEntries(env) } };
}
