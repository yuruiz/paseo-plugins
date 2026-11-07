export type PreviewLink =
  | { kind: "anchor"; fragment: string }
  | { kind: "web"; url: string }
  | { kind: "file"; path: string; fragment: string; absolute: boolean };

function hasControl(value: string) {
  return [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

// Used both by the iframe host and daemon. Local links never become remote fetches.
export function parsePreviewLink(value: string): PreviewLink | null {
  const href = value.trim();
  if (!href || href.length > 8192 || hasControl(href)) return null;
  try {
    if (/^(?:https?:|mailto:)/i.test(href) || href.startsWith("//")) {
      const url = new URL(href.startsWith("//") ? `https:${href}` : href);
      if (!["https:", "http:", "mailto:"].includes(url.protocol)) return null;
      return { kind: "web", url: url.href };
    }
    if (href.startsWith("#"))
      return { kind: "anchor", fragment: decodeURIComponent(href.slice(1)) };
    if (/^file:/i.test(href)) {
      const url = new URL(href);
      if (url.hostname && url.hostname !== "localhost") return null;
      const path = decodeURIComponent(url.pathname);
      if (hasControl(path) || path.includes("\\")) return null;
      return {
        kind: "file",
        path,
        fragment: decodeURIComponent(url.hash.slice(1)),
        absolute: true,
      };
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("\\")) return null;
    const hash = href.indexOf("#");
    const path = decodeURIComponent((hash < 0 ? href : href.slice(0, hash)).split("?")[0]);
    const fragment = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
    if (hasControl(path) || path.includes("\\")) return null;
    return path ? { kind: "file", path, fragment, absolute: false } : { kind: "anchor", fragment };
  } catch {
    return null;
  }
}
