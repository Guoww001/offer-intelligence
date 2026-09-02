export interface MarkdownRenderOptions {
  readonly allowTables?: boolean;
  readonly allowLinks?: boolean;
}

const DEFAULT_OPTIONS: Required<MarkdownRenderOptions> = {
  allowTables: true,
  allowLinks: true
};

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] || character);
}

function safeUrl(value: string): string | null {
  const url = value.trim();
  if (/^(?:https?:|mailto:)/i.test(url)) return url;
  if (/^\/(?!\/)/.test(url) || /^#[a-z0-9_-]+$/i.test(url)) return url;
  return null;
}

function inlineHtml(markdown: string, options: Required<MarkdownRenderOptions>): string {
  const placeholders: string[] = [];
  const protect = (html: string): string => {
    const marker = `\u0000MD${placeholders.length}\u0000`;
    placeholders.push(html);
    return marker;
  };

  let source = String(markdown);
  source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, alt: string, url: string) => {
    const href = safeUrl(url);
    if (!href) return escapeHtml(alt);
    return protect(`<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" style="max-width:100%">`);
  });
  source = source.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_match, label: string, url: string) => {
    if (!options.allowLinks) return escapeHtml(label);
    const href = safeUrl(url);
    if (!href) return escapeHtml(label);
    return protect(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`);
  });
  source = source.replace(/`([^`\n]+)`/g, (_match, code: string) => protect(`<code>${escapeHtml(code)}</code>`));

  let html = escapeHtml(source)
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>");

  placeholders.forEach((replacement, index) => {
    html = html.replace(`\u0000MD${index}\u0000`, replacement);
  });
  return html;
}

function tableCells(line: string): string[] {
  const source = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return source.split("|").map((cell) => cell.trim());
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderTable(lines: readonly string[], start: number, options: Required<MarkdownRenderOptions>): { html: string; next: number } {
  if (!options.allowTables || !isTableLine(lines[start] || "") || !isTableLine(lines[start + 1] || "") || !isTableDivider(lines[start + 1] || "")) {
    return { html: "", next: start };
  }
  const header = tableCells(lines[start] || "");
  let index = start + 2;
  const rows: string[][] = [];
  while (index < lines.length && isTableLine(lines[index] || "")) {
    rows.push(tableCells(lines[index] || ""));
    index += 1;
  }
  const html = [
    '<div class="table-wrap">',
    "<table>",
    `<thead><tr>${header.map((cell) => `<th>${inlineHtml(cell, options)}</th>`).join("")}</tr></thead>`,
    "<tbody>",
    ...rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineHtml(cell, options)}</td>`).join("")}</tr>`),
    "</tbody>",
    "</table>",
    "</div>"
  ].join("\n");
  return { html, next: index };
}

function renderList(lines: readonly string[], start: number, options: Required<MarkdownRenderOptions>): { html: string; next: number } {
  const first = lines[start] || "";
  const ordered = /^\d+\.\s+/.test(first.trim());
  const items: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] || "";
    const match = ordered ? line.trim().match(/^\d+\.\s+(.+)$/) : line.trim().match(/^[-*+]\s+(.+)$/);
    if (!match?.[1]) break;
    const task = match[1].match(/^\[(x| )\]\s+(.+)$/i);
    if (task?.[2]) {
      const checked = task[1]?.toLowerCase() === "x";
      items.push(`<li class="task-list-item${checked ? " done" : ""}"><input type="checkbox"${checked ? " checked" : ""} disabled> ${inlineHtml(task[2], options)}</li>`);
    } else {
      items.push(`<li>${inlineHtml(match[1], options)}</li>`);
    }
    index += 1;
  }
  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>\n${items.join("\n")}\n</${tag}>`, next: index };
}

function renderBlockquote(lines: readonly string[], start: number, options: Required<MarkdownRenderOptions>): { html: string; next: number } {
  const content: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] || "";
    const match = line.trim().match(/^>\s?(.*)$/);
    if (!match) break;
    content.push(`<p>${inlineHtml(match[1] || "", options)}</p>`);
    index += 1;
  }
  return { html: `<blockquote>\n${content.join("\n")}\n</blockquote>`, next: index };
}

export function renderMarkdownToHtml(
  markdown: string,
  inputOptions: MarkdownRenderOptions = {}
): string {
  if (!markdown) return "";
  const options = { ...DEFAULT_OPTIONS, ...inputOptions };
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] || "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```([a-z0-9_-]*)\s*$/i);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test((lines[index] || "").trim())) {
        code.push(lines[index] || "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      const languageClass = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      output.push(`<pre><code${languageClass}>${escapeHtml(code.join("\n").replace(/\n$/, ""))}</code></pre>`);
      continue;
    }

    const table = renderTable(lines, index, options);
    if (table.next > index) {
      output.push(table.html);
      index = table.next;
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (match?.[1] && match[2]) output.push(`<h${match[1].length}>${inlineHtml(match[2], options)}</h${match[1].length}>`);
      index += 1;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      output.push("<hr>");
      index += 1;
      continue;
    }
    if (/^(?:[-*+]\s+|\d+\.\s+)/.test(trimmed)) {
      const list = renderList(lines, index, options);
      output.push(list.html);
      index = list.next;
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      const blockquote = renderBlockquote(lines, index, options);
      output.push(blockquote.html);
      index = blockquote.next;
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] || "";
      const nextTrimmed = next.trim();
      if (!nextTrimmed || /^```/.test(nextTrimmed) || /^#{1,6}\s+/.test(nextTrimmed)
        || /^(?:[-*+]\s+|\d+\.\s+|>\s?)/.test(nextTrimmed)
        || /^(?:-{3,}|\*{3,}|_{3,})$/.test(nextTrimmed)
        || (options.allowTables && isTableLine(nextTrimmed))) break;
      paragraph.push(next);
      index += 1;
    }
    output.push(`<p>${paragraph.map((part) => inlineHtml(part, options)).join("\n")}</p>`);
  }

  return output.join("\n").trim();
}
