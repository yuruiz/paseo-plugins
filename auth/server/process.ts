import { spawn } from "node:child_process";
import type { Target } from "./target";
export interface LoginProcess {
  write(code: string): void;
  stop(): void;
}
export interface ProcessEvents {
  data(text: string): void;
  exit(code: number | null): void;
  error(): void;
}
export type Launch = (target: Target, args: string[], events: ProcessEvents) => LoginProcess;
export const launch: Launch = (target, args, events) => {
  const child = spawn(target.command, args, {
    cwd: target.cwd,
    env: { ...target.env, BROWSER: "/usr/bin/true", NO_COLOR: "1", FORCE_COLOR: "0" },
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let ended = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  const signal = (name: NodeJS.Signals) => {
    if (child.pid) {
      try {
        process.kill(-child.pid, name);
      } catch {
        /* Already gone. */
      }
    }
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", events.data);
  child.stderr.on("data", events.data);
  child.stdin.on("error", () => {
    if (!ended) events.error();
  });
  child.on("error", () => {
    if (!ended) {
      ended = true;
      events.error();
    }
  });
  child.on("close", (code) => {
    if (killer) clearTimeout(killer);
    if (!ended) {
      ended = true;
      events.exit(code);
    }
  });
  return {
    write(code) {
      if (ended || !child.stdin.writable)
        throw new Error("The sign-in process has ended. Start again.");
      child.stdin.write(code + "\n");
    },
    stop() {
      if (ended) return;
      signal("SIGTERM");
      if (!killer) {
        killer = setTimeout(() => {
          signal("SIGKILL");
          child.stdout.destroy();
          child.stderr.destroy();
        }, 1500);
        killer.unref();
      }
    },
  };
};
export function capture(
  target: Target,
  args: string[],
  start: Launch = launch,
  timeoutMs = 12_000,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    let proc: LoginProcess | undefined;
    const finish = (result?: { code: number | null; output: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result) resolve(result);
      else reject(new Error("Could not check sign-in status. Check the CLI and host network."));
    };
    const timer = setTimeout(() => {
      proc?.stop();
      finish();
    }, timeoutMs);
    try {
      proc = start(target, args, {
        data(text) {
          if (settled) return;
          output += text;
          if (output.length > 65536) {
            proc?.stop();
            finish();
          }
        },
        exit(code) {
          finish({ code, output });
        },
        error() {
          proc?.stop();
          finish();
        },
      });
    } catch {
      finish();
    }
  });
}
