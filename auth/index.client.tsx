import { ScrollView, Text } from "react-native";
import type {
  PluginClientContext,
  PluginScreenProps,
  PluginSidebarItemProps,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AuthPanel } from "./client/auth-panel";
import { observeFailures } from "./client/observe";
import { CARD_KIND, card, showCard, type Provider } from "./shared/contracts";

function Accounts(props: PluginScreenProps) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: props.theme.colors.surface0 }}
      contentContainerStyle={{ padding: props.layout.compact ? 16 : 24, gap: 16 }}
    >
      <Text style={{ color: props.theme.colors.foreground, fontSize: 22, fontWeight: "600" }}>
        账号登录
      </Text>
      <Text style={{ color: props.theme.colors.foregroundMuted }}>
        在浏览器完成授权，登录凭据由对应主机上的官方 CLI 保存。
      </Text>
      <AuthPanel key={props.host.id + "claude"} {...props} scope={{ provider: "claude" }} />
      <AuthPanel key={props.host.id + "codex"} {...props} scope={{ provider: "codex" }} />
    </ScrollView>
  );
}
function AccountsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="KeyRound"
      active={currentScreen?.screenId === "accounts"}
      onPress={() => openScreen({ screenId: "accounts" })}
    />
  );
}
function AuthCard(
  props: PluginTimelineItemProps<{ provider: Provider; reason: "required" | "manual" }>,
) {
  return (
    <AuthPanel
      key={props.host.id + props.agentId + props.item.data.provider}
      {...props}
      scope={{ provider: props.item.data.provider, agentId: props.agentId }}
      required={props.item.data.reason === "required"}
    />
  );
}
export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "accounts", title: "账号登录", Component: Accounts });
  client.addSidebarFooterItem({ id: "accounts", title: "账号登录", Component: AccountsItem });
  client.addTimelineRenderer({ kind: CARD_KIND, version: 1, schema: card, Component: AuthCard });
  client.addCommandCenterItem({
    id: "login-here",
    title: "在当前对话登录",
    icon: "KeyRound",
    context: "agent",
    keywords: ["auth", "login", "登录", "认证"],
    async onSelect({ agent, rpc }) {
      await rpc(showCard, { agentId: agent.id, automatic: false });
    },
  });
  client.addCommandCenterItem({
    id: "accounts",
    title: "管理 Claude / Codex 登录",
    icon: "KeyRound",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "accounts" });
    },
  });
  client.addSlashCommand({
    name: "auth",
    argumentHint: "",
    description: "在当前对话显示登录卡片",
    context: "agent",
    async onSubmit({ agent, rpc }) {
      await rpc(showCard, { agentId: agent.id, automatic: false });
    },
  });
  return observeFailures(client);
}
