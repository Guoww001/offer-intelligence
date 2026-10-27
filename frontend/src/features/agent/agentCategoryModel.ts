type OfferRow = Readonly<Record<string, unknown>>;

export interface AgentCategorySelection {
  categories: string[];
  unresolved: string[];
}

function values(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim()).filter(Boolean);
}

function normalized(value: string): string {
  return value.trim().replace(/&amp;/gi, "&").replace(/\s+/g, " ").toLowerCase();
}

function primaryCategories(row: OfferRow): string[] {
  for (const key of ["sheetCategory", "Sheet Category", "mainCategory", "Main Category", "category", "Category", "levantaCategory"]) {
    const categories = values(row[key]).filter(category => !["uncategorized", "未分类"].includes(normalized(category)));
    if (categories.length) return categories;
  }
  return [];
}

const aliases: Readonly<Record<string, readonly string[]>> = {
  "home & kitchen": ["家居", "Home"],
  "furniture": ["家具"],
  "furniture & home": ["家具", "Furniture"],
  "kitchen & dining": ["厨具", "厨房", "厨房与餐饮", "Kitchen"],
  "tools & home improvement": ["家装", "家居装修"],
  "electronics": ["电子", "电子产品"]
};

function cleanPart(value: string): string {
  return value.trim()
    .replace(/^(?:(?:请|帮我|分析|查看|查询|比较|对比|统计|看看)\s*)+/, "")
    .replace(/\s*的(?:收入|GMV|点击|订单|表现|趋势|数据).*$/i, "")
    .replace(/(?:类目|品类|分类)\s*$/, "")
    .trim();
}

export function resolveAgentCategorySelection(input: string, offers: readonly OfferRow[]): AgentCategorySelection {
  const canonical = new Map<string, string>();
  const chinese = new Map<string, Set<string>>();
  for (const row of offers) {
    const categories = primaryCategories(row);
    categories.forEach(category => { if (!canonical.has(normalized(category))) canonical.set(normalized(category), category); });
    const mainCategories = values(row.mainCategory);
    const chineseNames = mainCategories.length && !categories.some(category => mainCategories.some(main => normalized(main) === normalized(category))) ? [] : values(row.mainCategoryCn);
    for (const name of chineseNames) {
      const matched = chinese.get(normalized(name)) || new Set<string>();
      categories.forEach(category => matched.add(category));
      chinese.set(normalized(name), matched);
    }
  }

  const cleaned = cleanPart(input);
  const exact = canonical.get(normalized(cleaned));
  if (exact) return { categories: [exact], unresolved: [] };

  // 先保护完整英文主分类，避免真实分类自身的逗号被当作组合分隔符。
  const protectedCategories = new Map<string, string>();
  let protectedInput = cleaned;
  [...canonical.entries()].sort(([left], [right]) => right.length - left.length).forEach(([key, category], index) => {
    const pattern = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/&/g, "(?:&|&amp;)");
    const token = `\u0001${index}\u0001`;
    protectedInput = protectedInput.replace(new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, "gi"), () => {
      protectedCategories.set(token, category);
      return token;
    });
  });

  const categories: string[] = [];
  const unresolved: string[] = [];
  const add = (category: string) => { if (!categories.includes(category)) categories.push(category); };
  const parts = protectedInput.split(/[、，,;；\n]+|\s+and\s+/i).flatMap(part =>
    chinese.has(normalized(cleanPart(part))) ? [part] : part.split(/与|和/));
  for (const raw of parts) {
    const part = cleanPart(raw);
    if (!part) continue;
    const protectedCategory = protectedCategories.get(part);
    if (protectedCategory) { add(protectedCategory); continue; }
    const key = normalized(part);
    const translated = chinese.get(key);
    if (translated?.size === 1) { translated.forEach(add); continue; }
    let found = false;
    for (const [name, category] of canonical) {
      if (aliases[name]?.some(alias => normalized(alias) === key)) { add(category); found = true; }
    }
    if (!found && !unresolved.includes(part)) unresolved.push(part);
  }
  return { categories, unresolved };
}

export function resolveAgentCategories(input: string, offers: readonly OfferRow[]): string[] {
  const selection = resolveAgentCategorySelection(input, offers);
  return selection.unresolved.length ? [] : selection.categories;
}

export function agentCategoryMatches(row: OfferRow, categories: readonly string[]): boolean {
  const selected = new Set(categories.map(normalized));
  return primaryCategories(row).some(category => selected.has(normalized(category)));
}
