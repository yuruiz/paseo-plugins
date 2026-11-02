import { createHash } from "node:crypto";
import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  CARD_KIND,
  getState,
  checkStatus,
  startLogin,
  cancelLogin,
  submitCode,
  showCard,
  recover,
  type Scope,
  type AuthView,
} from "./shared/contracts";
import { needsLogin } from "./shared/detection";
import { resolveTarget, providerOf } from "./server/target";
import { AuthSessions } from "./server/sessions";

export default function contribute(server: PluginServerContext) {
  const sessions = new AuthSessions();
  const reported = new Map<string, string>();
  const recovered = new Map<string, { sessionId: string; continued: boolean }>();
  const recoveryLocks = new Set<string>();
  function present(input: Scope, view: AuthView): AuthView {
    const record = input.agentId ? recovered.get(input.agentId) : undefined;
    return {
      ...view,
      reloaded: Boolean(record && record.sessionId === view.sessionId),
      continued: Boolean(record && record.sessionId === view.sessionId && record.continued),
    };
  }
  async function publish(
    agentId: string,
    automatic: boolean,
    context: PluginHandlerContext,
    failure?: { message: string; code?: string },
  ) {
    const ref = context.paseo.agents.ref(agentId);
    const snapshot = await ref.refresh();
    const agent = snapshot?.agent;
    if (!agent || agent.archivedAt) return { shown: false };
    const error = failure ?? { message: agent.lastError ?? "" };
    if (automatic && !needsLogin(error.message, error.code)) return { shown: false };
    const { config } = await context.paseo.config.get();
    const provider = providerOf(agent.provider, config.providers);
    if (!provider) {
      if (automatic) return { shown: false };
      throw new Error("Auth 支持 Claude Code 和 Codex 会话。");
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([agent.provider, error]))
      .digest("hex");
    if (automatic && reported.get(agentId) === fingerprint) return { shown: true };
    await ref.timeline.append({
      type: "plugin",
      id: "auth",
      kind: CARD_KIND,
      version: 1,
      data: { provider, reason: automatic ? "required" : "manual" },
    });
    if (reported.size > 500) reported.delete(reported.keys().next().value!);
    reported.set(agentId, fingerprint);
    return { shown: true };
  }
  server.handle(getState, async (input, context) =>
    present(input, sessions.state(await resolveTarget(input, context))),
  );
  server.handle(checkStatus, async (input, context) =>
    present(input, await sessions.check(await resolveTarget(input, context))),
  );
  server.handle(startLogin, async (input, context) =>
    present(input, sessions.start(await resolveTarget(input, context))),
  );
  server.handle(cancelLogin, async (input, context) =>
    present(input, sessions.cancel(await resolveTarget(input, context), input.sessionId)),
  );
  server.handle(submitCode, async (input, context) =>
    present(
      input,
      sessions.submit(await resolveTarget(input, context), input.sessionId, input.code),
    ),
  );
  server.handle(showCard, (input, context) => publish(input.agentId, input.automatic, context));
  server.on("agent.turn_ended", async (event, context) => {
    if (
      event.outcome.kind === "failed" &&
      needsLogin(event.outcome.error.message, event.outcome.error.code)
    )
      await publish(event.agent.id, true, context, event.outcome.error);
    else if (event.outcome.kind === "completed") reported.delete(event.agent.id);
  });
  server.on("agent.archived", ({ agent }) => {
    reported.delete(agent.id);
    recovered.delete(agent.id);
  });
  server.handle(recover, async (input, context) => {
    if (recoveryLocks.has(input.agentId)) throw new Error("此会话正在恢复，请稍候。");
    recoveryLocks.add(input.agentId);
    try {
      const target = await resolveTarget(input, context);
      if (!sessions.authenticated(target, input.sessionId))
        throw new Error("请先完成登录，再恢复会话。");
      const ref = context.paseo.agents.ref(input.agentId);
      const snapshot = await ref.refresh();
      const agent = snapshot?.agent;
      if (!agent || agent.archivedAt) throw new Error("此会话已不存在或已归档。");
      if (
        agent.status === "running" ||
        agent.status === "initializing" ||
        agent.activeTurn ||
        agent.pendingPermissions.length
      )
        throw new Error("此会话正在运行或等待操作，请先让它停止后再恢复。");
      const previous = recovered.get(input.agentId);
      if (input.action === "reload") {
        if (previous?.sessionId !== input.sessionId) {
          const result = await ref.reload();
          if (!result?.agent || result.agent.status === "error")
            throw new Error("会话重新加载失败，请查看当前会话错误后重试。");
          if (recovered.size > 500) recovered.delete(recovered.keys().next().value!);
          recovered.set(input.agentId, { sessionId: input.sessionId, continued: false });
          reported.delete(input.agentId);
        }
        return { reloaded: true, message: "会话已重新加载。你可以继续任务。" };
      }
      if (previous?.sessionId !== input.sessionId) throw new Error("请先重新加载当前会话。");
      if (!previous.continued) {
        // Mark before sending: a lost acknowledgement must not duplicate an already delivered task.
        previous.continued = true;
        await ref.send(
          "请继续上一个因认证失败而中断的任务。先检查已经完成的步骤，避免重复执行操作。",
        );
      }
      return { reloaded: true, message: "已发送继续任务的请求。" };
    } finally {
      recoveryLocks.delete(input.agentId);
    }
  });
  return () => sessions.dispose();
}
