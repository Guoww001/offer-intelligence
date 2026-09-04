import { describe, expect, it } from "vitest";

import {
  buildWorkbook,
  stylesXml,
  tierSheetExportColumns,
  worksheetXml
} from "./xlsx";

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
  it("assigns stable Tier formats and serializes typed numeric cells", () => {
    const columns = tierSheetExportColumns(rows, headers);
    expect(columns.map(([header, , width, format]) => [header, width ?? null, format ?? ""])).toEqual([
      ["ALL Commission", null, "percentage"],
      ["AFF Commission", null, "percentage"],
      ["Conversion Rate", null, "percentage"],
      ["Clicks", null, "integer"],
      ["ATC", null, "integer"],
      ["DPV", null, "integer"],
      ["Revenue", null, ""]
    ]);

    const worksheet = worksheetXml(rows, { columns });
    expect(worksheet).toContain("<v>0.27</v>");
    expect(worksheet).toContain("<v>0.2025</v>");
    expect(worksheet).toContain("<v>0.125</v>");
    expect(worksheet).toContain("<v>18</v>");
    expect(worksheet).toContain("<v>0</v>");
    expect(worksheet).toContain("<v>14</v>");
    expect(stylesXml()).toContain('<xf numFmtId="10" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>');
  });

  it("preserves the required XLSX package parts", () => {
    const workbook = buildWorkbook([{
      sheetName: "Tier 1",
      rows,
      columns: tierSheetExportColumns(rows, headers)
    }]);
    const entries = zipEntries(workbook);

    expect(workbook[0]).toBe(0x50);
    expect(workbook[1]).toBe(0x4b);
    expect(Array.from(entries.keys())).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml"
    ]);
    expect(entries.get("xl/worksheets/sheet1.xml")).toContain("<t>154.489751</t>");
  });
});
