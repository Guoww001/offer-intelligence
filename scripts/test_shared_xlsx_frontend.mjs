import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

const source = read("frontend/src/shared/export/xlsx.ts");
for (const contract of [
  "export function objectExportColumns",
  "export function tierSheetExportColumns",
  "export function worksheetXml",
  "export function stylesXml",
  "export function createZip",
  "export function buildWorkbookFiles",
  "export function buildWorkbook",
  "export function downloadWorkbook",
  "numFmtId=\"10\"",
  "numFmtId=\"1\"",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]) {
  assert(source.includes(contract), `共享 XLSX 模块缺少契约: ${contract}`);
}

const entry = read("frontend/src/entry.ts");
for (const contract of [
  'import {\n  downloadWorkbook,',
  "function downloadTargets",
  "function downloadTier",
  "category_focus_",
  "monthly_targets_",
  "tier_records_"
]) {
  assert(entry.includes(contract), `页面导出未接入共享 XLSX 模块: ${contract}`);
}

const test = read("frontend/src/shared/export/xlsx.test.ts");
for (const contract of [
  "legacy.worksheetXml",
  "legacy.createWorkbookSheets",
  "toContain(\"<v>0.27</v>\")",
  "toContain(\"<v>0.2025</v>\")"
]) {
  assert(test.includes(contract), `共享 XLSX 等价测试缺少断言: ${contract}`);
}

const ci = read(".github/workflows/ci.yml");
assert(ci.includes("node scripts/test_shared_xlsx_frontend.mjs"), "CI 未运行共享 XLSX 契约测试");

console.log("PASS: shared XLSX frontend contract");
