import { ScrollView, Text } from "react-native";
import type {
  PluginClientContext,
  PluginScreenProps,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
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
        Accounts
      </Text>
      <Text style={{ color: props.theme.colors.foregroundMuted }}>
        Complete authorization in your browser. The official CLI stores credentials on the selected
        host.
      </Text>
      <AuthPanel key={props.host.id + "claude"} {...props} scope={{ provider: "claude" }} />
      <AuthPanel key={props.host.id + "codex"} {...props} scope={{ provider: "codex" }} />
    </ScrollView>
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
  client.addScreen({ id: "accounts", title: "Accounts", Component: Accounts });
  client.addTimelineRenderer({ kind: CARD_KIND, version: 1, schema: card, Component: AuthCard });
  client.addCommandCenterItem({
    id: "login-here",
    title: "Sign in from this conversation",
    icon: "KeyRound",
    context: "agent",
    keywords: ["auth", "login", "sign in", "authentication"],
    async onSelect({ agent, rpc }) {
      await rpc(showCard, { agentId: agent.id, automatic: false });
    },
  });
  client.addCommandCenterItem({
    id: "accounts",
    title: "Manage Claude / Codex sign-in",
    icon: "KeyRound",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "accounts" });
    },
  });
  client.addSlashCommand({
    name: "auth",
    argumentHint: "",
    description: "Show a sign-in card in this conversation",
    context: "agent",
    async onSubmit({ agent, rpc }) {
      await rpc(showCard, { agentId: agent.id, automatic: false });
    },
  });
  return observeFailures(client);
}
