import { memo, useMemo } from "react";
import { Text } from "react-native";
import { literalMatches } from "./find-model";
import { type Language, type SyntaxState, syntaxPalette, tokenizeLine } from "./syntax";

export const SyntaxText = memo(function SyntaxText({
  content,
  language,
  state,
  background,
  enabled,
  search = "",
  highlightColor,
}: {
  content: string;
  language: Language;
  state?: SyntaxState;
  background: string;
  enabled: boolean;
  search?: string;
  highlightColor?: string;
}) {
  const tokens = useMemo(
    () => (enabled ? tokenizeLine(content, language, state).tokens : []),
    [content, language, state, enabled],
  );
  const palette = useMemo(() => syntaxPalette(background), [background]);
  const ranges = search ? literalMatches(content, search) : [];
  function highlight(text: string, start: number) {
    const points = [
      start,
      ...ranges
        .flatMap((range) => [range.start, range.end])
        .filter((point) => point > start && point < start + text.length),
      start + text.length,
    ];
    return points.slice(0, -1).map((point, index) => (
      <Text
        key={point}
        style={
          ranges.some((range) => point >= range.start && point < range.end)
            ? { backgroundColor: highlightColor }
            : undefined
        }
      >
        {text.slice(point - start, points[index + 1] - start)}
      </Text>
    ));
  }
  if (!enabled || language === "plain") return search ? highlight(content, 0) : content;
  let offset = 0;
  return tokens.map((token) => {
    const key = offset;
    offset += token.text.length;
    return (
      <Text key={key} style={token.kind === "plain" ? undefined : { color: palette[token.kind] }}>
        {search ? highlight(token.text, key) : token.text}
      </Text>
    );
  });
});
