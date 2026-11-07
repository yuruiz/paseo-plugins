import { createElement, memo } from "react";
import { Image, Platform } from "react-native";
import { iconAssets } from "./generated/icons";

export type IconName = keyof typeof iconAssets;
export const Icon = memo(function Icon({
  name,
  color,
  size = 16,
}: {
  name: IconName;
  color: string;
  size?: number;
}) {
  const asset = iconAssets[name];
  if (Platform.OS === "web") {
    const svg = asset.monochrome ? asset.svg.replaceAll("currentColor", color) : asset.svg;
    return createElement("img", {
      src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      alt: "",
      "aria-hidden": true,
      draggable: false,
      style: {
        width: size,
        height: size,
        flexShrink: 0,
        objectFit: "contain",
        pointerEvents: "none",
      },
    });
  }
  return (
    <Image
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      source={{ uri: asset.png }}
      resizeMode="contain"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        ...(asset.monochrome ? { tintColor: color } : {}),
      }}
    />
  );
});

const extensions: Record<string, IconName> = {};
for (const [list, icon] of [
  ["js mjs cjs", "js"],
  ["ts mts cts", "ts"],
  ["jsx", "react"],
  ["tsx", "reactTs"],
  ["py pyi pyw", "python"],
  ["go mod sum", "go"],
  ["rs", "rust"],
  ["java", "java"],
  ["kt kts", "kotlin"],
  ["swift", "swift"],
  ["cs", "csharp"],
  ["c h", "c"],
  ["cpp hpp cc cxx hxx", "cpp"],
  ["rb erb", "ruby"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["html htm xhtml xml", "html"],
  ["css", "css"],
  ["scss", "scss"],
  ["sass", "sass"],
  ["less", "less"],
  ["json jsonc json5 ipynb", "json"],
  ["yaml yml", "yaml"],
  ["toml", "toml"],
  ["md markdown mdx", "markdown"],
  ["png jpg jpeg gif webp ico avif bmp", "image"],
  ["svg", "svg"],
  ["sh bash zsh fish bat", "terminal"],
  ["ps1 psm1", "powershell"],
  ["sql sqlite db", "database"],
  ["lock", "lock"],
  ["pdf", "pdf"],
  ["woff woff2 ttf zip gz dat exe bin", "binary"],
] as const)
  for (const extension of list.split(" ")) extensions[extension] = icon;

export function fileAppearance(path: string, fallback: string): { icon: IconName; color: string } {
  const name = path.split("/").at(-1)?.toLowerCase() || "";
  const extension = name.split(".").at(-1) || "";
  let icon: IconName = extensions[extension] ?? "file";
  if (name === "package.json" || name === "package-lock.json" || name === ".npmrc") icon = "npm";
  else if (name === "yarn.lock" || name.startsWith(".yarnrc")) icon = "yarn";
  else if (name === "pnpm-lock.yaml" || name === "pnpm-workspace.yaml") icon = "pnpm";
  else if (
    name === "dockerfile" ||
    name.startsWith("dockerfile.") ||
    /^docker-compose\./.test(name)
  )
    icon = "docker";
  else if (name.startsWith(".git")) icon = "git";
  else if (name.startsWith(".env") || ["editorconfig", "ini", "conf", "config"].includes(extension))
    icon = "config";
  return { icon, color: fallback };
}
