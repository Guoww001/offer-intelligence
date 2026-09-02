import fs from "node:fs";
import assert from "node:assert/strict";

function assertIncludes(haystack, needle, label) {
  if (String(haystack).indexOf(needle) === -1) {
    throw new Error(`${label}: expected to include ${JSON.stringify(needle)}`);
  }
}

const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8").replace(/\r\n?/g, "\n");

assertIncludes(app, "function createAgentExecutionTimeline", "execution timeline factory");
assertIncludes(app, "executionTimeline: true", "Agent page timeline opt-in");
assert.match(
  app,
  /execution\.updateStep\(timelineStep,\s*\{\s*status:\s*result\.ok[\s\S]*?elapsedMs:\s*Date\.now\(\)\s*-\s*toolStartedAt\s*,\s*dataSource:\s*toolMeta\.dataSource\s*,\s*dataAsOf:\s*toolMeta\.dataAsOf\s*,\s*estimated:\s*toolMeta\.estimated/,
  "completed tool timeline step should expose controlled data metadata"
);
assertIncludes(app, "function stopAgentPageConversation", "Agent stop handler");
assertIncludes(app, "agentPage.abortController", "Agent abort controller state");
assertIncludes(html, "id=\"agentStopConversation\"", "Agent stop button");
assertIncludes(styles, ".agent-run-timeline", "timeline styles");
assertIncludes(app, "agent-run-activity-track", "timeline should render a persistent activity track");
assertIncludes(styles, ".agent-run-step-running::before", "active step should have an indeterminate sweep");
assertIncludes(styles, "@keyframes agentRunTrack", "activity track motion should be defined");
assertIncludes(styles, "prefers-reduced-motion: reduce", "timeline motion should respect reduced-motion preferences");
assertIncludes(styles, ".agent-run-timeline::before", "timeline should have a restrained top highlight");
const timelineStyleMatch = styles.match(
  /body\.dashboard-mode \.dashboard-agent-page \.agent-run-timeline \{\n  position: relative;([\s\S]*?)\n\}/
);
assert.ok(timelineStyleMatch, "dashboard timeline style should be declared");
assert.match(
  timelineStyleMatch[1],
  /flex-shrink:\s*0/,
  "timeline should not collapse inside the scrolling flex log"
);
assertIncludes(styles, ".agent-run-timeline-error .agent-run-status", "failed status should have a quiet semantic treatment");
assertIncludes(styles, ".agent-run-timeline-error .agent-run-step-error .agent-run-step-detail", "failed detail should be visually compact");

console.log("PASS: Agent execution timeline contract");
