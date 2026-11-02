import { describe, it, expect } from "vitest";
import { capture, launch } from "./process";
import type { Target } from "./target";
const target: Target = {
  key: "child",
  provider: "claude",
  command: process.execPath,
  cwd: process.cwd(),
  env: process.env,
};
describe("CLI process adapter", () => {
  it("captures a real subprocess without a shell", async () => {
    const result = await capture(target, [
      "-e",
      "process.stdout.write(JSON.stringify({loggedIn:true}));",
    ]);
    expect(result).toEqual({ code: 0, output: '{"loggedIn":true}' });
  });
  it("passes an authorization code through stdin and collects process exit", async () => {
    let output = "";
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = launch(
        target,
        ["-e", "process.stdin.once('data',data=>{process.stdout.write(data);process.exit(0)});"],
        {
          data: (text) => (output += text),
          exit: resolve,
          error: () => reject(new Error("spawn failed")),
        },
      );
      child.write("sample#state");
    });
    expect(code).toBe(0);
    expect(output).toBe("sample#state\n");
  });
  it("terminates commands that exceed a status-check deadline", async () => {
    await expect(capture(target, ["-e", "setInterval(()=>{},1000)"], launch, 50)).rejects.toThrow(
      "无法检查",
    );
  });
  it("handles a missing executable without exposing raw process errors", async () => {
    await expect(capture({ ...target, command: "/nonexistent/auth-cli" }, [])).rejects.toThrow(
      "无法检查",
    );
  });
});
