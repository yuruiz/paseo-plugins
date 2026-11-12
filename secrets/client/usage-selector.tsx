import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { QuestionButton } from "./question-ui.js";
import type { GrantUsage } from "../shared/contracts.js";

export function UsageSelector({
  theme,
  usage,
  onChange,
  disabled,
}: {
  theme: PluginHostProps["theme"];
  usage: GrantUsage;
  onChange(usage: GrantUsage): void;
  disabled?: boolean;
}) {
  const once = useCallback(() => onChange("once"), [onChange]);
  const reusable = useCallback(() => onChange("reusable"), [onChange]);
  return (
    <View style={styles.row}>
      <QuestionButton
        theme={theme}
        label={usage === "once" ? "✓ One use" : "One use"}
        onPress={once}
        disabled={disabled}
        compact
      />
      <QuestionButton
        theme={theme}
        label={usage === "reusable" ? "✓ Reuse for 10 minutes" : "Reuse for 10 minutes"}
        onPress={reusable}
        disabled={disabled}
        compact
      />
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", gap: 8 } });
