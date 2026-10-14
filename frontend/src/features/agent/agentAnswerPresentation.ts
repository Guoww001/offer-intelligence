import type { UiLanguage } from "../../shared/i18n";

export function agentAnswerDisplayMode(prompt: string): "compact" | "table" | "detailed" {
  if (/(?:只|仅|一张|纯|不要分析|不用分析).{0,20}(?:表格|对比表|比较表|表)|(?:表格|对比表|表).{0,15}(?:即可|就好)|\b(?:only|just)\b.{0,25}\btable\b|\btable\b.{0,12}\bonly\b/i.test(prompt)) return "table";
  const positivePrompt = prompt.replace(/(?:不要|不用|无需|不必|不需要|别).{0,6}(?:详细(?:分析)?|完整分析|全部明细)|\b(?:not|no|without|do not|don't)\b.{0,16}\b(?:detailed|in.depth)\b/gi, "");
  return /详细|完整分析|全部明细|\bdetailed\b|\bin.depth\b/i.test(positivePrompt) ? "detailed" : "compact";
}

export function presentAgentAnswerHtml(safeHtml: string, prompt: string, language: UiLanguage): string {
  const mode = agentAnswerDisplayMode(prompt);
  if (mode === "detailed") return safeHtml;
  const original = document.createElement("div");
  original.innerHTML = safeHtml;
  const pureTable = mode === "table" && Boolean(original.querySelector("table"));
  const output = document.createElement("div");
  const details = document.createElement("details");
  details.className = "agent-answer-details";
  const summary = document.createElement("summary");
  summary.textContent = language === "zh" ? "查看完整分析" : "View full analysis";
  details.append(summary);
  let conclusionShown = false;
  let conclusionHeadingShown = false;
  let periodShown = false;
  let tableShown = false;
  let findingsShown = false;
  for (const node of Array.from(original.childNodes)) {
    if (!(node instanceof HTMLElement)) { output.append(node); continue; }
    const isTable = node.matches("table") || Boolean(node.querySelector("table"));
    const text = node.textContent?.trim() || "";
    const isPeriod = node.tagName === "P" && /^(?:共同(?:完整)?(?:期间|月份)|比较期间|分析期间|数据期间|完整期间|期间|范围|(?:comparison |common complete |data )?period|range)\s*[:：]?/i.test(text);
    const headingLike = /^H[1-6]$/.test(node.tagName) || (node.tagName === "P" && node.children.length === 1 && node.firstElementChild?.matches("strong, b") && /^(?:结论|核心结论|主要结论|关键发现|主要发现|趋势比较|详细分析|额外分析|说明|conclusion|summary|findings|analysis)\s*[:：]?$/i.test(text));
    const substantiveConclusion = /^(?:结论|核心结论|主要结论|conclusion|summary)\s*[:：]\s*\S/i.test(text);
    const conclusionHeading = (node.tagName === "P" || headingLike) && /^(?:结论|核心结论|主要结论|conclusion|summary)\s*[:：]?$/i.test(text);
    if (isTable && !tableShown) { output.append(node); tableShown = true; continue; }
    if (isPeriod && !periodShown) { output.append(node); periodShown = true; continue; }
    if (!pureTable && conclusionHeading && !conclusionHeadingShown && !conclusionShown && !tableShown) {
      output.append(node); conclusionHeadingShown = true; continue;
    }
    if (!pureTable && substantiveConclusion && !conclusionShown && !tableShown && !findingsShown) {
      output.append(node); conclusionShown = true; continue;
    }
    if (headingLike) { details.append(node); continue; }
    if (!pureTable && node.tagName === "P" && !conclusionShown && !tableShown && !findingsShown) {
      output.append(node); conclusionShown = true; continue;
    }
    if (!pureTable && node.matches("ul, ol") && !findingsShown) {
      findingsShown = true;
      const items = Array.from(node.children).filter(item => item.tagName === "LI");
      if (items.length > 3) {
        const overflow = node.cloneNode(false) as HTMLElement;
        if (node.tagName === "OL") overflow.setAttribute("start", String((Number(node.getAttribute("start")) || 1) + 3));
        for (const item of items.slice(3)) overflow.append(item);
        details.append(overflow);
      }
      output.append(node); continue;
    }
    details.append(node);
  }
  if (details.children.length === 1) return safeHtml;
  output.append(details);
  return output.innerHTML;
}
