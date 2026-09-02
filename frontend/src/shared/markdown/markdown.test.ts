import { describe, expect, it } from "vitest";

import { renderMarkdownToHtml } from "./markdown";

describe("renderMarkdownToHtml", () => {
  it("renders the help-document blocks used by Chatbot", () => {
    const html = renderMarkdownToHtml([
      "# Report Mode",
      "",
      "**核心指标** 与 `EPC`。",
      "",
      "- 第一项",
      "- 第二项",
      "",
      "| Metric | Value |",
      "| --- | --- |",
      "| EPC | 1.20 |",
      "",
      "> 只读数据"
    ].join("\n"));

    expect(html).toContain("<h1>Report Mode</h1>");
    expect(html).toContain("<strong>核心指标</strong>");
    expect(html).toContain("<code>EPC</code>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>第一项</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Metric</th>");
    expect(html).toContain("<td>1.20</td>");
    expect(html).toContain("<blockquote>");
  });

  it("escapes raw HTML and rejects unsafe links", () => {
    const html = renderMarkdownToHtml('<script>alert("x")</script> [open](javascript:alert(1))');

    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("open");
  });

  it("keeps fenced code and UTF-8 chunks intact", () => {
    const html = renderMarkdownToHtml("```ts\nconst greeting = '你好';\n```\n\n结论：数据可用。");

    expect(html).toContain('<pre><code class="language-ts">const greeting = &#39;你好&#39;;</code></pre>');
    expect(html).toContain("<p>结论：数据可用。</p>");
  });
});
