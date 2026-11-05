import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { beginSecretSelfTest, completeSecretSelfTest } from "../shared/contracts.js";
import { MAX_SEALED_PLAINTEXT, sealBytes } from "../shared/sealing.js";
import { QuestionButton, useQuestionStyles } from "./question-ui.js";

export function SecretSelfTest({ theme, layout }: PluginSurfaceProps) {
  const begin = useRpc(beginSecretSelfTest);
  const complete = useRpc(completeSecretSelfTest);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState("");
  const styles = useQuestionStyles(theme, layout.compact);
  const run = useCallback(() => {
    setPending(true);
    setResult("");
    void (async () => {
      const ticket = await begin({});
      const payload = new Uint8Array(MAX_SEALED_PLAINTEXT).fill(97);
      let envelope;
      try {
        envelope = sealBytes(ticket, payload);
      } finally {
        payload.fill(0);
      }
      const response = await complete({ ticketId: ticket.id, envelope });
      if (response.bytes !== MAX_SEALED_PLAINTEXT) throw new Error();
      setResult("Passed. This device can encrypt and submit the maximum supported payload.");
    })()
      .catch(() =>
        setResult(
          "Check failed. Update the app and daemon, and check the host connection before submitting secrets.",
        ),
      )
      .finally(() => setPending(false));
  }, [begin, complete]);
  return (
    <View style={styles.body}>
      <Text style={styles.text}>Private input connection</Text>
      <Text style={styles.muted}>
        Send encrypted test data through this device’s connection. No credentials are used and no
        execution grant is created.
      </Text>
      <QuestionButton
        theme={theme}
        label={pending ? "Checking…" : "Check encrypted input"}
        onPress={run}
        disabled={pending}
      />
      {result ? <Text style={styles.text}>{result}</Text> : null}
    </View>
  );
}
