import type { PluginTheme } from "@getpaseo/plugin";
import { Platform } from "react-native";
import type { PanelSettings } from "../shared/settings";

// Match Paseo's DEFAULT_UI_FONT_STACK / DEFAULT_MONO_FONT_STACK. Older plugin
// SDKs expose colors only; the web UI variable also follows newer host settings.
export const uiFont =
  Platform.OS === "web"
    ? "var(--paseo-ui-font, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif)"
    : Platform.OS === "ios"
      ? "System"
      : "sans-serif";
export const monoFont =
  Platform.OS === "web"
    ? "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
    : Platform.OS === "ios"
      ? "Menlo"
      : "monospace";

export function codeFont(settings: Pick<PanelSettings, "fontFamily" | "customFontFamily">) {
  if (settings.fontFamily === "custom" && settings.customFontFamily.trim())
    return Platform.OS === "web"
      ? `${settings.customFontFamily}, ${monoFont}`
      : settings.customFontFamily;
  if (settings.fontFamily === "vscode")
    return Platform.OS === "web" ? "Menlo, Monaco, Consolas, 'Courier New', monospace" : monoFont;
  if (settings.fontFamily === "jetbrains")
    return Platform.OS === "web" ? `'JetBrains Mono', ${monoFont}` : "JetBrains Mono";
  return monoFont;
}

// Mix solid colors instead of layering opacity over text and selection colors.
export function mixColor(color: string, background: string, amount: number): string {
  function rgb(value: string) {
    const hex = value.replace(/^#/, "");
    const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
    return /^[\da-f]{6}$/i.test(expanded)
      ? [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16))
      : null;
  }
  const front = rgb(color);
  const back = rgb(background);
  if (!front || !back) return background;
  return `#${front
    .map((channel, i) =>
      Math.round(channel * amount + back[i] * (1 - amount))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function panelTokens(theme: PluginTheme) {
  const colors = theme.colors;
  return {
    ...colors,
    selection: mixColor(colors.accent, colors.surface1, 0.18),
    fieldFocusBorder: mixColor(colors.accent, colors.border, 0.65),
    fieldFocusBackground: mixColor(colors.accent, colors.surface0, 0.025),
    addedBackground: mixColor(colors.statusSuccess, colors.surface0, 0.12),
    removedBackground: mixColor(colors.statusDanger, colors.surface0, 0.12),
    addedGutter: mixColor(colors.statusSuccess, colors.surface1, 0.2),
    removedGutter: mixColor(colors.statusDanger, colors.surface1, 0.2),
    ui: uiFont,
    mono: monoFont,
  };
}
