import fs from "node:fs";

function assertIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");
const auth = fs.readFileSync("public/auth.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

assertIncludes(html, 'role="progressbar"', "loading UI should expose a progressbar role");
assertIncludes(html, 'aria-valuenow="8"', "loading UI should expose its initial progress");
assertIncludes(html, 'id="skeletonLoadingStatus"', "loading UI should expose a live stage label");
assertIncludes(css, ".skeleton-progress-value", "loading UI should style the progress value");
assertIncludes(css, "prefers-reduced-motion: reduce", "loading UI should honor reduced motion");
assertIncludes(auth, "function createLoadingProgress()", "auth bootstrap should own progress state");
assertIncludes(auth, "driftTo(68", "offer loading should use a capped intermediate stage");
assertIncludes(auth, "driftTo(94", "dashboard setup should use a capped rendering stage");
assertIncludes(app, "__OI_LOADING_PROGRESS__.finish", "dashboard render should complete the progress state");

console.log("Loading progress UI checks passed.");
