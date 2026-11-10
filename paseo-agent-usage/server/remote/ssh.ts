import { execCommand, spawnProcess, terminateProcess } from "@getpaseo/plugin/server";
import { st } from "../i18n";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { COLLECTOR_SCRIPT } from "./collector.script";

export interface HostConfig {
  name: string;
  target: string;
  enabled: boolean;
  port?: number;
  identityFile?: string;
  password?: string;
  passwordCommand?: string;
  nodePath?: string;
  cacheDir?: string;
  timeoutMs?: number;
}

export interface HostPullResult {
  ok: boolean;
  error: string | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const MAX_STDOUT_BYTES = 96 * 1024 * 1024;
const MAX_STDERR_BYTES = 512 * 1024;

export function parseHostsConfig(text: string): HostConfig[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    const hosts: HostConfig[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : null;
      const target = typeof record.target === "string" && record.target.trim() ? record.target.trim() : null;
      if (!name || !target || target.startsWith("-")) continue;
      hosts.push({
        name,
        target,
        enabled: record.enabled !== false,
        port: typeof record.port === "number" && record.port > 0 ? record.port : undefined,
        identityFile: typeof record.identityFile === "string" && record.identityFile ? record.identityFile : undefined,
        password: typeof record.password === "string" && record.password ? record.password : undefined,
        passwordCommand: typeof record.passwordCommand === "string" && record.passwordCommand ? record.passwordCommand : undefined,
        nodePath: typeof record.nodePath === "string" && record.nodePath ? record.nodePath : undefined,
        cacheDir: typeof record.cacheDir === "string" && record.cacheDir ? record.cacheDir : undefined,
        timeoutMs: typeof record.timeoutMs === "number" && record.timeoutMs > 0 ? record.timeoutMs : undefined,
      });
    }
    return hosts;
  } catch {
    return [];
  }
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function ensureAskpass(pluginDataDir: string): Promise<string> {
  await mkdir(pluginDataDir, { recursive: true, mode: 0o700 }).catch(() => {});
  const path = join(pluginDataDir, "ssh-askpass.sh");
  await writeFile(path, "#!/bin/sh\nprintf '%s' \"$AGENT_USAGE_SSH_PASSWORD\"\n", { mode: 0o700 });
  await chmod(path, 0o700).catch(() => {});
  return path;
}

async function resolvePassword(host: HostConfig): Promise<{ password: string | null; error: string | null }> {
  // passwordCommand is an explicit authentication choice; it must not be
  // shadowed by a stale stored password.
  if (host.passwordCommand) {
    try {
      const { stdout } = await execCommand("/bin/sh", ["-c", host.passwordCommand], { timeout: 15000, maxBuffer: 1024 * 1024 });
      const value = stdout.trim();
      return value ? { password: value, error: null } : { password: null, error: st(`passwordCommand 没有输出（${host.name}）`, `passwordCommand produced no output (${host.name})`) };
    } catch (error) {
      return { password: null, error: st(`passwordCommand 执行失败（${host.name}）：${error instanceof Error ? error.message : String(error)}`, `passwordCommand failed (${host.name}): ${error instanceof Error ? error.message : String(error)}`) };
    }
  }
  if (host.password) return { password: host.password, error: null };
  return { password: null, error: null };
}

/** Finds a usable JS runtime without requiring any remote setup. */
function runtimePrefix(host: HostConfig): string {
  if (host.nodePath) return `rt=${shellQuote(host.nodePath)}`;
  return [
    `rt=""`,
    `if command -v node >/dev/null 2>&1; then rt="$(command -v node)"; fi`,
    `if [ -z "$rt" ]; then p="$(sh -c 'ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V 2>/dev/null | tail -1 || true')"; [ -n "$p" ] || p="$(sh -c 'ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1 || true')"; [ -n "$p" ] && [ -x "$p" ] && rt="$p"; fi`,
    `if [ -z "$rt" ]; then p="$HOME/.volta/bin/node"; [ -x "$p" ] && rt="$p"; fi`,
    `if [ -z "$rt" ]; then p="$(sh -c 'ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node "$HOME"/.local/state/fnm_multishells/*/bin/node 2>/dev/null | tail -1 || true')"; [ -n "$p" ] && [ -x "$p" ] && rt="$p"; fi`,
    `if [ -z "$rt" ]; then p="$HOME/.asdf/shims/node"; [ -x "$p" ] && rt="$p"; fi`,
    `if [ -z "$rt" ]; then p="$HOME/.local/bin/node"; [ -x "$p" ] && rt="$p"; fi`,
    `for p in /opt/homebrew/bin/node /usr/local/bin/node /opt/local/bin/node /snap/bin/node; do if [ -z "$rt" ] && [ -x "$p" ]; then rt="$p"; fi; done`,
    `if [ -z "$rt" ] && [ -f "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; if command -v node >/dev/null 2>&1; then rt="$(command -v node)"; fi; fi`,
    `if [ -n "$rt" ] && ! "$rt" -v >/dev/null 2>&1; then rt=""; fi`,
    `if [ -z "$rt" ]; then echo "agent-usage: no JS runtime found (searched PATH, nvm, volta, fnm, asdf, homebrew, /usr/local). Set nodePath in the host config if node lives elsewhere." >&2; exit 127; fi`,
  ].join("\n");
}

function remoteCommand(host: HostConfig): string {
  let command = `${runtimePrefix(host)}\nexec "$rt" -`;
  if (host.cacheDir) {
    const value = host.cacheDir;
    const safe = /^~\/[\w@%+=:,./-]+$/.test(value) ? value : shellQuote(value);
    command += ` --cache-dir ${safe}`;
  }
  return command;
}

function cleanSshError(exitCode: number | null, stderr: string): string {
  if (/command not found/.test(stderr)) return st("远端缺少可用的 JS 运行时（可在主机配置里指定 nodePath）", "Remote has no usable JS runtime (set nodePath in the host config)");
  if (/Permission denied/.test(stderr)) return st("SSH 认证失败（检查密码 / 密钥配置）", "SSH authentication failed (check password/key settings)");
  if (/Host key verification failed/.test(stderr)) return st("SSH Host Key 校验失败", "SSH host key verification failed");
  const tail = stderr.trim().split("\n").map((line) => line.trim()).filter(Boolean).slice(-2).join(" | ");
  return tail ? tail.slice(0, 400) : `ssh exited with code ${exitCode}`;
}

interface SshExecOptions {
  timeoutMs: number;
  maxBytes: number;
  stdin?: string;
}

async function executeSsh(host: HostConfig, pluginDataDir: string, command: string, options: SshExecOptions): Promise<HostPullResult> {
  const args: string[] = ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4"];
  if (host.port) args.push("-p", String(host.port));
  if (host.identityFile) args.push("-i", expandHome(host.identityFile));
  const env: NodeJS.ProcessEnv = { ...process.env };
  const { password, error: passwordError } = await resolvePassword(host);
  if (passwordError) return { ok: false, error: passwordError, stdout: "", stderr: "", exitCode: null };
  if (password) {
    const askpass = await ensureAskpass(pluginDataDir);
    args.push("-o", "BatchMode=no", "-o", "NumberOfPasswordPrompts=1", "-o", "PreferredAuthentications=password,keyboard-interactive");
    env.SSH_ASKPASS = askpass;
    env.SSH_ASKPASS_REQUIRE = "force";
    env.DISPLAY = env.DISPLAY || ":0";
    env.AGENT_USAGE_SSH_PASSWORD = password;
  } else {
    args.push("-o", "BatchMode=yes");
  }
  args.push(host.target, command);
  const timeoutMs = options.timeoutMs;

  return await new Promise<HostPullResult>((resolve) => {
    let child;
    try {
      child = spawnProcess("ssh", args, { stdio: "pipe", env });
    } catch (error) {
      resolve({ ok: false, error: st(`无法启动 ssh：${error instanceof Error ? error.message : String(error)}`, `Failed to start ssh: ${error instanceof Error ? error.message : String(error)}`), stdout: "", stderr: "", exitCode: null });
      return;
    }
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let settled = false;
    const finish = (result: HostPullResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      void terminateProcess(child).catch(() => {});
      finish({ ok: false, error: st(`拉取超时（${Math.round(timeoutMs / 1000)}s）`, `Pull timed out (${Math.round(timeoutMs / 1000)}s)`), stdout: "", stderr: stderr.slice(-400), exitCode: null });
    }, timeoutMs);
    timer.unref?.();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > options.maxBytes) {
        void terminateProcess(child).catch(() => {});
        finish({ ok: false, error: st("采集器输出超过大小上限", "Collector output exceeded the size limit"), stdout: "", stderr: stderr.slice(-400), exitCode: null });
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > MAX_STDERR_BYTES) stderr = stderr.slice(-MAX_STDERR_BYTES);
    });
    child.on("error", (error) => {
      finish({ ok: false, error: st(`ssh 进程错误：${error.message}`, `ssh process error: ${error.message}`), stdout: "", stderr: "", exitCode: null });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ ok: true, error: null, stdout, stderr, exitCode: code });
      } else {
        finish({ ok: false, error: cleanSshError(code, stderr), stdout: "", stderr, exitCode: code });
      }
    });
    child.stdin.on("error", () => {});
    if (options.stdin) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

export async function pullHost(host: HostConfig, pluginDataDir: string): Promise<HostPullResult> {
  return await executeSsh(host, pluginDataDir, remoteCommand(host), {
    timeoutMs: host.timeoutMs ?? 180000,
    maxBytes: MAX_STDOUT_BYTES,
    stdin: COLLECTOR_SCRIPT,
  });
}

export interface HostTestResult {
  ok: boolean;
  detail: string;
}

/** Runs an arbitrary diagnostic script on the host (used by dev probes). */
export async function probeHost(host: HostConfig, pluginDataDir: string, script: string, timeoutMs = 120000): Promise<HostPullResult> {
  return await executeSsh(host, pluginDataDir, `${runtimePrefix(host)}\n${script}`, { timeoutMs, maxBytes: 2 * 1024 * 1024 });
}

/** Light connectivity probe: verifies ssh login, `node -v`, and which log roots exist. */
export async function testHost(host: HostConfig, pluginDataDir: string): Promise<HostTestResult> {
  const command = [
    runtimePrefix(host),
    `echo "runtime: $rt"`,
    `"$rt" -v 2>&1`,
    `for d in ~/.claude/projects ~/.codex/sessions ~/.pi/agent/sessions; do [ -d "$d" ] && echo "found $d"; done`,
  ].join("\n");
  const result = await executeSsh(host, pluginDataDir, command, { timeoutMs: 25000, maxBytes: 256 * 1024 });
  if (!result.ok) return { ok: false, detail: result.error ?? st("连接失败", "Connection failed") };
  const output = `${result.stdout}${result.stderr}`.trim();
  const hasNode = /^v\d+\./m.test(output);
  return { ok: hasNode, detail: output.slice(0, 1200) || st("（无输出）", "(no output)") };
}
