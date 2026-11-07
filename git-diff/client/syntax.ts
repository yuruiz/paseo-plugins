import type { DiffHunk, DiffLine } from "../shared/contracts";

export type TokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "type"
  | "function"
  | "property"
  | "operator"
  | "tag";
export type SyntaxToken = { text: string; kind: TokenKind };
export type SyntaxState = { block?: string; quote?: string };
export type Language =
  | "javascript"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "c"
  | "ruby"
  | "shell"
  | "json"
  | "yaml"
  | "html"
  | "css"
  | "sql"
  | "markdown"
  | "plain";
const languageExtensions: Record<string, Language> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "java",
  kts: "java",
  cs: "java",
  swift: "java",
  c: "c",
  h: "c",
  cpp: "c",
  hpp: "c",
  cc: "c",
  rb: "ruby",
  erb: "ruby",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "shell",
  json: "json",
  jsonc: "json",
  json5: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "yaml",
  html: "html",
  htm: "html",
  xml: "html",
  xhtml: "html",
  svg: "html",
  vue: "html",
  svelte: "html",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
};
export function languageForPath(path: string): Language {
  const name = path.split("/").at(-1)?.toLowerCase() || "";
  if (name === "dockerfile" || name === "makefile" || name.startsWith(".env")) return "shell";
  return languageExtensions[name.split(".").at(-1) || ""] ?? "plain";
}
const common =
  "if else for while do return break continue switch case default try catch finally throw new class extends static public private protected import export from as async await function const let var true false null undefined this super typeof instanceof void delete in of with yield interface type enum implements package struct impl fn pub mod use trait match move mut ref self Self where loop defer select map range chan func go fallthrough namespace using virtual override readonly abstract get set";
const extras: Partial<Record<Language, string>> = {
  python:
    "def elif except lambda pass raise None True False and or not is print from global nonlocal assert del with yield async await",
  ruby: "def end unless elsif then begin rescue ensure require include module attr_reader attr_accessor nil puts do until",
  shell:
    "then fi esac elif done echo set unset source local function export exit read test sudo cd cat printf case in do",
  sql: "select from where join left right inner outer on insert into update delete create table drop alter values group by having order asc desc limit offset union all distinct as and or not null primary key foreign references index exists set case when then else end begin commit rollback",
  css: "important inherit initial unset auto none block flex grid relative absolute fixed sticky inline display",
};
const keywords = new Map<Language, Set<string>>();
for (const language of Object.values(languageExtensions))
  keywords.set(language, new Set(`${common} ${extras[language] || ""}`.split(/\s+/)));

// Bounded line lexer. It carries multiline comments/strings independently on the
// old and new sides, and leaves unsupported syntax as readable plain text.
export function tokenizeLine(
  content: string,
  language: Language,
  initial: SyntaxState = {},
  collect = true,
): { tokens: SyntaxToken[]; state: SyntaxState } {
  const tokens: SyntaxToken[] = [];
  const state = { ...initial };
  if (language === "plain")
    return { tokens: collect ? [{ text: content, kind: "plain" }] : [], state };
  let cursor = 0;
  let count = 0;
  function add(end: number, kind: TokenKind) {
    if (collect) {
      const text = content.slice(cursor, end);
      const previous = tokens.at(-1);
      if (previous?.kind === kind) previous.text += text;
      else tokens.push({ text, kind });
    }
    cursor = end;
  }
  while (cursor < content.length && count++ < 1024) {
    const rest = content.slice(cursor);
    if (state.block) {
      const end = content.indexOf(state.block, cursor);
      add(end < 0 ? content.length : end + state.block.length, "comment");
      if (end >= 0) state.block = undefined;
      continue;
    }
    if (state.quote) {
      const quote = state.quote;
      let end = cursor;
      while (end < content.length) {
        if (content[end] === "\\") {
          end += 2;
          continue;
        }
        if (content.startsWith(quote, end)) {
          end += quote.length;
          state.quote = undefined;
          break;
        }
        end++;
      }
      add(Math.min(end, content.length), "string");
      continue;
    }
    if (rest.startsWith("/*") && !["python", "shell", "ruby", "markdown"].includes(language)) {
      state.block = "*/";
      add(cursor + 2, "comment");
      continue;
    }
    if (rest.startsWith("<!--") && language === "html") {
      state.block = "-->";
      add(cursor + 4, "comment");
      continue;
    }
    if (
      (rest.startsWith("//") &&
        !["python", "shell", "ruby", "yaml", "markdown", "css"].includes(language)) ||
      (rest.startsWith("#") && ["python", "shell", "ruby", "yaml"].includes(language)) ||
      (rest.startsWith("--") && language === "sql")
    ) {
      add(content.length, "comment");
      continue;
    }
    if (language === "markdown") {
      const match =
        /^(?:#{1,6}\s.*|>.*|```.*|~~~.*|\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|!?\[[^\]]*\]\([^)]*\))/.exec(
          rest,
        );
      if (match) {
        add(cursor + match[0].length, rest.startsWith("#") ? "keyword" : "string");
        continue;
      }
    }
    const triple = language === "python" && (rest.startsWith('"""') || rest.startsWith("'''"));
    if (triple || /^["'`]/.test(rest)) {
      const quote = triple ? rest.slice(0, 3) : rest[0];
      const start = cursor;
      let end = cursor + quote.length;
      let closed = false;
      while (end < content.length) {
        if (content[end] === "\\") {
          end += 2;
          continue;
        }
        if (content.startsWith(quote, end)) {
          end += quote.length;
          closed = true;
          break;
        }
        end++;
      }
      if (!closed && (triple || quote === "`")) state.quote = quote;
      const isKey = ["json", "yaml"].includes(language) && /^\s*:/.test(content.slice(end));
      add(Math.min(end, content.length), isKey ? "property" : "string");
      if (cursor <= start) add(start + 1, "plain");
      continue;
    }
    const tag = language === "html" ? /^<\/?[\w.:-]+|^\/?\s*>/.exec(rest) : null;
    if (tag) {
      add(cursor + tag[0].length, "tag");
      continue;
    }
    const number = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
      rest,
    );
    if (number) {
      add(cursor + number[0].length, "number");
      continue;
    }
    const identifier = /^[$@\p{L}_][\p{L}\p{N}_$@-]*/u.exec(rest);
    if (identifier) {
      const word = identifier[0];
      const after = content.slice(cursor + word.length);
      const keyword = keywords.get(language)?.has(language === "sql" ? word.toLowerCase() : word);
      const property = /^\s*[:=]/.test(after) && ["json", "yaml", "css", "html"].includes(language);
      add(
        cursor + word.length,
        keyword
          ? "keyword"
          : property
            ? "property"
            : /^\s*\(/.test(after)
              ? "function"
              : /^[A-Z]/.test(word)
                ? "type"
                : "plain",
      );
      continue;
    }
    const whitespace = /^\s+/.exec(rest);
    add(
      cursor + (whitespace?.[0].length || 1),
      whitespace ? "plain" : /[=+*/!<>|&?:%-]/.test(rest[0]) ? "operator" : "plain",
    );
  }
  if (cursor < content.length) add(content.length, "plain");
  return { tokens, state };
}

export function diffSyntaxStates(
  hunks: DiffHunk[],
  language: Language,
): WeakMap<DiffLine, SyntaxState> {
  const states = new WeakMap<DiffLine, SyntaxState>();
  for (const hunk of hunks) {
    let oldState: SyntaxState = {};
    let newState: SyntaxState = {};
    for (const line of hunk.lines) {
      if (line.kind === "meta") continue;
      const current = line.kind === "removed" ? oldState : newState;
      states.set(line, current);
      const text = line.content.slice(0, 2000);
      if (line.kind !== "added") oldState = tokenizeLine(text, language, oldState, false).state;
      if (line.kind !== "removed") newState = tokenizeLine(text, language, newState, false).state;
    }
  }
  return states;
}

export function syntaxPalette(background: string) {
  const hex = background.replace("#", "");
  const normalized = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
  const light =
    /^[\da-f]{6}$/i.test(normalized) &&
    Number.parseInt(normalized.slice(0, 2), 16) * 0.299 +
      Number.parseInt(normalized.slice(2, 4), 16) * 0.587 +
      Number.parseInt(normalized.slice(4, 6), 16) * 0.114 >
      155;
  return light
    ? {
        keyword: "#af00db",
        string: "#a31515",
        comment: "#008000",
        number: "#098658",
        type: "#267f99",
        function: "#795e26",
        property: "#0451a5",
        operator: "#555555",
        tag: "#800000",
      }
    : {
        keyword: "#c586c0",
        string: "#ce9178",
        comment: "#6a9955",
        number: "#b5cea8",
        type: "#4ec9b0",
        function: "#dcdcaa",
        property: "#9cdcfe",
        operator: "#d4d4d4",
        tag: "#569cd6",
      };
}
