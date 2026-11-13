import { defineAgentTool, type AgentToolContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  requestInputSchema,
  type SecretRequest,
  type SecretRequestInput,
} from "../shared/contracts.js";
import { SecretsError } from "./errors.js";
import { executionSchema, executeWithSecrets, executionDescription } from "./execution.js";
import type { SecretsBroker } from "./broker.js";
import { connectTools, type OnePasswordConnect } from "./connect.js";

export function privateAgentTools(deps: {
  broker: SecretsBroker;
  connect: OnePasswordConnect;
  request(input: SecretRequestInput, context: AgentToolContext): Promise<SecretRequest>;
  output(id: string, agentId: string, context: AgentToolContext): Promise<void>;
}) {
  async function answer(operation: () => Promise<unknown> | unknown) {
    try {
      const result = await operation();
      const failed =
        typeof result === "object" &&
        result !== null &&
        "exitCode" in result &&
        result.exitCode !== 0;
      return {
        text: JSON.stringify(result),
        structuredContent: result,
        ...(failed ? { isError: true } : {}),
      };
    } catch (error) {
      return {
        isError: true,
        text: error instanceof SecretsError ? error.message : "Secrets operation failed.",
      };
    }
  }
  return [
    defineAgentTool({
      name: "request_secrets",
      description:
        "Ask for private text, images or credential files in this conversation. Text is injected into a command environment; images and files become temporary paths. Returns pending; finish your turn and wait for the user's grant notification. Never ask for secrets in chat. File and image outputs require user review.",
      input: z
        .object({
          purpose: requestInputSchema.shape.purpose,
          fields: requestInputSchema.shape.fields,
        })
        .strict(),
      execute: (input, context) =>
        answer(async () => {
          const parsed = requestInputSchema.safeParse({ ...input, agentId: context.agent.id });
          if (!parsed.success) throw new SecretsError("invalid");
          const request = await deps.request(parsed.data, context);
          return { requestId: request.id, status: "pending", expiresAt: request.expiresAt };
        }),
    }),
    defineAgentTool({
      name: "run_with_secrets",
      description: executionDescription,
      input: z.object(executionSchema).strict(),
      execute: (input, context) =>
        answer(async () => {
          const result = await executeWithSecrets(deps.broker, deps.connect, input, {
            agentId: context.agent.id,
            cwd: context.agent.cwd,
            signal: context.signal,
          });
          if (result.outputId)
            await deps.output(result.outputId, context.agent.id, context).catch(() => undefined);
          return result;
        }),
    }),
    defineAgentTool({
      name: "read_secret_output",
      description:
        "Read output explicitly released by the user for this agent. Pending output stays withheld. Wait for the user's notification instead of polling.",
      input: z.object({ outputId: z.string().uuid() }).strict(),
      execute: ({ outputId }, context) =>
        answer(() => deps.broker.outputs.read(outputId, context.agent.id)),
    }),
    ...connectTools(deps.connect).map((tool) =>
      defineAgentTool({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        async execute(input, { signal }) {
          const result = await tool.run(input, signal);
          return {
            text: result.content.map((entry) => entry.text).join("\n"),
            isError: result.isError,
          };
        },
      }),
    ),
  ];
}
