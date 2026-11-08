import { Platform } from "react-native";

/** Native clients fall back to Intl locale detection. */
export function browserLanguages(): string[] {
  if (Platform.OS !== "web") return [];
  const nav = (globalThis as { navigator?: { language?: unknown; languages?: unknown } }).navigator;
  const languages = Array.isArray(nav?.languages) ? nav.languages.filter((item): item is string => typeof item === "string") : [];
  return typeof nav?.language === "string" ? [...languages, nav.language] : languages;
}
