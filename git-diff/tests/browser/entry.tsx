import type { PluginTheme } from "@getpaseo/plugin";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { useWindowDimensions } from "react-native";
import { WorkspaceChanges } from "../../client/changes-panel";

declare const document: {
  getElementById(id: string): Parameters<typeof createRoot>[0] | null;
  documentElement: { style: { colorScheme: string } };
};
declare const window: { location: { search: string } };
const query = new URLSearchParams(window.location.search);
const light = query.get("theme") === "light";
document.documentElement.style.colorScheme = light ? "light" : "dark";
const theme: PluginTheme = {
  colors: light
    ? {
        surface0: "#ffffff",
        surface1: "#f8f8f8",
        surface2: "#e8e8e8",
        border: "#e5e5e5",
        foreground: "#3b3b3b",
        foregroundMuted: "#616161",
        accent: "#005fb8",
        accentForeground: "#ffffff",
        statusSuccess: "#147443",
        statusWarning: "#916300",
        statusDanger: "#bf293e",
      }
    : {
        surface0: "#1f1f1f",
        surface1: "#181818",
        surface2: "#2b2b2b",
        border: "#2b2b2b",
        foreground: "#cccccc",
        foregroundMuted: "#9d9d9d",
        accent: "#0078d4",
        accentForeground: "#ffffff",
        statusSuccess: "#89d185",
        statusWarning: "#cca700",
        statusDanger: "#f48771",
      },
};
function Preview({ directory }: { directory: string }) {
  const { width } = useWindowDimensions();
  return (
    <WorkspaceChanges
      directory={directory}
      name={directory.split("/").at(-1) || directory}
      theme={theme}
      compact={width < 640}
    />
  );
}
const element = document.getElementById("app");
if (!element) throw new Error("Missing preview root");
const root = createRoot(element);
const response = await fetch("/api/info");
const info = (await response.json()) as { directory: string };
root.render(
  <QueryClientProvider client={new QueryClient()}>
    <Preview directory={info.directory} />
  </QueryClientProvider>,
);
