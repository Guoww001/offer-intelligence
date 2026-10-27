import { describe, expect, it } from "vitest";

import { agentCategoryMatches, resolveAgentCategories, resolveAgentCategorySelection } from "./agentCategoryModel";

const offers = [
  { sheetCategory: "Home & Kitchen", mainCategoryCn: "家居、厨具、家装" },
  { sheetCategory: "Furniture & Home", mainCategoryCn: "家具与家居" },
  { sheetCategory: "Kitchen & Dining", mainCategoryCn: "厨房与餐饮" },
  { sheetCategory: "Tools & Home Improvement", mainCategoryCn: "家居装修" },
  { sheetCategory: "Furniture & Home, Electronics", mainCategoryCn: "家具与家居、电子" },
  { sheetCategory: "Electronics", mainCategory: "Home & Kitchen", mainCategoryCn: "电子" }
];

describe("Agent 中文品类解析", () => {
  it.each([
    ["家居", ["Home & Kitchen"]],
    ["家具", ["Furniture & Home"]],
    ["厨具", ["Kitchen & Dining"]],
    ["家装", ["Tools & Home Improvement"]],
    ["HOME &amp; Kitchen", ["Home & Kitchen"]],
    ["家具与家居", ["Furniture & Home"]]
  ])("将%s映射到真实主分类", (input, expected) => {
    expect(resolveAgentCategories(input as string, offers)).toEqual(expected);
  });

  it("多个品类按真实分类并集去重", () => {
    expect(resolveAgentCategories("分析家居、厨具、家装，家居", offers)).toEqual([
      "Home & Kitchen", "Kitchen & Dining", "Tools & Home Improvement"
    ]);
    expect(resolveAgentCategories("家居与厨具", offers)).toEqual(["Home & Kitchen", "Kitchen & Dining"]);
    expect(resolveAgentCategories("家居和家装", offers)).toEqual(["Home & Kitchen", "Tools & Home Improvement"]);
  });

  it("英文完整分类不会扩大到组合分类", () => {
    expect(resolveAgentCategories("分析 Furniture & Home 的收入", offers)).toEqual(["Furniture & Home"]);
    expect(resolveAgentCategories("Furniture & Home, Electronics", offers)).toEqual(["Furniture & Home, Electronics"]);
    expect(agentCategoryMatches(offers[4]!, ["Furniture & Home"])).toBe(false);
    expect(agentCategoryMatches(offers[5]!, ["Home & Kitchen"])).toBe(false);
  });

  it("优先使用真实主分类并读取自定义中文名", () => {
    const rows = [{ sheetCategory: "Custom Living", mainCategory: "Custom Living", mainCategoryCn: "合成居室" }];
    expect(resolveAgentCategories("查看合成居室", rows)).toEqual(["Custom Living"]);
    expect(resolveAgentCategories("Furniture & Home", rows)).toEqual([]);
    expect(agentCategoryMatches(rows[0]!, ["Custom Living"])).toBe(true);
  });

  it("不存在的分类和子串不创造分类", () => {
    expect(resolveAgentCategories("Home &", offers)).toEqual([]);
    expect(resolveAgentCategories("家具", [{ sheetCategory: "Electronics" }])).toEqual([]);
    expect(resolveAgentCategories("其他分类", [{ sheetCategory: "Uncategorized" }])).toEqual([]);
  });

  it("家具子类不能扩大成整个家居主类", () => {
    const rows = [{ sheetCategory: "Home & Kitchen", categoryPath: "Home & Kitchen > Furniture" }];
    expect(resolveAgentCategories("家具", rows)).toEqual([]);
    expect(resolveAgentCategories("家具", [...rows, { sheetCategory: "Furniture & Home" }])).toEqual(["Furniture & Home"]);
  });

  it("真实中文对照优先于内置歧义别名", () => {
    expect(resolveAgentCategories("家居", [{ sheetCategory: "Kitchen & Dining", mainCategoryCn: "家居" }, { sheetCategory: "Home & Kitchen" }])).toEqual(["Kitchen & Dining"]);
  });

  it("重复中文译名和不同主类的中文元数据不会扩大到服装家电", () => {
    const rows = [
      { sheetCategory: "Home & Kitchen", mainCategory: "Home & Kitchen", mainCategoryCn: "家居" },
      { sheetCategory: "Kitchen & Dining", mainCategory: "Kitchen & Dining", mainCategoryCn: "家居" },
      { sheetCategory: "Appliances", mainCategory: "Appliances", mainCategoryCn: "家居" },
      { sheetCategory: "Clothing, Shoes & Jewelry", mainCategory: "Home & Kitchen", mainCategoryCn: "家居" }
    ];
    expect(resolveAgentCategories("家居", rows)).toEqual(["Home & Kitchen"]);
  });

  it("组合含未知分类时拒绝部分成功并返回未识别项", () => {
    expect(resolveAgentCategorySelection("家居、合成未知类", offers)).toEqual({ categories: ["Home & Kitchen"], unresolved: ["合成未知类"] });
    expect(resolveAgentCategories("家居、合成未知类", offers)).toEqual([]);
  });

  it("常见英文别名只映射对应真实分类", () => {
    expect(resolveAgentCategories("Home", offers)).toEqual(["Home & Kitchen"]);
    expect(resolveAgentCategories("Kitchen", offers)).toEqual(["Kitchen & Dining"]);
    expect(resolveAgentCategories("Home", [{ sheetCategory: "Furniture & Home" }])).toEqual([]);
  });

  it("中文分类后缀不改变主分类解析", () => {
    expect(resolveAgentCategories("家具类目", offers)).toEqual(["Furniture & Home"]);
    expect(resolveAgentCategories("家居品类", offers)).toEqual(["Home & Kitchen"]);
  });

  it("未分类占位值继续回退主分类优先链", () => {
    const row = { sheetCategory: "Uncategorized", mainCategory: "Home & Kitchen", category: "Electronics" };
    expect(resolveAgentCategories("家居", [row])).toEqual(["Home & Kitchen"]);
    expect(agentCategoryMatches(row, ["Home & Kitchen"])).toBe(true);
    expect(agentCategoryMatches(row, ["Electronics"])).toBe(false);
  });
});
