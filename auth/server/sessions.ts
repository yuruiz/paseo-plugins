import { randomUUID } from "node:crypto";
import { active, type AuthView } from "../shared/contracts";
import type { Target } from "./target";
import { capture, launch, type Launch, type LoginProcess } from "./process";
import { failureMessage, parseOutput } from "./output";

interface Session {
  view: AuthView;
  process?: LoginProcess;
  timer?: ReturnType<typeof setTimeout>;
  buffer: string;
  touched: number;
  submitted: boolean;
}
export class AuthSessions {
  private sessions = new Map<string, Session>();
  private reports = new Map<string, NonNullable<AuthView["lastCheck"]>>();
  private checks = new Map<string, Promise<AuthView>>();
  private processes = new Set<LoginProcess>();
  private disposed = false;
  private startProcess: Launch;
  constructor(
    start: Launch = launch,
    private ttl = 10 * 60_000,
  ) {
    this.startProcess = (target, args, events) => {
      let proc: LoginProcess | undefined;
      proc = start(target, args, {
        ...events,
        exit: (code) => {
          if (proc) this.processes.delete(proc);
          events.exit(code);
        },
        error: () => {
          if (proc) this.processes.delete(proc);
          events.error();
        },
      });
      this.processes.add(proc);
      return proc;
    };
  }
  private reportKey(target: Target): string {
    return JSON.stringify([target.key, target.problem, target.missing]);
  }
  private report(
    target: Target,
    kind: "checked" | "skipped",
    view: AuthView,
    message = view.message,
  ) {
    const key = this.reportKey(target);
    this.reports.delete(key);
    this.reports.set(key, { at: Date.now(), kind, status: view.status, message });
    if (this.reports.size > 64) this.reports.delete(this.reports.keys().next().value!);
  }
  state(target: Target): AuthView {
    const lastCheck = this.reports.get(this.reportKey(target));
    if (target.problem)
      return {
        lastCheck,
        provider: target.provider,
        phase: "idle",
        status: target.missing ? "missing" : "unsupported",
        canLogin: false,
        expectsCode: false,
        message: target.problem,
      };
    const entry = this.sessions.get(target.key);
    if (entry) {
      entry.touched = Date.now();
      return { ...entry.view, lastCheck };
    }
    return {
      lastCheck,
      provider: target.provider,
      phase: "idle",
      status: "unchecked",
      canLogin: true,
      expectsCode: false,
      message: "尚未检查登录状态。",
    };
  }
  private prune() {
    for (const [key, value] of this.sessions)
      if (!active(value.view) && Date.now() - value.touched > 15 * 60_000)
        this.sessions.delete(key);
    if (this.sessions.size >= 64) {
      const oldest = [...this.sessions]
        .filter(([, s]) => !active(s.view))
        .sort((a, b) => a[1].touched - b[1].touched)[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
  }
  async check(target: Target): Promise<AuthView> {
    if (this.disposed) throw new Error("插件正在停止。");
    const currentView = this.state(target);
    if (target.problem || active(currentView)) {
      this.report(
        target,
        "skipped",
        currentView,
        target.problem ?? "登录正在进行，请完成授权后再检查。",
      );
      return this.state(target);
    }
    const pending = this.checks.get(target.key);
    if (pending) return pending;
    if (this.checks.size >= 4) throw new Error("正在检查多个账号，请稍后再试。");
    const observed = this.sessions.get(target.key);
    const work = this.inspect(target)
      .then((result) => {
        const current = this.sessions.get(target.key);
        if (current !== observed || (current && active(current.view)) || this.disposed)
          return this.state(target);
        const view = { ...this.state(target), ...result };
        if (view.phase === "succeeded" && result.status !== "authenticated") view.phase = "failed";
        this.prune();
        this.sessions.set(target.key, { view, buffer: "", touched: Date.now(), submitted: false });
        this.report(target, "checked", view);
        return this.state(target);
      })
      .finally(() => this.checks.delete(target.key));
    this.checks.set(target.key, work);
    return work;
  }
  private async inspect(target: Target): Promise<Pick<AuthView, "status" | "account" | "message">> {
    try {
      const result = await capture(
        target,
        target.provider === "claude" ? ["auth", "status"] : ["login", "status"],
        this.startProcess,
      );
      if (target.provider === "claude") {
        let data: { loggedIn?: boolean; email?: unknown; authMethod?: string };
        try {
          data = JSON.parse(result.output);
        } catch {
          return { status: "error", account: undefined, message: failureMessage(result.output) };
        }
        if (result.code === 0 && data.loggedIn === true)
          return {
            status: "authenticated",
            account: typeof data.email === "string" ? data.email.slice(0, 200) : undefined,
            message: "CLI 检测到已登录；凭据有效性以实际请求为准。",
          };
        if (data.loggedIn === false)
          return {
            status: "unauthenticated",
            account: undefined,
            message: "尚未登录或登录已失效。",
          };
      } else {
        if (result.code === 0 && /logged in/i.test(result.output))
          return {
            status: "authenticated",
            account: undefined,
            message: "CLI 检测到已登录；凭据有效性以实际请求为准。",
          };
        if (/not logged in/i.test(result.output))
          return {
            status: "unauthenticated",
            account: undefined,
            message: "尚未登录或登录已失效。",
          };
      }
      return { status: "error", account: undefined, message: failureMessage(result.output) };
    } catch {
      return {
        status: "error",
        account: undefined,
        message: "无法检查登录状态，请确认 CLI 可用后重试。",
      };
    }
  }
  start(target: Target): AuthView {
    if (this.disposed) throw new Error("插件正在停止。");
    if (target.problem) return this.state(target);
    if (active(this.state(target))) return this.state(target);
    if ([...this.sessions.values()].filter((s) => active(s.view)).length >= 4)
      throw new Error("正在进行的登录过多，请完成或取消后再试。");
    this.prune();
    this.reports.delete(this.reportKey(target));
    const entry: Session = {
      view: {
        provider: target.provider,
        phase: "starting",
        status: "unchecked",
        sessionId: randomUUID(),
        message: "正在启动登录…",
        canLogin: true,
        expectsCode: false,
        expiresAt: Date.now() + this.ttl,
      },
      buffer: "",
      touched: Date.now(),
      submitted: false,
    };
    this.sessions.set(target.key, entry);
    const current = () =>
      this.sessions.get(target.key) === entry && active(entry.view) && !this.disposed;
    entry.timer = setTimeout(() => {
      if (current()) this.finish(entry, "expired", "授权等待已超时，请重新登录。");
    }, this.ttl);
    entry.timer.unref();
    try {
      entry.process = this.startProcess(
        target,
        target.provider === "claude" ? ["auth", "login"] : ["login", "--device-auth"],
        {
          data: (text) => {
            if (!current()) return;
            entry.buffer += text;
            if (entry.buffer.length > 65536) {
              this.finish(entry, "failed", "登录输出异常，请检查 CLI 版本后重试。");
              return;
            }
            const parsed = parseOutput(entry.buffer, target.provider);
            entry.view = {
              ...entry.view,
              ...(parsed.url ? { url: parsed.url } : {}),
              ...(parsed.deviceCode ? { deviceCode: parsed.deviceCode } : {}),
              expectsCode: parsed.expectsCode && !entry.submitted,
              phase: "waiting",
              message: "请在浏览器完成授权，完成后此处会自动更新。",
            };
          },
          exit: (code) => {
            void (async () => {
              if (!current()) return;
              if (code !== 0) {
                this.finish(entry, "failed", failureMessage(entry.buffer));
                return;
              }
              entry.view = {
                ...entry.view,
                phase: "verifying",
                url: undefined,
                deviceCode: undefined,
                expectsCode: false,
                message: "正在确认登录结果…",
              };
              entry.buffer = "";
              const result = await this.inspect(target);
              if (!current()) return;
              entry.view = { ...entry.view, ...result };
              this.finish(
                entry,
                result.status === "authenticated" ? "succeeded" : "failed",
                result.status === "authenticated"
                  ? "登录成功。"
                  : "登录命令已结束，但未能确认凭据已保存，请检查状态后重试。",
              );
            })();
          },
          error: () => {
            if (current())
              this.finish(entry, "failed", "无法运行登录命令，请检查此主机的 CLI 安装。");
          },
        },
      );
    } catch {
      this.finish(entry, "failed", "无法启动登录进程。");
    }
    return this.state(target);
  }
  private entry(target: Target, id: string): Session {
    const entry = this.sessions.get(target.key);
    if (!entry || entry.view.sessionId !== id)
      throw new Error("此登录流程已失效，请刷新后重新开始。");
    return entry;
  }
  cancel(target: Target, id: string): AuthView {
    const entry = this.entry(target, id);
    if (active(entry.view)) this.finish(entry, "canceled", "登录已取消。");
    return this.state(target);
  }
  submit(target: Target, id: string, code: string): AuthView {
    const entry = this.entry(target, id);
    if (!active(entry.view) || !entry.view.expectsCode || !entry.process)
      throw new Error("当前流程不接受授权码。");
    if (!/^[A-Za-z0-9_~.\-#]{1,4096}$/.test(code))
      throw new Error("授权码格式无效，请只粘贴网页显示的授权码。");
    entry.process.write(code);
    entry.submitted = true;
    entry.buffer = "";
    entry.view.expectsCode = false;
    entry.view.message = "授权码已提交，等待登录完成…";
    return this.state(target);
  }
  authenticated(target: Target, id: string): boolean {
    const view = this.entry(target, id).view;
    return view.phase === "succeeded" && view.status === "authenticated";
  }
  private finish(entry: Session, phase: AuthView["phase"], message: string) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.process?.stop();
    entry.buffer = "";
    entry.view = {
      ...entry.view,
      phase,
      message,
      url: undefined,
      deviceCode: undefined,
      expectsCode: false,
      expiresAt: undefined,
    };
    entry.touched = Date.now();
  }
  async dispose() {
    this.disposed = true;
    for (const entry of this.sessions.values())
      if (active(entry.view)) this.finish(entry, "canceled", "插件已停止，请重新登录。");
    for (const proc of this.processes) proc.stop();
    await Promise.allSettled(this.checks.values());
    this.sessions.clear();
    this.reports.clear();
    this.processes.clear();
  }
}
