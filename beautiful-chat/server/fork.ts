import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";
import { forkRpc } from "../shared/fork-rpc";
import { withDaemon } from "./daemon";
import { forkClaude, forkCodex } from "./native-fork";

type Input = RpcInput<typeof forkRpc>;
type Result = RpcOutput<typeof forkRpc>;
type Attempt = { identity: string; sessionId?: string; result?: Result; pending?: Promise<Result> };
const attempts = new Map<string, Attempt>();
const requestLabel = "beautiful-chat.fork-request";
const sourceLabel = "beautiful-chat.fork-source";

async function performFork(input: Input, attempt: Attempt): Promise<Result> {
  return withDaemon(input.hostId, async (client, home) => {
    const source = (await client.fetchAgent({ agentId: input.agentId }))?.agent;
    if (!source) throw new Error("Source conversation not found");
    if (!source.workspaceId) throw new Error("The source conversation has no workspace");
    if (source.provider !== "codex" && source.provider !== "claude") {
      throw new Error("Native fork currently supports the built-in Codex and Claude providers");
    }
    const labels = { [requestLabel]: input.requestId, [sourceLabel]: source.id };
    const previous = (await client.fetchAgents({ filter: { labels }, page: { limit: 1 } })).entries[0]?.agent;
    let imported = previous;
    if (!imported) {
      if (source.status === "running" || source.status === "initializing" || source.activeTurn) {
        throw new Error("Wait for this conversation to finish before forking");
      }
      const sessionId = source.persistence?.nativeHandle ?? source.persistence?.sessionId;
      if (!sessionId || !z.string().uuid().safeParse(sessionId).success) throw new Error("The source has no native session ID");
      if (!attempt.sessionId) {
        const config = JSON.parse(await readFile(path.join(home, "config.json"), "utf8"));
        const provider = config.agents?.providers?.[source.provider];
        if (provider?.command) throw new Error("Native fork does not yet support custom provider commands");
        const env = { ...process.env };
        for (const [key, value] of Object.entries(provider?.env ?? {})) {
          if (value === null) delete env[key];
          else if (typeof value === "string") env[key] = value;
        }
        attempt.sessionId = await (source.provider === "codex" ? forkCodex : forkClaude)({
          sessionId, messageId: input.messageId, cwd: source.cwd, model: source.model, env,
          pluginDirectory: config.plugins?.["beautiful-chat"]?.path,
        });
      }
      imported = await client.importAgent({
        provider: source.provider, sessionId: attempt.sessionId,
        cwd: source.cwd, workspaceId: source.workspaceId, labels,
      });
    }
    if (imported.workspaceId !== source.workspaceId) throw new Error("The fork was imported into an unexpected workspace");
    await client.applyAgentConfig(imported.id, {
      modelId: source.model,
      ...(source.currentModeId ? { modeId: source.currentModeId } : {}),
      ...(source.thinkingOptionId !== undefined ? { thinkingOptionId: source.thinkingOptionId } : {}),
    });
    await client.updateAgent(imported.id, { name: `${source.title ?? "Conversation"} (fork)` });
    return { agentId: imported.id, workspaceId: source.workspaceId };
  });
}

export function forkAgent(input: Input): Promise<Result> {
  const identity = JSON.stringify([input.hostId, input.agentId, input.messageId]);
  let attempt = attempts.get(input.requestId);
  if (attempt && attempt.identity !== identity) return Promise.reject(new Error("Fork request ID was reused for a different reply"));
  if (!attempt) {
    if (attempts.size >= 128) {
      const completed = [...attempts].find(([, value]) => value.result);
      if (completed) attempts.delete(completed[0]);
      else return Promise.reject(new Error("Too many pending forks; finish or retry an existing fork first"));
    }
    attempt = { identity };
    attempts.set(input.requestId, attempt);
  }
  if (attempt.result) return Promise.resolve(attempt.result);
  const state = attempt;
  state.pending ??= performFork(input, state).then((result) => {
    state.result = result;
    return result;
  }).finally(() => {
    state.pending = undefined;
    if (!state.sessionId && !state.result) attempts.delete(input.requestId);
  });
  return state.pending;
}
