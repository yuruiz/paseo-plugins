import {
  type PluginHostProps,
  type PluginTimelineItemProps,
  useRpc,
} from "@getpaseo/plugin/client";
import { QuestionButton, useQuestionStyles } from "./question-ui.js";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import {
  getSecretRequest,
  declineSecretRequest,
  readSecretOutput,
  releaseSecretOutput,
  notifySecretOutput,
  discardSecretOutput,
} from "../shared/contracts.js";
import { SecretsForm } from "./form-view.js";

export function RequestTimeline(props: PluginTimelineItemProps<{ requestId: string }>) {
  return <RequestContent {...props} requestId={props.item.data.requestId} />;
}

export function RequestContent(props: PluginHostProps & { agentId: string; requestId: string }) {
  const { agentId, requestId, theme, host } = props;
  const get = useRpc(getSecretRequest);
  const decline = useRpc(declineSecretRequest);
  const [failed, setFailed] = useState(false);
  const query = useQuery({
    queryKey: ["secret-request", host.id, agentId, requestId],
    queryFn: () => get({ agentId, id: requestId }),
    refetchInterval: 5000,
    retry: false,
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const saved = useCallback(() => {
    setFailed(false);
    refresh();
  }, [refresh]);
  const cancel = useCallback(() => {
    setFailed(false);
    void decline({ agentId, id: requestId })
      .then(refresh)
      .catch(() => setFailed(true));
  }, [decline, agentId, requestId, refresh]);
  const styles = useQuestionStyles(theme, props.layout.compact);
  const request = query.data;
  return (
    <View testID="secrets-request">
      {request?.status === "pending" ? (
        <SecretsForm {...props} request={request} onSaved={saved} onDecline={cancel} />
      ) : (
        <View style={styles.card}>
          {query.isPending ? <Text style={styles.muted}>Loading request...</Text> : null}
          {query.isError ? <Text style={styles.muted}>Request unavailable or expired</Text> : null}
          {request ? (
            <Text style={styles.text}>
              {request.status === "fulfilled" ? "Secrets submitted" : `Request ${request.status}`}
            </Text>
          ) : null}
        </View>
      )}
      {failed ? (
        <View style={styles.body}>
          <Text accessibilityRole="alert" style={styles.error}>
            Action failed. Refresh the request and try again.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function OutputTimeline(props: PluginTimelineItemProps<{ outputId: string }>) {
  return <OutputReview {...props} outputId={props.item.data.outputId} />;
}

export function OutputReview({
  agentId,
  outputId,
  theme,
  layout,
}: PluginHostProps & { agentId: string; outputId: string }) {
  const read = useRpc(readSecretOutput);
  const release = useRpc(releaseSecretOutput);
  const discard = useRpc(discardSecretOutput);
  const notifyOutput = useRpc(notifySecretOutput);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<"pending" | "busy" | "released" | "discarded">("pending");
  const [failed, setFailed] = useState(false);
  const styles = useQuestionStyles(theme, layout.compact);
  const inputStyle = useMemo(() => [styles.input, styles.output], [styles]);
  const preview = useCallback(() => {
    setStatus("busy");
    setFailed(false);
    // Sensitive output deliberately bypasses query/mutation caches and timeline data.
    void read({ agentId, id: outputId })
      .then((result) => {
        if (alive.current) {
          setText(result.status === "pending" ? result.text : null);
          setStatus(result.status);
        }
        return undefined;
      })
      .catch(() => {
        if (alive.current) {
          setStatus("pending");
          setFailed(true);
        }
      });
  }, [read, agentId, outputId]);
  const notify = useCallback(() => {
    void notifyOutput({ agentId, id: outputId }).then(
      () => {
        if (alive.current) setFailed(false);
        return undefined;
      },
      () => {
        if (alive.current) setFailed(true);
      },
    );
  }, [notifyOutput, agentId, outputId]);
  const approve = useCallback(() => {
    if (text === null) return;
    const approved = text;
    setText(null);
    setStatus("busy");
    setFailed(false);
    void release({ agentId, id: outputId, text: approved })
      .then((result) => {
        if (alive.current) {
          setStatus("released");
          setFailed(!result.queued);
        }
        return undefined;
      })
      .catch(() => {
        if (alive.current) {
          setStatus("pending");
          setFailed(true);
        }
      });
  }, [release, agentId, outputId, text]);
  const remove = useCallback(() => {
    setText(null);
    setStatus("busy");
    setFailed(false);
    void discard({ agentId, id: outputId })
      .then(() => {
        if (alive.current) setStatus("discarded");
        return undefined;
      })
      .catch(() => {
        if (alive.current) {
          setStatus("pending");
          setFailed(true);
        }
      });
  }, [discard, agentId, outputId]);
  const done = status === "released" || status === "discarded";
  return (
    <View style={styles.card} testID="secrets-output">
      <Text style={styles.text}>{done ? `Output ${status}` : "Review private output"}</Text>
      {!done ? (
        <>
          <Text style={styles.muted}>
            Edit before sharing with the agent · Expires in 10 minutes
          </Text>
          {text !== null ? (
            <TextInput
              accessibilityLabel="Output to release"
              value={text}
              onChangeText={setText}
              multiline
              style={inputStyle}
              maxLength={1024 * 1024}
              autoCorrect={false}
            />
          ) : null}
          <View style={styles.actions}>
            <QuestionButton
              theme={theme}
              label="Discard output"
              onPress={remove}
              disabled={status === "busy"}
            />
            {text === null ? (
              <QuestionButton
                theme={theme}
                label="Review output"
                onPress={preview}
                disabled={status === "busy"}
                primary
              />
            ) : (
              <QuestionButton theme={theme} label="Release output" onPress={approve} primary />
            )}
          </View>
        </>
      ) : null}
      {failed ? (
        <View style={styles.body}>
          <Text accessibilityRole="alert" style={styles.error}>
            Action failed or output expired. Only released text is shared with the agent.
          </Text>
        </View>
      ) : null}
      {status === "released" ? (
        <QuestionButton theme={theme} label="Notify agent" onPress={notify} />
      ) : null}
    </View>
  );
}
