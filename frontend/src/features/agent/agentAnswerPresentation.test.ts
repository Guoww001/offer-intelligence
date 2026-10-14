import { describe, expect, it } from "vitest";
import { presentAgentAnswerHtml } from "./agentAnswerPresentation";

const html = '<p>结论：三家表现不同。</p><p>共同完整期间：2026-06 至 2026-09。</p><div class="table-wrap"><table><tbody><tr><td>第一比较表</td></tr></tbody></table></div><ul><li>发现一</li><li>发现二</li><li>发现三</li></ul><p>趋势比较说明</p><div class="table-wrap"><table><tbody><tr><td>第二趋势表</td></tr></tbody></table></div><ul><li>趋势发现一</li><li>趋势发现二</li></ul><p>完整累计说明 <a href="https://example.com">来源链接</a></p><pre><code>代码证据</code></pre>';
const parse = (value: string) => { const node = document.createElement("div"); node.innerHTML = value; return node; };

describe("Agent 静态回答展示", () => {
  it("普通结论标签不占用业务结论的位置", () => {
    const source = '<p>结论</p><p>业务事实。</p><p>额外分析。</p>';
    const result = parse(presentAgentAnswerHtml(source, "分析", "zh"));
    expect(Array.from(result.querySelectorAll(":scope > p")).map(node => node.textContent)).toEqual(["结论", "业务事实。"]);
  });
  it("仅表格请求没有可用表格时仍直接显示无数据说明", () => {
    const source = '<p>当前条件没有符合的商户，无法生成对比表。</p>';
    expect(presentAgentAnswerHtml(source, "只要一张表", "zh")).toBe(source);
  });
  it.each(["p", "h2"])("%s 加粗或标题中的实质业务结论直接显示", (tag) => {
    const conclusion = "结论：Shokz收入增长，Roborock下降。";
    const source = `<${tag}><strong>${conclusion}</strong></${tag}><p>共同完整期间：2026-06 至2026-09</p><p>详细说明。</p>`;
    const result = parse(presentAgentAnswerHtml(source, "比较表现", "zh"));
    expect(result.querySelector(`:scope > ${tag}`)?.textContent).toBe(conclusion);
    expect(result.querySelector("details")?.textContent).toContain("详细说明");
    expect(result.querySelector("details")?.textContent).not.toContain(conclusion);
    result.querySelector("summary")?.remove();
    expect(result.textContent).toBe(parse(source).textContent);
  });

  it("仅含标签的结论标题保留并直接展示随后正文，其他短标签不冒充结论", () => {
    const source = '<h2>结论</h2><p>业务事实。</p><p><strong>关键发现</strong></p><p><strong>说明</strong></p><p>详细说明。</p>';
    const result = parse(presentAgentAnswerHtml(source, "比较表现", "zh"));
    expect(result.querySelector(":scope > h2")?.textContent).toBe("结论");
    expect(result.querySelector(":scope > p")?.textContent).toBe("业务事实。");
    expect(result.querySelector("details")?.textContent).toContain("关键发现");
    expect(result.querySelector("details")?.textContent).toContain("说明");
  });
  it("真实结论标题和实质结论都显示，其他标题完整收起", () => {
    const source = '<p><strong>结论</strong></p><p>这是业务结论长句。</p><p>共同完整期间：2026-06 至2026-09</p><p><strong>额外分析</strong></p><p>完整说明</p>';
    const result = parse(presentAgentAnswerHtml(source, "对比表现", "zh"));
    expect(Array.from(result.querySelectorAll(":scope > p")).map(node => node.textContent)).toEqual(["结论", "这是业务结论长句。", "共同完整期间：2026-06 至2026-09"]);
    expect(result.querySelector("details")?.textContent).toContain("额外分析");
    result.querySelector("summary")?.remove();
    expect(result.textContent).toBe(parse(source).textContent);
  });

  it.each(["用一张表对比这三家的共同完整月份，只列收入、订单、CVR、EPC。", "不要详细分析，只要一张表", "not detailed, table only"])("%s 按纯表优先且保留共同月份说明", (prompt) => {
    const source = '<p>共同完整月份对比（2026-06 至2026-09）</p><div class="table-wrap"><table><tbody><tr><td>原比较表</td></tr></tbody></table></div><p>额外分析</p><ul><li>发现</li></ul>';
    const result = parse(presentAgentAnswerHtml(source, prompt, "zh"));
    expect(result.querySelector(":scope > p")?.textContent).toContain("共同完整月份");
    expect(result.querySelectorAll(":scope > .table-wrap table")).toHaveLength(1);
    expect(result.querySelectorAll(":scope > ul")).toHaveLength(0);
    expect(result.querySelector("details")?.textContent).toContain("额外分析");
  });

  it.each(["不要详细分析，比较表现", "not detailed; compare performance"])("%s 不触发完整展开", (prompt) => {
    expect(parse(presentAgentAnswerHtml(html, prompt, "zh")).querySelector("details")).not.toBeNull();
  });
  it("默认显示结论、期间、第一表与三条发现，其余完整收起且不损坏块", () => {
    const result = parse(presentAgentAnswerHtml(html, "比较三家表现", "zh"));
    const details = result.querySelector("details")!;
    expect(details).not.toBeNull();
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("查看完整分析");
    expect(result.querySelectorAll(":scope > .table-wrap table")).toHaveLength(1);
    expect(result.querySelectorAll(":scope > ul > li")).toHaveLength(3);
    expect(details.querySelector("table")?.textContent).toBe("第二趋势表");
    expect(details.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(details.querySelector("pre > code")?.textContent).toBe("代码证据");
    const original = parse(html);
    details.querySelector("summary")?.remove();
    expect(result.textContent).toBe(original.textContent);
    expect(result.querySelectorAll("table")).toHaveLength(2);
  });

  it("超过三条发现移入详情，保留每条一次以及有序列表编号", () => {
    const source = '<p>结论</p><ol start="2"><li>A</li><li>B</li><li>C</li><li>D<a href="/source">证据</a></li><li>E</li></ol>';
    const result = parse(presentAgentAnswerHtml(source, "分析", "en"));
    expect(result.querySelectorAll(":scope > ol > li")).toHaveLength(3);
    expect(result.querySelector("details ol")?.getAttribute("start")).toBe("5");
    expect(result.querySelectorAll("li")).toHaveLength(5);
    expect(result.querySelectorAll('a[href="/source"]')).toHaveLength(1);
  });

  it("纯表格追问只直接显示原比较表和期间，额外解释仍可查看", () => {
    const result = parse(presentAgentAnswerHtml(html, "同范围只整理为一张对比表", "zh"));
    expect(result.querySelectorAll(":scope > ul")).toHaveLength(0);
    expect(result.querySelectorAll(":scope > p")).toHaveLength(1);
    expect(result.querySelector(":scope > p")?.textContent).toContain("2026-06");
    expect(result.querySelector("details")?.textContent).toContain("结论");
    expect(result.querySelectorAll("table")).toHaveLength(2);
  });

  it("当前详细请求完整展示，不能因为旧问句曾详细就让普通问句展开", () => {
    expect(presentAgentAnswerHtml(html, "详细分析三家", "zh")).toBe(html);
    expect(parse(presentAgentAnswerHtml(html, "比较三家", "zh")).querySelector("details")).not.toBeNull();
    expect(presentAgentAnswerHtml("<p>简短结论</p>", "分析", "zh")).toBe("<p>简短结论</p>");
  });
});
