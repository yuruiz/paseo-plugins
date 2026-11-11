import { describe, expect, it } from "vitest";
import { closeTab, closeTabs, openTab, pinTab, type TabsState } from "../client/editor-model";
import { filePaths } from "../client/file-paths";
import { hasMermaid } from "../client/mermaid-preview";
import { markdownHtml, previewDocument } from "../client/preview-model";
import { diffSyntaxStates, languageForPath, tokenizeLine } from "../client/syntax";
import { hunkSchema, repositorySchema } from "../shared/contracts";

function entry(id: string, path: string) {
  const repository = repositorySchema.parse({
    id,
    directory: `/workspace/${id}`,
    relativePath: id,
    parentId: null,
    head: "abc",
    recordedHead: null,
    indexedHead: null,
    state: "ready",
    error: null,
    files: [
      {
        path,
        status: "modified",
        additions: 1,
        deletions: 0,
        staged: false,
        unstaged: true,
        binary: false,
        version: "v1",
      },
    ],
  });
  return { repository, file: repository.files[0] };
}
describe("editor tabs", () => {
  it("replaces the preview while preserving pinned tabs", () => {
    let state = openTab({ tabs: [], active: null }, entry(".", "a.ts"));
    state = openTab(state, entry(".", "b.ts"));
    expect(state.tabs.map((tab) => tab.path)).toEqual(["b.ts"]);
    state = pinTab(state, state.active ?? "");
    state = openTab(state, entry(".", "c.ts"));
    state = openTab(state, entry("child", "c.ts"));
    expect(state.tabs.map((tab) => [tab.repositoryId, tab.path])).toEqual([
      [".", "b.ts"],
      ["child", "c.ts"],
    ]);
    state = openTab(state, entry(".", "b.ts"));
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs[0].pinned).toBe(true);
  });
  it("appends distinct files, distinguishes submodule paths and reuses an existing tab", () => {
    const a = entry(".", "src/index.ts");
    const b = entry("child", "src/index.ts");
    let state: TabsState = { tabs: [], active: null };
    state = openTab(pinTab(openTab(state, a), openTab(state, a).active ?? ""), b);
    expect(state.tabs).toHaveLength(2);
    const previous = state.tabs;
    state = openTab(state, a);
    expect(state.tabs).toBe(previous);
    expect(state.active).toBe(state.tabs[0].key);
    expect(openTab(state, a)).toBe(state);
  });
  it("closing active tabs selects their neighbor and closing all stays empty", () => {
    let state: TabsState = { tabs: [], active: null };
    for (const path of ["a.ts", "b.ts", "c.ts"]) {
      state = openTab(state, entry(".", path));
      state = pinTab(state, state.active ?? "");
    }
    state = { ...state, active: state.tabs[1].key };
    state = closeTab(state, state.active ?? "");
    expect(state.tabs.find((tab) => tab.key === state.active)?.path).toBe("c.ts");
    state = closeTab(state, state.active ?? "");
    expect(state.tabs.find((tab) => tab.key === state.active)?.path).toBe("a.ts");
    state = closeTab(state, state.active ?? "");
    expect(state).toEqual({ tabs: [], active: null });
  });
  it("applies bulk closes to the context tab while preserving or replacing the active tab", () => {
    let state: TabsState = { tabs: [], active: null };
    for (const path of ["a.ts", "b.ts", "c.ts", "d.ts"]) {
      state = openTab(state, entry(".", path));
      state = pinTab(state, state.active ?? "");
    }
    const [a, b, c, d] = state.tabs;
    expect(closeTabs(state, b.key, "right")).toEqual({ tabs: [a, b], active: b.key });
    expect(closeTabs(state, c.key, "left")).toEqual({ tabs: [c, d], active: d.key });
    expect(closeTabs({ ...state, active: a.key }, c.key, "left")).toEqual({
      tabs: [c, d],
      active: c.key,
    });
    expect(closeTabs(state, b.key, "others")).toEqual({ tabs: [b], active: b.key });
    expect(closeTabs(state, b.key, "close")).toEqual({ tabs: [a, c, d], active: d.key });
    expect(closeTabs(state, b.key, "all")).toEqual({ tabs: [], active: null });
    expect(closeTabs(state, "stale", "others")).toBe(state);
    expect(closeTabs(state, a.key, "left")).toBe(state);
    expect(closeTabs(state, d.key, "right")).toBe(state);
  });
  it("copies workspace-relative paths including submodules and native absolute paths", () => {
    expect(filePaths({ directory: "/workspace/", relativePath: "" }, "docs/a b.md")).toEqual({
      absolute: "/workspace/docs/a b.md",
      relative: "docs/a b.md",
    });
    expect(
      filePaths(
        { directory: "/workspace/modules/child", relativePath: "modules/child" },
        "src/a.ts",
      ),
    ).toEqual({
      absolute: "/workspace/modules/child/src/a.ts",
      relative: "modules/child/src/a.ts",
    });
    expect(filePaths({ directory: "C:\\workspace\\", relativePath: "." }, "docs/a.md")).toEqual({
      absolute: "C:\\workspace\\docs\\a.md",
      relative: "docs/a.md",
    });
  });
});
describe("language highlighting", () => {
  it("preserves complete text while separating code, comments, strings and numbers", () => {
    const input = 'const value = "hello"; // 42';
    const { tokens } = tokenizeLine(input, languageForPath("index.ts"));
    expect(tokens.map((token) => token.text).join("")).toBe(input);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { text: "const", kind: "keyword" },
        { text: '"hello"', kind: "string" },
        { text: "// 42", kind: "comment" },
      ]),
    );
    expect(tokenizeLine("count: 42", "yaml").tokens).toEqual(
      expect.arrayContaining([
        { text: "count", kind: "property" },
        { text: "42", kind: "number" },
      ]),
    );
    expect(tokenizeLine("SELECT name FROM users", "sql").tokens[0].kind).toBe("keyword");
  });
  it("tracks multiline comments independently on both sides of a changed hunk", () => {
    const hunk = hunkSchema.parse({
      header: "@@ -1,3 +1,3 @@",
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [
        { kind: "removed", content: "/* old", oldLine: 1, newLine: null },
        { kind: "added", content: "const next = 1;", oldLine: null, newLine: 1 },
        { kind: "removed", content: "inside comment */", oldLine: 2, newLine: null },
        { kind: "added", content: "const other = 2;", oldLine: null, newLine: 2 },
      ],
    });
    const states = diffSyntaxStates([hunk], "typescript");
    expect(
      tokenizeLine(hunk.lines[2].content, "typescript", states.get(hunk.lines[2])).tokens[0].kind,
    ).toBe("comment");
    expect(
      tokenizeLine(hunk.lines[3].content, "typescript", states.get(hunk.lines[3])).tokens[0].kind,
    ).toBe("keyword");
    const start = tokenizeLine('text = """first', "python");
    expect(tokenizeLine('second"""', "python", start.state).state.quote).toBeUndefined();
  });
  it("bounds pathological token counts and keeps the remaining text intact", () => {
    const input = "x+".repeat(10000);
    const result = tokenizeLine(input, "typescript");
    expect(result.tokens.length).toBeLessThanOrEqual(1025);
    expect(result.tokens.map((token) => token.text).join("")).toBe(input);
  });
});
describe("file preview", () => {
  it("keeps huge malformed Markdown lines readable without link-parser backtracking", () => {
    const input = "[".repeat(100000);
    expect(markdownHtml(input)).toBe(`<p>${input}</p>`);
  });
  it("renders headings, tables, tasks, fenced code and quotes", () => {
    const html = markdownHtml(
      "# Title\n\n| Name | Value |\n| --- | --- |\n| test | **yes** |\n\n- [x] done\n\n> note\n\n```ts\nconst x = 1;\n```\n",
    );
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain("<table>");
    expect(html).toContain("<strong>yes</strong>");
    expect(html).toContain("disabled checked");
    expect(html).toContain("<blockquote>note</blockquote>");
    expect(html).toContain("<pre><code><span");
  });
  it("escapes raw Markdown HTML and rejects executable links and external image requests", () => {
    const html = markdownHtml(
      '<img src=x onerror="alert(1)">\n\n[click](javascript:alert) ![remote](https://example.com/a.png) `</code><script>bad()</script>`',
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
  });
  it("renders inline code inside file links without leaking placeholders", () => {
    const html = markdownHtml(
      "入口为项目 skill [`remote-device-lab`](../.harness/skills/remote-device-lab/SKILL.md)：\n\n[`**literal**`](javascript:bad) [**网页**](https://example.com/a_(b))\n\n[space](<./a b.md>)",
    );
    expect(html).toContain(
      'href="../.harness/skills/remote-device-lab/SKILL.md" rel="noreferrer noopener"><code>remote-device-lab</code></a>',
    );
    expect(html).toContain("<code>**literal**</code>");
    expect(html).toContain('href="https://example.com/a_(b)"');
    expect(html).toContain('href="./a b.md"');
    expect(html).not.toMatch(/[\uE000\uE001]/);
    expect(html).not.toContain("javascript:");
  });
  it("supports stable Unicode heading anchors and escaped web autolinks", () => {
    const html = markdownHtml(
      "# 安装 与 `运行`\n\n# 安装 与 `运行`\n\n[跳转](#安装-与-运行)\n\n<https://example.com/a_b?q=1&b=2> https://example.com/path.",
    );
    expect(html).toContain('id="安装-与-运行"');
    expect(html).toContain('id="安装-与-运行-1"');
    expect(html).toContain('href="#安装-与-运行"');
    expect(html).toContain('href="https://example.com/a_b?q=1&amp;b=2"');
    expect(html).toContain('href="https://example.com/path"');
  });
  it("restricts navigation scripts to Markdown and keeps code readers escaped and highlighted", () => {
    const colors = {
      background: "#fff",
      foreground: "#111",
      muted: "#555",
      border: "#ddd",
      accent: "#00f",
    };
    const options = {
      navigation: { token: "trusted-token", nonce: "trusted-bridge" },
      filePath: "src/a.ts",
    };
    const markdown = previewDocument("[file](a.md)", "markdown", colors, 13, options);
    expect(markdown).toContain("script-src 'nonce-trusted-bridge'");
    expect(markdown).toContain('nonce="trusted-bridge"');
    expect(markdown).toContain("git-preview-link");
    expect(previewDocument("<p>HTML</p>", "html", colors, 13, options)).not.toContain("<script");
    const code = previewDocument('const value = "<script>";', "code", colors, 13, options);
    expect(code).toContain("&lt;script&gt;");
    expect(code).toContain('<span style="color:');
    expect(code).not.toContain("<script");
  });
  it("restricts preview document resources and strips navigation metadata", () => {
    const html = previewDocument(
      '<meta http-equiv="refresh" content="0;url=https://example.com"><base href="https://example.com"><h1>Preview</h1>',
      "html",
      { background: "#fff", foreground: "#111", muted: "#555", border: "#ddd", accent: "#00f" },
      12,
    );
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).not.toContain("<base ");
    expect(html).toContain("<h1>Preview</h1>");
  });
  it("recognizes Mermaid fences and keeps hostile diagram source inert", () => {
    const source = '```mermaid\ngraph LR\nA["</pre></details><script>bad()</script>"]\n```';
    expect(hasMermaid(source)).toBe(true);
    expect(hasMermaid("~~~mermaid title\ngraph LR\nA-->B\n~~~")).toBe(true);
    expect(hasMermaid("```ts\nconst mermaid = 1;\n```")).toBe(false);
    const html = markdownHtml(source);
    expect(html).toContain('class="mermaid-source"');
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("only grants the bundled renderer a nonce in Markdown previews", () => {
    const colors = {
      background: "#fff",
      foreground: "#111",
      muted: "#555",
      border: "#ddd",
      accent: "#00f",
    };
    const options = { mermaid: { gzip: "eJw=", nonce: "trusted-renderer" } };
    const markdown = previewDocument(
      "```mermaid\ngraph LR\nA-->B\n```",
      "markdown",
      colors,
      13,
      options,
    );
    expect(markdown).toContain("script-src 'nonce-trusted-renderer'");
    expect(markdown).toContain("securityLevel: 'strict'");
    expect(markdown).toContain("connect-src 'none'");
    expect(markdown).not.toContain("'unsafe-eval'");
    const html = previewDocument("<h1>HTML</h1>", "html", colors, 13, options);
    expect(html).not.toContain("script-src");
    expect(html).not.toContain("<script");
  });
});
