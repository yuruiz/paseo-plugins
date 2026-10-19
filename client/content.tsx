import {
  type PluginHostProps,
  type PluginButtonContentProps,
  type PluginTimelineItemProps,
  useAgent,
  usePaseo,
  useRpc,
} from "@getpaseo/plugin/client";
import { QuestionButton, useQuestionStyles } from "./question-ui.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { grantNotification, listSecrets, revokeSecrets, type Grant } from "../shared/contracts.js";
import { OutputReview, RequestContent } from "./review.js";
import { SecretsForm } from "./form-view.js";

interface SecretsContentProps extends PluginHostProps {
  agentId: string;
  close?(): void;
}

export function SecretsPopover(props: PluginButtonContentProps) {
  if (props.context !== "agent") return null;
  return <SecretsContent {...props} />;
}

export function SecretsTimeline(props: PluginTimelineItemProps<{ requestId: string }>) {
  return <SecretsContent key={props.item.data.requestId} {...props} />;
}

function SecretsContent(props: SecretsContentProps) {
  const { agentId, host, theme } = props;
  const [revision, setRevision] = useState(0);
  const list = useRpc(listSecrets);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["secrets", host.id, agentId], [host.id, agentId]);
  const grants = useQuery({ queryKey, queryFn: () => list({ agentId }), refetchInterval: 5000 });
  const title = useAgent(agentId, (agent) => agent.title);
  const textStyle = useMemo(() => ({ color: theme.colors.foreground }), [theme]);
  const bodyStyle = useMemo(() => ({ gap: 12 }), []);
  const resetForm = useCallback(() => setRevision((value) => value + 1), []);
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);
  const { refetch } = grants;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const rows = grants.data?.grants.map((grant) => (
    <GrantRow key={grant.id} grant={grant} agentId={agentId} theme={theme} refresh={refresh} />
  ));
  return (
    <View style={bodyStyle} testID="secrets-content">
      <Text style={textStyle}>
        {title ?? agentId} · {host.label}
      </Text>
      <SecretsForm key={revision} {...props} onSaved={refresh} />
      {grants.isPending ? <Text style={textStyle}>Loading grants…</Text> : null}
      {grants.isError ? (
        <QuestionButton theme={theme} label="Retry loading grants" onPress={retry} />
      ) : null}
      {grants.data?.grants.length === 0 ? <Text style={textStyle}>No pending grants.</Text> : null}
      {rows}
      {grants.data?.requests
        .filter((request) => request.status === "pending")
        .map((request) => (
          <RequestContent key={request.id} {...props} requestId={request.id} />
        ))}
      {grants.data?.outputs
        .filter((output) => output.status === "pending")
        .map((output) => (
          <OutputReview key={output.id} {...props} outputId={output.id} />
        ))}
      <QuestionButton theme={theme} label="Clear form" onPress={resetForm} />
      {props.close ? <QuestionButton theme={theme} label="Close" onPress={props.close} /> : null}
    </View>
  );
}

interface GrantRowProps {
  grant: Grant;
  agentId: string;
  theme: PluginHostProps["theme"];
  refresh(): void;
}

export function GrantRow({ grant, agentId, theme, refresh }: GrantRowProps) {
  const paseo = usePaseo();
  const revoke = useRpc(revokeSecrets);
  const styles = useQuestionStyles(theme);
  const textStyle = styles.text;
  const errorStyle = useMemo(() => ({ color: theme.colors.statusDanger }), [theme]);
  const removal = useMutation({
    mutationFn: () => revoke({ agentId, id: grant.id }),
    onSuccess: refresh,
  });
  const delivery = useMutation({
    mutationFn: () => paseo.agents.ref(agentId).send(grantNotification(grant)),
  });
  const { mutate: sendInstructions } = delivery;
  const { mutate: revokeGrant } = removal;
  const send = useCallback(() => sendInstructions(), [sendInstructions]);
  const remove = useCallback(() => revokeGrant(), [revokeGrant]);
  const busy = removal.isPending || delivery.isPending;
  const failed = removal.isError || delivery.isError;
  return (
    <View style={styles.card}>
      <Text style={textStyle}>{grant.names.join(", ")}</Text>
      <Text style={textStyle}>Expires {new Date(grant.expiresAt).toLocaleTimeString()}</Text>
      <View style={styles.row}>
        <QuestionButton
          theme={theme}
          label={delivery.isPending ? "Sending..." : "Send to agent"}
          onPress={send}
          disabled={busy}
          primary
        />
        <QuestionButton
          theme={theme}
          label={removal.isPending ? "Revoking..." : "Revoke"}
          onPress={remove}
          disabled={busy}
        />
      </View>
      {delivery.isSuccess ? <Text style={textStyle}>Instructions sent.</Text> : null}
      {failed ? (
        <Text accessibilityRole="alert" style={errorStyle}>
          Action failed. Refresh the grant list before retrying.
        </Text>
      ) : null}
    </View>
  );
}
