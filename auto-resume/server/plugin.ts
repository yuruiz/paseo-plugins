import type { PluginServerContext } from "@getpaseo/plugin/server";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { cancelRpc, configureRpc, scheduleRpc, statusRpc } from "../shared/contracts";
import { isQuotaError, latestOutput } from "./detect";
import { ResumeEngine } from "./engine";
import { PaseoGateway } from "./gateway";
import { Store } from "./store";

export function contributeServer(server: PluginServerContext) {
  const lifetime = new AbortController();
  let gateway: PaseoGateway;
  let engine: ResumeEngine | undefined;
  let closed = false;
  const ready = (async () => {
    const home = await realpath(process.env.PASEO_HOME || join(homedir(), ".paseo"));
    const directory = process.env.AUTO_RESUME_DATA_DIR || join(home, "plugin-data", "auto-resume");
    if (!isAbsolute(directory)) throw new Error("AUTO_RESUME_DATA_DIR must be absolute");
    const temporary = join(directory, "tmp");
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    gateway = new PaseoGateway(home, temporary, lifetime.signal);
    const store = await Store.open(directory, home);
    engine = new ResumeEngine(store, gateway);
    if (closed) {
      await engine.stop();
      return;
    }
    await engine.start();
    console.log("Auto-resume ready; automatic recovery is opt-in per conversation.");
  })();
  void ready.catch((error) =>
    console.error(
      "Auto-resume initialization failed:",
      error instanceof Error ? error.message : "unknown error",
    ),
  );
  async function context(paseo: Parameters<PaseoGateway["attach"]>[0]) {
    await ready;
    if (closed || !engine) throw new Error("Auto-resume is not running");
    gateway.attach(paseo);
    return engine;
  }
  server.handle(statusRpc, async ({ agentId }, { paseo }) => (await context(paseo)).view(agentId));
  server.handle(configureRpc, async ({ agentId, preferences }, { paseo }) =>
    (await context(paseo)).configure(agentId, preferences),
  );
  server.handle(scheduleRpc, async ({ agentId, jobId, resetAt }, { paseo }) =>
    (await context(paseo)).schedule(agentId, jobId, resetAt),
  );
  server.handle(cancelRpc, async ({ agentId, jobId }, { paseo }) =>
    (await context(paseo)).cancel(agentId, jobId),
  );

  // The published 0.14 SDK still exposes these supported lifecycle aliases.
  // Notifications run in the daemon subprocess, independent of open app windows.
  const removers = [
    server.on("agent.turn_started", async ({ agent }, { paseo }) => {
      const running = engine;
      if (running) await running.started(agent.id);
      await context(paseo);
    }),
    server.on("agent.turn_ended", async (event, { paseo }) => {
      const service = await context(paseo);
      if (!["claude", "codex"].includes(event.agent.provider)) return;
      if (event.outcome.kind === "canceled") {
        await service.cancel(
          event.agent.id,
          undefined,
          "The turn was canceled. The pending recovery has been canceled.",
        );
        return;
      }
      const failure = event.outcome.kind === "failed" ? event.outcome.error : null;
      let text = failure?.message ?? "";
      if (!isQuotaError(text, failure?.code)) {
        const page = await paseo.agents
          .ref(event.agent.id)
          .timeline.refetch({ direction: "tail", limit: 100 });
        const output = latestOutput(page.entries.map(({ item }) => item));
        // A completed assistant explanation about limits is not a provider failure.
        const terseNotice =
          output.length < 800 &&
          /^(?:⚠\s*|error[:：]\s*|api error[:：]\s*)?(?:you(?:'|’)ve (?:hit|reached)|usage limit|out of credits|额度|配额)/i.test(
            output,
          );
        if (terseNotice) text = `${text}\n${output}`.trim();
      }
      if (isQuotaError(text, failure?.code)) {
        const snapshot = await paseo.agents.ref(event.agent.id).refresh();
        const key = createHash("sha256")
          .update(JSON.stringify([event.turnId, snapshot?.agent.lastUserMessageAt, text]))
          .digest("hex");
        await service.detect({
          agentId: event.agent.id,
          workspaceId: event.agent.workspaceId,
          provider: event.agent.provider,
          text,
          key,
        });
      } else await service.completed(event.agent.id);
    }),
    server.on("agent.archived", async ({ agent }, { paseo }) => {
      await (
        await context(paseo)
      ).cancel(
        agent.id,
        undefined,
        "The conversation was archived. The pending recovery has been canceled.",
      );
    }),
    server.on("workspace.archived", async ({ workspace }, { paseo }) => {
      const service = await context(paseo);
      for (const job of Object.values(service.store.snapshot().jobs))
        if (job.workspaceId === workspace.id)
          await service.cancel(
            job.agentId,
            job.id,
            "The workspace was archived. The pending recovery has been canceled.",
          );
    }),
  ];
  return async () => {
    closed = true;
    removers.forEach((remove) => remove());
    lifetime.abort();
    await ready.catch(() => {});
    if (engine) await engine.stop();
  };
}
