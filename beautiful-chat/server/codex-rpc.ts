import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function withCodex<T>(env: NodeJS.ProcessEnv, cwd: string, action: (
  request: <R>(method: string, params: unknown) => Promise<R>,
) => Promise<T>): Promise<T> {
  const child = spawn("codex", ["app-server", "--listen", "stdio://"], { cwd, env, stdio: "pipe" });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  let nextId = 0;
  let failure: Error | undefined;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  function fail(error: Error) {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  const exited = new Promise<void>((resolve) => child.once("close", () => {
    fail(new Error("Codex app-server exited before completing the fork"));
    resolve();
  }));
  child.on("error", fail);
  child.stdin.on("error", fail);
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) {
        child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: "Fork does not run tools" } }) + "\n");
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message ?? "Codex request failed"));
      else request.resolve(message.result);
    } catch {
      fail(new Error("Invalid Codex app-server response"));
    }
  });
  const request = <R>(method: string, params: unknown): Promise<R> => new Promise((resolve, reject) => {
    if (failure) return reject(failure);
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Codex ${method} timed out`));
    }, 20_000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value as R); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  try {
    await request("initialize", {
      clientInfo: { name: "beautiful-chat", version: "0.1.1" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
    return await action(request);
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
    await exited;
    clearTimeout(timer);
    lines.close();
  }
}
