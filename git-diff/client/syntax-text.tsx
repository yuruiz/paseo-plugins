import { memo, useMemo } from "react";
import { Text } from "react-native";
import { type Language, type SyntaxState, syntaxPalette, tokenizeLine } from "./syntax";

export const SyntaxText = memo(function SyntaxText({
  content,
  language,
  state,
  background,
  enabled,
}: {
  content: string;
  language: Language;
  state?: SyntaxState;
  background: string;
  enabled: boolean;
}) {
  const tokens = useMemo(
    () => (enabled ? tokenizeLine(content, language, state).tokens : []),
    [content, language, state, enabled],
  );
  const palette = useMemo(() => syntaxPalette(background), [background]);
  if (!enabled || language === "plain") return content;
  let offset = 0;
  return tokens.map((token) => {
    const key = offset;
    offset += token.text.length;
    return (
      <Text key={key} style={token.kind === "plain" ? undefined : { color: palette[token.kind] }}>
        {token.text}
      </Text>
    );
  });
});
