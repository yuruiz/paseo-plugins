import { parsePreviewLink } from "../shared/preview-links";
import { mermaidScript } from "./mermaid-preview";
import { previewBridge } from "./preview-bridge";
import { languageForPath, syntaxPalette, tokenizeLine } from "./syntax";

export type PreviewKind = "markdown" | "html" | "image" | "code";
export function previewKind(path: string): PreviewKind | null {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (["md", "markdown"].includes(extension || "")) return "markdown";
  if (["html", "htm", "xhtml"].includes(extension || "")) return "html";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "avif", "bmp"].includes(extension || ""))
    return "image";
  return null;
}
export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function safeUrl(url: string, image = false) {
  const trimmed = url.trim();
  if (image)
    return /^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z\d+/=]+$/i.test(trimmed)
      ? trimmed
      : null;
  return parsePreviewLink(trimmed) ? trimmed : null;
}
function inline(text: string): string {
  // Very long lines and unmatched bracket runs stay plain instead of causing
  // repeated backtracking in link/emphasis recognition.
  if (text.length > 4096 || (text.match(/\[/g)?.length ?? 0) > 64) return escapeHtml(text);
  const slots: { html: string; text: string }[] = [];
  const plain = (value: string) =>
    value.replace(/\uE000(\d+)\uE001/g, (_, index: string) => slots[Number(index)]?.text ?? "");
  const format = (value: string) =>
    escapeHtml(value)
      .replace(
        /\*\*([^*]+)\*\*|__([^_]+)__/g,
        (_, a: string, b: string) => `<strong>${a || b}</strong>`,
      )
      .replace(/~~([^~]+)~~/g, "<del>$1</del>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, "$1<em>$2</em>")
      .replace(/\uE000(\d+)\uE001/g, (_, index: string) => slots[Number(index)]?.html ?? "");
  // Protect code and links before applying emphasis, so their content cannot
  // become executable markup and underscores in URLs never turn into tags.
  let source = text.replace(/`([^`]+)`/g, (_, code: string) => {
    const index = slots.push({ html: `<code>${escapeHtml(code)}</code>`, text: code }) - 1;
    return `\uE000${index}\uE001`;
  });
  source = source.replace(
    /(!?)\[([^\]]*)\]\((<[^>\n]+>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"[^"]*")?\)/g,
    (_, image: string, label: string, url: string) => {
      const href = safeUrl(url.startsWith("<") ? url.slice(1, -1) : url, Boolean(image));
      const labelText = plain(label);
      const content = image
        ? href
          ? `<img alt="${escapeHtml(labelText)}" src="${escapeHtml(href)}">`
          : `<span class="asset">🖼 ${escapeHtml(labelText || url)}（图片路径）</span>`
        : href
          ? `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${format(label)}</a>`
          : format(label);
      const index = slots.push({ html: content, text: labelText }) - 1;
      return `\uE000${index}\uE001`;
    },
  );
  source = source.replace(
    /<(https?:\/\/[^<>\s]+)>|\b(https?:\/\/[^\s<>\uE000\uE001]+)/g,
    (_, angle: string, bare: string) => {
      const full = angle || bare;
      const url = angle ? full : full.replace(/[.,;!?)]+$/, "");
      const href = safeUrl(url);
      if (!href) return full;
      const index =
        slots.push({
          html: `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${escapeHtml(url)}</a>`,
          text: url,
        }) - 1;
      return `\uE000${index}\uE001${full.slice(url.length)}`;
    },
  );
  return format(source);
}

// A small, deterministic reader for headings, paragraphs, lists, tasks, tables,
// quotes and fenced code. Raw HTML is escaped in Markdown documents.
export function markdownHtml(source: string, background = "#1f1f1f"): string {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .replaceAll("\uE000", "")
    .replaceAll("\uE001", "")
    .split("\n");
  const blocks: string[] = [];
  const palette = syntaxPalette(background);
  const headingIds = new Map<string, number>();
  function headingId(text: string) {
    const slug =
      text
        .toLowerCase()
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[^\p{L}\p{N}_\-\s]/gu, "")
        .trim()
        .replace(/\s+/g, "-") || "section";
    const count = headingIds.get(slug) ?? 0;
    headingIds.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  }
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    const fence = /^\s{0,3}(`{3,}|~{3,})([\w+-]*)/.exec(line);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence[1]))
        code.push(lines[index++]);
      if (index < lines.length) index++;
      if (fence[2].toLowerCase() === "mermaid") {
        blocks.push(
          `<figure class="mermaid-diagram" data-state="pending"><div class="mermaid-display" aria-busy="true">正在加载 Mermaid 图表…</div><details><summary>Mermaid 源码</summary><pre class="mermaid-source">${escapeHtml(code.join("\n"))}</pre></details></figure>`,
        );
        continue;
      }
      const language = languageForPath(`file.${fence[2] || "txt"}`);
      let state = {};
      const highlighted = code
        .map((text) => {
          const tokenized = tokenizeLine(text.slice(0, 4000), language, state);
          state = tokenized.state;
          return (
            tokenized.tokens
              .map((token) =>
                token.kind === "plain"
                  ? escapeHtml(token.text)
                  : `<span style="color:${palette[token.kind]}">${escapeHtml(token.text)}</span>`,
              )
              .join("") + escapeHtml(text.slice(4000))
          );
        })
        .join("\n");
      blocks.push(`<pre><code>${highlighted}</code></pre>`);
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if (heading) {
      blocks.push(
        `<h${heading[1].length} id="${escapeHtml(headingId(heading[2]))}">${inline(heading[2])}</h${heading[1].length}>`,
      );
      index++;
      continue;
    }
    if (/^\s{0,3}(?:---+|\*\s*\*\s*\*[*\s]*|___+)\s*$/.test(line)) {
      blocks.push("<hr>");
      index++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index]))
        quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      // Iteration limit prevents pathological recursive quote input.
      blocks.push(
        `<blockquote>${quote.map((part) => inline(part.replace(/^(?:>\s*)+/, ""))).join("<br>")}</blockquote>`,
      );
      continue;
    }
    const list = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)/.exec(line);
    if (list) {
      const ordered = Boolean(list[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)/.exec(lines[index]);
        if (!item || Boolean(item[2]) !== ordered) break;
        const task = /^\[([ xX])\]\s+(.*)/.exec(item[3]);
        items.push(
          `<li>${task ? `<input type="checkbox" disabled${task[1].trim() ? " checked" : ""}> ${inline(task[2])}` : inline(item[3])}</li>`,
        );
        index++;
      }
      blocks.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (
      line.includes("|") &&
      index + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
    ) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => inline(cell.trim()));
      const headers = cells(line);
      index += 2;
      const rows: string[] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim())
        rows.push(
          `<tr>${cells(lines[index++])
            .map((cell) => `<td>${cell}</td>`)
            .join("")}</tr>`,
        );
      blocks.push(
        `<div class="table"><table><thead><tr>${headers.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
      );
      continue;
    }
    if (index + 1 < lines.length && /^\s*(?:={3,}|-{3,})\s*$/.test(lines[index + 1])) {
      const level = lines[index + 1].trim().startsWith("=") ? 1 : 2;
      blocks.push(`<h${level} id="${escapeHtml(headingId(line))}">${inline(line)}</h${level}>`);
      index += 2;
      continue;
    }
    const paragraph = [line];
    index++;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,})/.test(lines[index])
    ) {
      if (lines[index + 1]?.includes("---") && lines[index].includes("|")) break;
      paragraph.push(lines[index++]);
    }
    blocks.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
  }
  return blocks.join("\n");
}

export function previewDocument(
  content: string,
  kind: PreviewKind,
  colors: { background: string; foreground: string; muted: string; border: string; accent: string },
  fontSize: number,
  options: {
    fontFamily?: string;
    fontWeight?: string;
    mermaid?: { gzip: string; nonce: string };
    navigation?: { token: string; nonce: string };
    filePath?: string;
  } = {},
): string {
  const css = `:root{color-scheme:${syntaxPalette(colors.background).keyword === "#af00db" ? "light" : "dark"}}*{box-sizing:border-box}html{min-height:100%;background:${colors.background};color:${colors.foreground}}body{margin:0;padding:24px clamp(16px,4vw,48px);font: ${fontSize + 2}px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow-wrap:anywhere}body.markdown{max-width:960px;margin:auto}h1,h2,h3,h4{line-height:1.3;margin:1.1em 0 .5em}h1,h2{border-bottom:1px solid ${colors.border};padding-bottom:.3em}h1{font-size:1.8em}h2{font-size:1.45em}p,ul,ol,pre,table,blockquote{margin:.8em 0}pre{padding:14px;overflow:auto;border:1px solid ${colors.border};border-radius:4px;background:${colors.background}}code{font: .88em/1.65 Menlo,Consolas,monospace;white-space:pre-wrap}pre code{white-space:pre}p code,li code{padding:2px 4px;background:${colors.border};border-radius:3px}blockquote{border-left:3px solid ${colors.border};color:${colors.muted};padding:0 14px}a{color:${colors.accent}}img{max-width:100%;height:auto}hr{border:0;border-top:1px solid ${colors.border}}.table{overflow:auto}table{border-collapse:collapse}th,td{border:1px solid ${colors.border};padding:6px 12px}th{text-align:left}.asset{color:${colors.muted};font-size:.9em}li input{vertical-align:middle}::-webkit-scrollbar{width:7px;height:7px}::-webkit-scrollbar-thumb{background:${colors.border};border-radius:6px}html{scrollbar-width:thin;scrollbar-color:${colors.border} transparent}`;
  const typographyCss = `code,pre{font-family:${options.fontFamily ?? "SFMono-Regular,Menlo,Monaco,Consolas,monospace"};font-weight:${options.fontWeight ?? "500"}}.mermaid-diagram{margin:1.2em 0;padding:14px;border:1px solid ${colors.border};border-radius:4px}.mermaid-display{overflow:auto;min-height:48px;font-size:12px;color:${colors.muted}}.mermaid-display svg{display:block;max-width:100%;height:auto;margin:auto}.mermaid-display svg *{filter:none!important}.mermaid-diagram details{font-size:12px;color:${colors.muted};margin-top:10px}.mermaid-diagram summary{cursor:pointer}.mermaid-source{font-size:12px}body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}`;
  let sourceCode = "";
  if (kind === "code") {
    let state = {};
    const palette = syntaxPalette(colors.background);
    sourceCode = content
      .split("\n")
      .map((line, index) => {
        if (index >= 5000 || line.length > 4000) return escapeHtml(line);
        const result = tokenizeLine(line, languageForPath(options.filePath ?? "file.txt"), state);
        state = result.state;
        return result.tokens
          .map((token) =>
            token.kind === "plain"
              ? escapeHtml(token.text)
              : `<span style="color:${palette[token.kind]}">${escapeHtml(token.text)}</span>`,
          )
          .join("");
      })
      .join("\n");
  }
  const body =
    kind === "markdown"
      ? markdownHtml(content, colors.background)
      : kind === "image"
        ? `<img alt="文件预览" src="${escapeHtml(content)}">`
        : kind === "code"
          ? `<pre><code>${sourceCode}</code></pre>`
          : content.replace(/<meta\b[^>]*>/gi, "").replace(/<base\b[^>]*>/gi, "");
  const mermaid = kind === "markdown" ? options.mermaid : undefined;
  const navigation = kind === "markdown" ? options.navigation : undefined;
  const nonces = [mermaid?.nonce, navigation?.nonce].filter(Boolean);
  const script = mermaid
    ? `<script nonce="${mermaid.nonce}">${mermaidScript(mermaid.gzip, mermaid.nonce, syntaxPalette(colors.background).keyword === "#af00db")}</script>`
    : "";
  const bridge = navigation
    ? `<script nonce="${navigation.nonce}">${previewBridge(navigation.token)}</script>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${nonces.length ? `script-src ${[...new Set(nonces)].map((nonce) => `'nonce-${nonce}'`).join(" ")};` : ""} style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'; connect-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${typographyCss}body.code{max-width:none;padding:16px;font-size:${fontSize}px}body.code pre{margin:0;padding:0;border:0}body.code code{font-size:1em}</style></head><body class="${kind}">${body}${bridge}${script}</body></html>`;
}
