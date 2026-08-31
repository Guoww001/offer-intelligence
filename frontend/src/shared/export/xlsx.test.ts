import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildWorkbook,
  stylesXml,
  tierSheetExportColumns,
  worksheetXml
} from "./xlsx";

interface LegacyHooks {
  readonly tierSheetExportColumns: (rows: unknown[], headers: string[]) => readonly (readonly unknown[])[];
  readonly worksheetXml: (rows: unknown[], context: { readonly columns: readonly unknown[] }) => string;
  readonly stylesXml: () => string;
  readonly createWorkbookSheets: (sheets: unknown[]) => Uint8Array;
}

interface TestElement {
  readonly addEventListener: () => void;
  readonly classList: {
    readonly add: () => void;
    readonly remove: () => void;
    readonly toggle: () => void;
    readonly contains: () => boolean;
  };
  readonly dataset: Record<string, string>;
  readonly appendChild: () => void;
  readonly querySelectorAll: () => unknown[];
  readonly querySelector: () => null;
  readonly setAttribute: () => void;
  readonly removeAttribute: () => void;
  readonly style: Record<string, unknown>;
}

function elementStub(): TestElement {
  return {
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    appendChild() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    setAttribute() {},
    removeAttribute() {},
    style: {}
  };
}

function loadLegacyHooks(): LegacyHooks {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const documentStub = {
    body: elementStub(),
    head: elementStub(),
    getElementById() { return elementStub(); },
    querySelectorAll() { return []; },
    querySelector() { return elementStub(); },
    createElement() { return elementStub(); },
    addEventListener() {}
  };
  const sandbox: Record<string, unknown> = {
    console,
    Date,
    Math,
    Number,
    String,
    RegExp,
    Array,
    Object,
    Set,
    Map,
    JSON,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    window: {
      __OFFER_INTELLIGENCE_TEST__: true,
      location: { href: "http://localhost/" },
      matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
      requestAnimationFrame(callback: () => void) { callback(); return 0; },
      addEventListener() {},
      removeEventListener() {}
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    },
    document: documentStub
  };
  const windowObject = sandbox.window as Record<string, unknown>;
  windowObject.document = documentStub;
  windowObject.CHATBOT_DATA = { summary: {}, offers: [], paymentRecords: [] };
  windowObject.SHEET_REPORT_DATA = { sheets: [], tierSheets: [] };
  windowObject.PRODUCT_KEYWORDS = { merchants: [] };
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/chatbot_i18n.js"), "utf8"), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/tier2_recommendation_rules.js"), "utf8"), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/app.js"), "utf8"), sandbox);
  const hooks = (windowObject.OFFER_INTELLIGENCE_TEST_HOOKS || {}) as LegacyHooks;
  if (!hooks.tierSheetExportColumns || !hooks.createWorkbookSheets) {
    throw new Error("legacy workbook export hooks are unavailable");
  }
  return hooks;
}

function zipEntries(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const result = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    result.set(name, decoder.decode(bytes.slice(dataStart, dataStart + compressedSize)));
    offset = dataStart + compressedSize;
  }
  return result;
}

const rows = [
  {
    "ALL Commission": "27.0",
    "AFF Commission": "20.25",
    "Conversion Rate": "0.125",
    Clicks: "18.0",
    ATC: "0.0",
    DPV: "14.0",
    Revenue: "154.489751"
  },
  {
    "ALL Commission": "0.125",
    "AFF Commission": "12%",
    "Conversion Rate": "25%",
    Clicks: "7.9",
    ATC: "2.4",
    DPV: "3.6",
    Revenue: 99.5
  }
];

const headers = ["ALL Commission", "AFF Commission", "Conversion Rate", "Clicks", "ATC", "DPV", "Revenue"];

describe("shared XLSX export contract", () => {
  it("keeps Tier column formats and worksheet XML equivalent to legacy", () => {
    const legacy = loadLegacyHooks();
    const legacyColumns = legacy.tierSheetExportColumns(rows, headers);
    const modernColumns = tierSheetExportColumns(rows, headers);
    const metadata = (columns: readonly (readonly unknown[])[]) => columns.map(([header, , width, format]) => [header, width ?? null, format ?? ""]);

    expect(metadata(modernColumns)).toEqual(metadata(legacyColumns));
    expect(worksheetXml(rows, { columns: modernColumns })).toBe(
      legacy.worksheetXml(rows, { columns: legacyColumns })
    );
    expect(stylesXml()).toBe(legacy.stylesXml());
  });

  it("preserves numeric cell types and workbook package parts", () => {
    const legacy = loadLegacyHooks();
    const legacyColumns = legacy.tierSheetExportColumns(rows, headers);
    const modernColumns = tierSheetExportColumns(rows, headers);
    const modernZip = buildWorkbook([{
      sheetName: "Tier 1",
      rows,
      columns: modernColumns
    }]);
    const legacyZip = legacy.createWorkbookSheets([{
      sheetName: "Tier 1",
      rows,
      columns: legacyColumns
    }]);
    const modernEntries = zipEntries(modernZip);
    const legacyEntries = zipEntries(legacyZip);

    expect(modernZip[0]).toBe(0x50);
    expect(modernZip[1]).toBe(0x4b);
    expect(Array.from(modernEntries.keys())).toEqual(Array.from(legacyEntries.keys()));
    expect(modernEntries).toEqual(legacyEntries);
    const worksheet = modernEntries.get("xl/worksheets/sheet1.xml") || "";
    expect(worksheet).toContain("<v>0.27</v>");
    expect(worksheet).toContain("<v>0.2025</v>");
    expect(worksheet).toContain("<v>0.125</v>");
    expect(worksheet).toContain("<v>18</v>");
    expect(worksheet).toContain("<v>0</v>");
    expect(worksheet).toContain("<v>14</v>");
  });
});
