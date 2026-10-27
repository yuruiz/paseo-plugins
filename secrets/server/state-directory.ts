import { homedir } from "node:os";
import path from "node:path";

export function resolveStateDirectory(env: NodeJS.ProcessEnv = process.env) {
  // Plugin subprocesses inherit the daemon environment, which may omit the default home.
  let home = env.PASEO_HOME ?? "~/.paseo";
  if (home === "~") home = homedir();
  else if (home.startsWith("~/")) home = path.join(homedir(), home.slice(2));
  return path.resolve(home, "plugin-state", "secrets-mcp");
}
