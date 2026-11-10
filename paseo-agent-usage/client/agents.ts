export const AGENT_COLORS: Record<string, string> = {
  claude: "#D97757",
  codex: "#4C8DFF",
  opencode: "#3E9B72",
  pi: "#8F6FD1",
};

export const AGENT_SHORT: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};

export const FALLBACK_COLOR = "#8A8F96";

export const TOKEN_COLORS = {
  cacheRead: "#5B8C7B",
  cacheWrite: "#7C9CB8",
  input: "#8A7FA8",
  output: "#C07A4E",
  reasoning: "#9A958C",
} as const;

export const COST_COLOR = "#A9853F";

export function agentColor(id: string): string {
  return AGENT_COLORS[id] ?? FALLBACK_COLOR;
}

export function agentShort(id: string): string {
  return AGENT_SHORT[id] ?? id;
}
