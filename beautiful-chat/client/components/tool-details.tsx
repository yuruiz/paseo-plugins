import React, { useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { ExtendedThemeTokens } from "./theme-tokens";

/** Keep navigation outside the scrolling payload, including while output streams. */
export function ToolDetails({
  children,
  contentContainerStyle,
  tokens,
  onCollapse,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  tokens: ExtendedThemeTokens;
  onCollapse: () => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const [scrolled, setScrolled] = useState(false);
  const { height } = useWindowDimensions();
  const labelStyle = { color: tokens.foreground, fontFamily: tokens.fontUi, fontSize: 12 };
  const buttonStyle = { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" as const };

  return (
    <View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={contentContainerStyle}
        style={{ maxHeight: Math.min(480, height * 0.5) }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent }) => setScrolled(nativeEvent.contentOffset.y > 1)}
      >
        {children}
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          backgroundColor: tokens.surface1,
          borderTopWidth: 1,
          borderTopColor: tokens.borderSubtle,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to top of tool details"
          accessibilityState={{ disabled: !scrolled }}
          disabled={!scrolled}
          onPress={() => scroll.current?.scrollTo({ y: 0, animated: false })}
          style={buttonStyle}
        >
          <Text style={[labelStyle, !scrolled && { color: tokens.foregroundSubtle }]}>
            Back to top
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Collapse tool details"
          onPress={onCollapse}
          style={buttonStyle}
        >
          <Text style={labelStyle}>Collapse</Text>
        </Pressable>
      </View>
    </View>
  );
}
