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
      if (kind === "start") return start(scope);
      if (kind === "check") return check(scope);
      if (!view?.sessionId) throw new Error("此登录流程已失效，请重新开始。");
      const input = { ...scope, sessionId: view.sessionId };
      if (kind === "cancel") return cancel(input);
      if (kind === "code") {
        const value = secret.current.trim();
        secret.current = "";
        setCode("");
        return submit({ ...input, code: value });
      }
      if (!scope.agentId) throw new Error("请在对话里恢复当前会话。");
      const result = await restore({ ...input, agentId: scope.agentId, action: kind });
      setNotice(result.message);
      return get(scope);
    },
    onSuccess: (data) => {
      cache.setQueryData(key, data);
      void cache.invalidateQueries({ queryKey: ["auth", host.id] });
    },
  });
  const colors = theme.colors;
  const disabled = action.isPending || !view || query.isError;
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
      setLinkError("无法打开浏览器，请复制授权链接后手动打开。");
    }
  }
  async function copy(value: string, description: string) {
    try {
      await copyText(value);
      setNotice(description + "已复制。");
    } catch {
      setLinkError("无法复制，请长按或选中文字手动复制。");
    }
  }
  const label = scope.provider === "claude" ? "Claude Code" : "Codex";
  const statuses = {
    unchecked: "尚未检查",
    authenticated: "已检测到登录凭据",
    unauthenticated: "需要登录",
    missing: "未安装",
    unsupported: "由其他配置管理",
    error: "检查失败",
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
        {required && view?.phase !== "succeeded" ? " · 需要重新授权" : ""}
      </Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>登录主机：{host.label}</Text>
      {!view && !query.isError && (
        <Text style={{ color: colors.foregroundMuted }}>正在读取状态…</Text>
      )}
      {query.isError && (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground }}>
            暂时无法读取登录状态，请确认主机在线后重试。
          </Text>
          {button(
            "重试",
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
              ? "登录进行中"
              : view.phase === "succeeded"
                ? "✓ 登录成功"
                : statuses[view.status]}
            {view.account ? " · " + view.account : ""}
          </Text>
          <Text style={{ color: colors.foreground }}>{view.message}</Text>
          {required && view.status === "authenticated" && view.phase !== "succeeded" && (
            <Text style={{ color: colors.foregroundMuted }}>
              已保存的凭据仍可能失效。若刚才的请求被拒绝，请重新登录。
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
              {button("复制验证码", () => {
                void copy(view.deviceCode!, "验证码");
              })}
              <Text style={{ color: colors.foregroundMuted }}>在授权网页输入这个验证码。</Text>
            </View>
          )}
          {view.url && (
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {button(
                  "打开授权页面",
                  () => {
                    void open();
                  },
                  false,
                  true,
                )}
                {button("复制授权链接", () => {
                  void copy(view.url!, "授权链接");
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
                如果网页显示授权码，请粘贴到这里：
              </Text>
              <TextInput
                accessibilityLabel="授权码"
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                maxLength={4096}
                placeholder="粘贴授权码"
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
              {button("提交授权码", () => action.mutate("code"), disabled || !code.trim(), true)}
            </View>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {busy ? (
              button("取消登录", () => action.mutate("cancel"), disabled)
            ) : (
              <>
                {button(
                  view.phase === "failed" || view.phase === "expired" ? "重新开始" : "重新登录",
                  () => action.mutate("start"),
                  disabled || !view.canLogin,
                  true,
                )}
                {button("检查状态", () => action.mutate("check"), disabled)}
              </>
            )}
            {scope.agentId &&
              view.phase === "succeeded" &&
              !view.reloaded &&
              button("重新加载当前会话", () => action.mutate("reload"), disabled, true)}
            {scope.agentId &&
              view.phase === "succeeded" &&
              view.reloaded &&
              !view.continued &&
              button("继续任务", () => action.mutate("continue"), disabled, true)}
          </View>
          {view.phase === "succeeded" && scope.agentId && !view.reloaded && (
            <Text style={{ color: colors.foregroundMuted }}>
              重新加载后使用新的凭据。此操作会重启当前会话进程，保留对话记录。
            </Text>
          )}
          {view.continued && (
            <Text style={{ color: colors.foregroundMuted }}>已请求继续任务。</Text>
          )}
          {busy && (
            <Text style={{ color: colors.foregroundMuted }}>
              可以切换页面，登录会继续等待；点击「取消登录」才会终止。
            </Text>
          )}
        </>
      )}
      {action.isPending && <Text style={{ color: colors.foregroundMuted }}>正在处理…</Text>}
      {action.error && (
        <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
          {action.error instanceof Error ? action.error.message : "操作失败，请重试。"}
        </Text>
      )}
      {!!notice && <Text style={{ color: colors.foregroundMuted }}>{notice}</Text>}
      {!!linkError && <Text style={{ color: colors.foreground }}>{linkError}</Text>}
    </View>
  );
}
