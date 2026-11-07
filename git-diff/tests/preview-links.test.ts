import { describe, expect, it } from "vitest";
import { parsePreviewLink } from "../shared/preview-links";

describe("preview URLs", () => {
  it("distinguishes web, document anchors, local paths and file URLs", () => {
    expect(parsePreviewLink("../docs/a%20b.md?view=1#%E5%AE%89%E8%A3%85")).toEqual({
      kind: "file",
      path: "../docs/a b.md",
      fragment: "安装",
      absolute: false,
    });
    expect(parsePreviewLink("/README.md")).toMatchObject({
      kind: "file",
      path: "/README.md",
      absolute: false,
    });
    expect(parsePreviewLink("file:///workspace/a%20b.md#title")).toEqual({
      kind: "file",
      path: "/workspace/a b.md",
      fragment: "title",
      absolute: true,
    });
    expect(parsePreviewLink("#hello%20world")).toEqual({ kind: "anchor", fragment: "hello world" });
    expect(parsePreviewLink("//example.com/a")).toEqual({
      kind: "web",
      url: "https://example.com/a",
    });
    expect(parsePreviewLink("https://example.com/a?b=1&c=2")).toMatchObject({ kind: "web" });
    expect(parsePreviewLink("mailto:me@example.com")).toMatchObject({ kind: "web" });
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,bad",
    "vscode://open",
    "file://remote/share/a",
    "file:///a%00b",
    "../a%0Ab",
    "../a%5Cb",
    "../%ZZ",
    "../a\u0000b",
    "\\\\server\\a",
    "x".repeat(8193),
  ])("rejects unsafe or malformed href %s", (href) => {
    expect(parsePreviewLink(href)).toBeNull();
  });
});
