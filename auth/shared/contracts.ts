import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const provider = z.enum(["claude", "codex"]);
export type Provider = z.infer<typeof provider>;
export const scope = z.object({ provider, agentId: z.string().min(1).max(200).optional() });
export type Scope = z.infer<typeof scope>;
export const phase = z.enum([
  "idle",
  "starting",
  "waiting",
  "verifying",
  "succeeded",
  "failed",
  "canceled",
  "expired",
]);
export const checkResult = z.object({
  at: z.number(),
  kind: z.enum(["checked", "skipped"]),
  status: z.enum([
    "unchecked",
    "authenticated",
    "unauthenticated",
    "missing",
    "unsupported",
    "error",
  ]),
  message: z.string(),
});
export const authView = z.object({
  lastCheck: checkResult.optional(),
  provider,
  phase,
  sessionId: z.string().optional(),
  status: z.enum([
    "unchecked",
    "authenticated",
    "unauthenticated",
    "missing",
    "unsupported",
    "error",
  ]),
  reloaded: z.boolean().optional(),
  continued: z.boolean().optional(),
  account: z.string().optional(),
  message: z.string(),
  canLogin: z.boolean(),
  url: z.string().optional(),
  deviceCode: z.string().optional(),
  expectsCode: z.boolean(),
  expiresAt: z.number().optional(),
});
export type AuthView = z.infer<typeof authView>;
export const card = z.object({ provider, reason: z.enum(["required", "manual"]) });
export const CARD_KIND = "auth-request";
export const getState = defineRpc({ name: "auth.state", input: scope, output: authView });
export const checkStatus = defineRpc({ name: "auth.check", input: scope, output: authView });
export const startLogin = defineRpc({ name: "auth.start", input: scope, output: authView });
const session = scope.extend({ sessionId: z.string().min(1).max(100) });
export const cancelLogin = defineRpc({ name: "auth.cancel", input: session, output: authView });
export const submitCode = defineRpc({
  name: "auth.code",
  input: session.extend({
    code: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[A-Za-z0-9_~.\-#]+$/),
  }),
  output: authView,
});
export const showCard = defineRpc({
  name: "auth.show",
  input: z.object({ agentId: z.string().min(1).max(200), automatic: z.boolean().default(false) }),
  output: z.object({ shown: z.boolean() }),
});
export const recover = defineRpc({
  name: "auth.recover",
  input: session.extend({ agentId: z.string().min(1), action: z.enum(["reload", "continue"]) }),
  output: z.object({ message: z.string(), reloaded: z.boolean() }),
});
export function active(view: Pick<AuthView, "phase">): boolean {
  return ["starting", "waiting", "verifying"].includes(view.phase);
}
