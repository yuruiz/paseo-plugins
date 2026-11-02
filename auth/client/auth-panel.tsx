import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { openExternalUrl, useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/ui";
import {
  active,
  getState,
  checkStatus,
  startLogin,
  cancelLogin,
  submitCode,
  recover,
  type Scope,
} from "../shared/contracts";

type Action = "check" | "start" | "cancel" | "code" | "reload" | "continue";
export function AuthPanel({
  scope,
  theme,
  host,
  layout,
  required = false,
}: PluginHostProps & { scope: Scope; required?: boolean }) {
  const get = useRpc(getState);
  const check = useRpc(checkStatus);
  const start = useRpc(startLogin);
  const cancel = useRpc(cancelLogin);
  const submit = useRpc(submitCode);
  const restore = useRpc(recover);
  const cache = useQueryClient();
  const key = ["auth", host.id, scope.provider, scope.agentId ?? "host"];
  const [code, setCode] = useState("");
  const secret = useRef("");
  secret.current = code;
  const [notice, setNotice] = useState("");
  const [linkError, setLinkError] = useState("");
  const query = useQuery({
    queryKey: key,
    queryFn: () => get(scope),
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchInterval: (q) => (active(q.state.data ?? { phase: "idle" }) ? 1000 : 5000),
    refetchIntervalInBackground: false,
  });
  const view = query.data;
  const busy = Boolean(view && active(view));
  useEffect(() => {
    setCode("");
    setNotice("");
    setLinkError("");
  }, [view?.sessionId]);
  useEffect(() => {
    if (!view?.expectsCode) setCode("");
  }, [view?.expectsCode]);
  const action = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: async (kind: Action) => {
      setNotice("");
      setLinkError("");
      // Do not let an earlier background read overwrite the action's result.
      await cache.cancelQueries({ queryKey: key, exact: true });
      if (kind === "start") return start(scope);
      if (kind === "check") return check(scope);
      if (!view?.sessionId) throw new Error("This sign-in session has expired. Start again.");
      const input = { ...scope, sessionId: view.sessionId };
      if (kind === "cancel") return cancel(input);
      if (kind === "code") {
        const value = secret.current.trim();
        secret.current = "";
        setCode("");
        return submit({ ...input, code: value });
      }
      if (!scope.agentId) throw new Error("Open the conversation to recover its session.");
      const result = await restore({ ...input, agentId: scope.agentId, action: kind });
      setNotice(result.message);
      return get(scope);
    },
    onSuccess: async (data) => {
      await cache.cancelQueries({ queryKey: key, exact: true });
      cache.setQueryData(key, data);
      void cache.invalidateQueries({ queryKey: ["auth", host.id] });
    },
  });
  const colors = theme.colors;
  const disabled = action.isPending || !view || query.isError;
  const checking = action.isPending && action.variables === "check";
  function button(label: string, run: () => void, unavailable = false, primary = false) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: unavailable }}
        disabled={unavailable}
        onPress={run}
        style={{
          minHeight: 42,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 8,
          opacity: unavailable ? 0.45 : 1,
          backgroundColor: primary ? colors.accent : colors.surface0,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          style={{
            color: primary ? colors.accentForeground : colors.foreground,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  }
  async function open() {
    if (!view?.url) return;
    try {
      await openExternalUrl(view.url);
    } catch {
      setLinkError("Could not open the browser. Copy the authorization link and open it manually.");
    }
  }
  async function copy(value: string, description: string) {
    try {
      await copyText(value);
      setNotice(description + " copied.");
    } catch {
      setLinkError("Could not copy. Select the text or press and hold to copy it manually.");
    }
  }
  const label = scope.provider === "claude" ? "Claude Code" : "Codex";
  const statuses = {
    unchecked: "Not checked",
    authenticated: "Sign-in credentials found",
    unauthenticated: "Sign-in required",
    missing: "Not installed",
    unsupported: "Managed by provider configuration",
    error: "Check failed",
  };
  return (
    <View
      style={{
        padding: layout.compact ? 14 : 20,
        gap: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface0,
        maxWidth: 720,
        width: "100%",
      }}
    >
      <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }}>
        {label}
        {required && view?.phase !== "succeeded" ? " · Sign-in required" : ""}
      </Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>Host: {host.label}</Text>
      {!view && !query.isError && (
        <Text style={{ color: colors.foregroundMuted }}>Loading status…</Text>
      )}
      {query.isError && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground }}>
            Could not read the sign-in status. Make sure the host is online and try again.
          </Text>
          {button(
            "Retry",
            () => {
              void query.refetch();
            },
            query.isFetching,
          )}
        </View>
      )}
      {view && (
        <>
          <Text style={{ color: colors.foregroundMuted }}>
            {busy
              ? "Sign-in in progress"
              : view.phase === "succeeded"
                ? "✓ Signed in successfully"
                : statuses[view.status]}
            {view.account ? " · " + view.account : ""}
          </Text>
          <Text style={{ color: colors.foreground }}>{view.message}</Text>
          {view.lastCheck && (
            <View
              accessibilityLiveRegion="polite"
              style={{
                gap: 6,
                padding: 12,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                {view.lastCheck.kind === "skipped"
                  ? "CLI check skipped"
                  : view.lastCheck.status === "error"
                    ? "Check failed"
                    : "Check complete: " + statuses[view.lastCheck.status]}
              </Text>
              <Text style={{ color: colors.foreground }}>{view.lastCheck.message}</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                Checked at: {new Date(view.lastCheck.at).toLocaleTimeString()}
              </Text>
            </View>
          )}
          {required && view.status === "authenticated" && view.phase !== "succeeded" && (
            <Text style={{ color: colors.foregroundMuted }}>
              Saved credentials may have expired. Sign in again if your last request was rejected.
            </Text>
          )}
          {view.deviceCode && (
            <View style={{ gap: 8 }}>
              <Text
                selectable
                style={{
                  color: colors.foreground,
                  fontSize: 26,
                  fontWeight: "700",
                  letterSpacing: 2,
                }}
              >
                {view.deviceCode}
              </Text>
              {button("Copy device code", () => {
                void copy(view.deviceCode!, "Device code");
              })}
              <Text style={{ color: colors.foregroundMuted }}>
                Enter this device code on the authorization website.
              </Text>
            </View>
          )}
          {view.url && (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {button(
                  "Open authorization page",
                  () => {
                    void open();
                  },
                  false,
                  true,
                )}
                {button("Copy authorization link", () => {
                  void copy(view.url!, "Authorization link");
                })}
              </View>
              {linkError && (
                <Text selectable style={{ color: colors.foreground }}>
                  {view.url}
                </Text>
              )}
            </View>
          )}
          {view.expectsCode && (
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.foregroundMuted }}>
                If the website displays an authorization code, paste it here:
              </Text>
              <TextInput
                accessibilityLabel="Authorization code"
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                maxLength={4096}
                placeholder="Paste authorization code"
                placeholderTextColor={colors.foregroundMuted}
                style={{
                  color: colors.foreground,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  minHeight: 44,
                }}
              />
              {button(
                "Submit authorization code",
                () => action.mutate("code"),
                disabled || !code.trim(),
                true,
              )}
            </View>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {busy ? (
              button("Cancel sign-in", () => action.mutate("cancel"), disabled)
            ) : (
              <>
                {button(
                  view.phase === "failed" || view.phase === "expired" ? "Start again" : "Sign in",
                  () => action.mutate("start"),
                  disabled || !view.canLogin,
                  true,
                )}
                {button(
                  checking ? "Checking…" : "Check status",
                  () => action.mutate("check"),
                  disabled,
                )}
              </>
            )}
            {scope.agentId &&
              view.phase === "succeeded" &&
              !view.reloaded &&
              button("Reload current session", () => action.mutate("reload"), disabled, true)}
            {scope.agentId &&
              view.phase === "succeeded" &&
              view.reloaded &&
              !view.continued &&
              button("Continue task", () => action.mutate("continue"), disabled, true)}
          </View>
          {view.phase === "succeeded" && scope.agentId && !view.reloaded && (
            <Text style={{ color: colors.foregroundMuted }}>
              Reload to use the new credentials. This restarts the current session process and keeps
              your conversation history.
            </Text>
          )}
          {view.continued && (
            <Text style={{ color: colors.foregroundMuted }}>Task continuation requested.</Text>
          )}
          {busy && (
            <Text style={{ color: colors.foregroundMuted }}>
              You can leave this page while sign-in continues. Choose Cancel sign-in to stop it.
            </Text>
          )}
        </>
      )}
      {action.isPending && (
        <Text style={{ color: colors.foregroundMuted }}>
          {checking ? "Checking CLI sign-in status…" : "Working…"}
        </Text>
      )}
      {action.error && (
        <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
          {action.error instanceof Error
            ? action.error.message
            : "Something went wrong. Please try again."}
        </Text>
      )}
      {!!notice && <Text style={{ color: colors.foregroundMuted }}>{notice}</Text>}
      {!!linkError && <Text style={{ color: colors.foreground }}>{linkError}</Text>}
    </View>
  );
}
