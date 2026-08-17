import fs from "node:fs";

const styles = fs.readFileSync("public/styles.css", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(/\.sidebar\s*\{[\s\S]*?scrollbar-width:\s*none/.test(styles), "Sidebar scrollbar should be visually hidden");
assert(/\.sidebar::\-webkit-scrollbar\s*\{[\s\S]*?display:\s*none/.test(styles), "Sidebar WebKit scrollbar should be visually hidden");
assert(/body\.dashboard-mode \.sidebar\s*\{[\s\S]*?overflow:\s*auto/.test(styles), "Sidebar scrolling must remain enabled");

console.log("PASS: Sidebar scrollbar is hidden without disabling scroll");
