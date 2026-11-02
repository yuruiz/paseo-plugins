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
      throw new Error("Auth supports Claude Code and Codex sessions.");
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
    if (recoveryLocks.has(input.agentId))
      throw new Error("This session is being recovered. Please wait.");
    recoveryLocks.add(input.agentId);
    try {
      const target = await resolveTarget(input, context);
      if (!sessions.authenticated(target, input.sessionId))
        throw new Error("Complete sign-in first, then recover the session.");
      const ref = context.paseo.agents.ref(input.agentId);
      const snapshot = await ref.refresh();
      const agent = snapshot?.agent;
      if (!agent || agent.archivedAt)
        throw new Error("This session no longer exists or has been archived.");
      if (
        agent.status === "running" ||
        agent.status === "initializing" ||
        agent.activeTurn ||
        agent.pendingPermissions.length
      )
        throw new Error(
          "This session is running or waiting for an action. Let it stop before recovering it.",
        );
      const previous = recovered.get(input.agentId);
      if (input.action === "reload") {
        if (previous?.sessionId !== input.sessionId) {
          const result = await ref.reload();
          if (!result?.agent || result.agent.status === "error")
            throw new Error("Could not reload the session. Review its error and try again.");
          if (recovered.size > 500) recovered.delete(recovered.keys().next().value!);
          recovered.set(input.agentId, { sessionId: input.sessionId, continued: false });
          reported.delete(input.agentId);
        }
        return { reloaded: true, message: "Session reloaded. You can now continue the task." };
      }
      if (previous?.sessionId !== input.sessionId)
        throw new Error("Reload the current session first.");
      if (!previous.continued) {
        // Mark before sending: a lost acknowledgement must not duplicate an already delivered task.
        previous.continued = true;
        await ref.send(
          "Continue the previous task that was interrupted by an authentication failure. Check which steps have already completed before proceeding to avoid repeating actions.",
        );
      }
      return { reloaded: true, message: "The request to continue the task has been sent." };
    } finally {
      recoveryLocks.delete(input.agentId);
    }
  });
  return () => sessions.dispose();
}
