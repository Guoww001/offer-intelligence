export const MAX_REVENUE_FLOW_BRANDS = 12;

export type RevenueFlowNodeType = "brand" | "product" | "media";

export interface RevenueFlowDateRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly dayCount?: number;
}

export interface RevenueFlowMerchant {
  readonly merchantId: string;
  readonly merchantName: string;
}

export interface RevenueFlowNode {
  readonly id: string;
  readonly type: RevenueFlowNodeType;
  readonly label: string;
  readonly value: number;
  readonly merchantId?: string;
  readonly productKey?: string;
  readonly userId?: string;
  readonly manager?: string;
}

export interface RevenueFlowLink {
  readonly source: string;
  readonly target: string;
  readonly value: number;
}

export interface RevenueFlowSummary {
  readonly totalRevenue: number;
  readonly brandCount: number;
  readonly productCount: number;
  readonly mediaCount: number;
  readonly linkCount: number;
}

export interface RevenueFlowSankeyPayload {
  readonly available: boolean;
  readonly reason?: string;
  readonly nodes: readonly RevenueFlowNode[];
  readonly links: readonly RevenueFlowLink[];
  readonly summary: RevenueFlowSummary;
}

export interface RevenueFlowPayload {
  readonly ok?: boolean;
  readonly merchants: readonly RevenueFlowMerchant[];
  readonly dateRange: RevenueFlowDateRange;
  readonly sankey: RevenueFlowSankeyPayload;
}

export interface RevenueFlowCatalogOption {
  readonly merchantId: string;
  readonly name: string;
  readonly count: number;
}

export interface RevenueFlowHoverState {
  readonly nodeId: string;
  readonly relatedNodeIds: readonly string[];
  readonly relatedLinkIndexes: readonly number[];
}

export interface RevenueFlowModel {
  readonly payload: RevenueFlowPayload;
  readonly brand: RevenueFlowNode | null;
  readonly brands: readonly RevenueFlowNode[];
  readonly products: readonly RevenueFlowNode[];
  readonly media: readonly RevenueFlowNode[];
  readonly links: readonly RevenueFlowLink[];
  readonly nodeById: Readonly<Record<string, RevenueFlowNode>>;
  readonly hoverIndex: Readonly<Record<string, RevenueFlowHoverState>>;
  readonly brandIdByProductId: Readonly<Record<string, string>>;
  readonly totalRevenue: number;
  readonly brandCount: number;
  readonly productCount: number;
  readonly mediaCount: number;
  readonly linkCount: number;
}

export interface RevenueFlowLayoutNode extends RevenueFlowNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly column: RevenueFlowNodeType;
  readonly color: string;
}

export interface RevenueFlowLayoutLink {
  readonly index: number;
  readonly source: RevenueFlowLayoutNode;
  readonly target: RevenueFlowLayoutNode;
  readonly sourceId: string;
  readonly targetId: string;
  readonly value: number;
  readonly sourceTop: number;
  readonly sourceBottom: number;
  readonly targetTop: number;
  readonly targetBottom: number;
  readonly curve: number;
  readonly color: string;
}

export interface RevenueFlowLayout {
  readonly width: number;
  readonly surfaceWidth: number;
  readonly height: number;
  readonly graphTop: number;
  readonly graphHeight: number;
  readonly top: number;
  readonly bottom: number;
  readonly headerY: number;
  readonly panPaddingX: number;
  readonly panPaddingY: number;
  readonly initialScrollLeft: number;
  readonly initialScrollTop: number;
  readonly nodeWidth: number;
  readonly nodeGap: number;
  readonly columnX: Readonly<Record<RevenueFlowNodeType, number>>;
  readonly nodes: readonly RevenueFlowLayoutNode[];
  readonly links: readonly RevenueFlowLayoutLink[];
  readonly layoutById: Readonly<Record<string, RevenueFlowLayoutNode>>;
  readonly linkByIndex: Readonly<Record<number, RevenueFlowLayoutLink>>;
}

export interface RevenueFlowFlowDetail {
  readonly index: number;
  readonly sourceId: string;
  readonly sourceType: RevenueFlowNodeType;
  readonly sourceLabel: string;
  readonly targetId: string;
  readonly targetType: RevenueFlowNodeType;
  readonly targetLabel: string;
  readonly brandLabel: string;
  readonly value: number;
  readonly sourceShare: number;
  readonly targetShare: number;
  readonly sourceTotal: number;
  readonly targetTotal: number;
}

type RawRecord = Readonly<Record<string, unknown>>;

const REVENUE_FLOW_COLOR_GOLDEN_ANGLE = 137.508;
const REVENUE_FLOW_NODE_TYPES: readonly RevenueFlowNodeType[] = ["brand", "product", "media"];

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function rawArray(value: unknown): readonly RawRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is RawRecord => isRecord(item))
    : [];
}

function validDateKey(value: unknown): string {
  const key = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return "";
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return "";
  return key;
}

function dayOrdinal(value: string): number {
  const key = validDateKey(value);
  if (!key) return Number.NaN;
  return Date.UTC(
    Number(key.slice(0, 4)),
    Number(key.slice(5, 7)) - 1,
    Number(key.slice(8, 10))
  ) / 86_400_000;
}

function nodeType(value: unknown): RevenueFlowNodeType | null {
  const candidate = text(value).toLowerCase();
  return REVENUE_FLOW_NODE_TYPES.includes(candidate as RevenueFlowNodeType)
    ? candidate as RevenueFlowNodeType
    : null;
}

function normalizeNode(value: unknown): RevenueFlowNode | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, text(value.nodeId));
  const type = nodeType(value.type);
  const valueAmount = Math.max(0, numberValue(value.value, numberValue(value.revenue)));
  if (!id || !type || valueAmount <= 0) return null;
  const productKey = text(value.productKey, text(value.asin, text(value.productId)));
  const merchantId = text(value.merchantId, text(value.merchant_id));
  const userId = text(value.userId, text(value.publisherId, text(value.user_id)));
  return {
    id,
    type,
    label: text(value.label, text(value.name, productKey || id)),
    value: valueAmount,
    ...(merchantId ? { merchantId } : {}),
    ...(productKey ? { productKey } : {}),
    ...(userId ? { userId } : {}),
    ...(text(value.manager) ? { manager: text(value.manager) } : {})
  };
}

function linkEndpoint(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return text(value);
  if (isRecord(value)) return text(value.id, text(value.nodeId));
  return "";
}

function normalizeLink(value: unknown): RevenueFlowLink | null {
  if (!isRecord(value)) return null;
  const source = linkEndpoint(value.source ?? value.sourceId);
  const target = linkEndpoint(value.target ?? value.targetId);
  const valueAmount = Math.max(0, numberValue(value.value, numberValue(value.revenue)));
  if (!source || !target || valueAmount <= 0) return null;
  return { source, target, value: valueAmount };
}

function normalizeMerchant(value: unknown): RevenueFlowMerchant | null {
  if (!isRecord(value)) return null;
  const merchantId = text(value.merchantId, text(value.id));
  if (!merchantId) return null;
  return {
    merchantId,
    merchantName: text(value.merchantName, text(value.name, merchantId))
  };
}

function normalizedSummary(
  source: unknown,
  nodes: readonly RevenueFlowNode[],
  links: readonly RevenueFlowLink[]
): RevenueFlowSummary {
  const raw = isRecord(source) ? source : {};
  const brands = nodes.filter((node) => node.type === "brand");
  const products = nodes.filter((node) => node.type === "product");
  const media = nodes.filter((node) => node.type === "media");
  const brandRevenue = brands.reduce((total, node) => total + node.value, 0);
  return {
    totalRevenue: Math.max(0, numberValue(raw.totalRevenue, brandRevenue)),
    brandCount: brands.length,
    productCount: products.length,
    mediaCount: media.length,
    linkCount: links.length
  };
}

export function normalizeRevenueFlowPayload(
  value: unknown,
  fallbackRange?: RevenueFlowDateRange
): RevenueFlowPayload | null {
  if (!isRecord(value)) return null;
  if (typeof value.ok === "boolean" && !value.ok) return null;
  const rawSankey = isRecord(value.sankey) ? value.sankey : value;
  const unavailable = rawSankey.available === false;
  const nodes = rawArray(rawSankey.nodes)
    .map(normalizeNode)
    .filter((node): node is RevenueFlowNode => node !== null);
  const links = rawArray(rawSankey.links)
    .map(normalizeLink)
    .filter((link): link is RevenueFlowLink => link !== null);
  const dateSource = isRecord(value.dateRange)
    ? value.dateRange
    : isRecord(rawSankey.dateRange) ? rawSankey.dateRange : {};
  const startDate = validDateKey(dateSource.startDate) || validDateKey(fallbackRange?.startDate);
  const endDate = validDateKey(dateSource.endDate) || validDateKey(fallbackRange?.endDate);
  if (!startDate || !endDate || dayOrdinal(endDate) < dayOrdinal(startDate)) return null;

  const rawMerchants = rawArray(value.merchants)
    .map(normalizeMerchant)
    .filter((merchant): merchant is RevenueFlowMerchant => merchant !== null);
  const merchantById = new Map<string, RevenueFlowMerchant>();
  for (const merchant of rawMerchants) merchantById.set(merchant.merchantId, merchant);
  for (const node of nodes) {
    if (node.type !== "brand" || !node.merchantId || merchantById.has(node.merchantId)) continue;
    merchantById.set(node.merchantId, {
      merchantId: node.merchantId,
      merchantName: node.label
    });
  }
  const normalizedLinks = links.filter((link) => {
    const source = nodes.find((node) => node.id === link.source);
    const target = nodes.find((node) => node.id === link.target);
    return source !== undefined
      && target !== undefined
      && ((source.type === "brand" && target.type === "product")
        || (source.type === "product" && target.type === "media"));
  });
  return {
    ok: typeof value.ok === "boolean" ? value.ok : undefined,
    merchants: [...merchantById.values()],
    dateRange: {
      startDate,
      endDate,
      dayCount: Math.round(dayOrdinal(endDate) - dayOrdinal(startDate)) + 1
    },
    sankey: {
      available: !unavailable,
      ...(text(rawSankey.reason) ? { reason: text(rawSankey.reason) } : {}),
      nodes,
      links: normalizedLinks,
      summary: normalizedSummary(rawSankey.summary, nodes, normalizedLinks)
    }
  };
}

export function revenueFlowCatalogOptions(data: unknown): RevenueFlowCatalogOption[] {
  if (!isRecord(data)) return [];
  const nameMap = isRecord(data.merchantNameMap) ? data.merchantNameMap : {};
  const counts = new Map<string, number>();
  for (const publisher of rawArray(data.publishers)) {
    const seen = new Set<string>();
    const merchantIds = Array.isArray(publisher.merchantIds) ? publisher.merchantIds : [];
    for (const value of merchantIds) {
      const merchantId = text(value);
      if (!merchantId || seen.has(merchantId)) continue;
      seen.add(merchantId);
      counts.set(merchantId, (counts.get(merchantId) || 0) + 1);
    }
  }
  if (!counts.size) {
    for (const merchant of rawArray(data.merchants)) {
      const merchantId = text(merchant.merchantId, text(merchant.id));
      if (merchantId) counts.set(merchantId, Math.max(0, numberValue(merchant.count)));
    }
  }
  return [...counts.entries()]
    .map(([merchantId, count]) => ({
      merchantId,
      name: text(nameMap[merchantId], merchantId),
      count
    }))
    .sort((left, right) => right.count - left.count
      || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      || left.merchantId.localeCompare(right.merchantId, undefined, { numeric: true }));
}

function nodeSort(left: RevenueFlowNode, right: RevenueFlowNode): number {
  return right.value - left.value
    || left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
    || left.id.localeCompare(right.id, undefined, { numeric: true });
}

export function buildRevenueFlowModel(value: unknown): RevenueFlowModel | null {
  const payload = normalizeRevenueFlowPayload(value);
  if (!payload || !payload.sankey.available) return null;
  const nodes = payload.sankey.nodes;
  const nodeById: Record<string, RevenueFlowNode> = {};
  for (const node of nodes) nodeById[node.id] = node;
  const brands = nodes.filter((node) => node.type === "brand").sort(nodeSort);
  const products = nodes.filter((node) => node.type === "product").sort(nodeSort);
  const media = nodes.filter((node) => node.type === "media").sort(nodeSort);
  if (!brands.length || !products.length || !media.length) return null;

  const links = payload.sankey.links.filter((link) => {
    const source = nodeById[link.source];
    const target = nodeById[link.target];
    return source !== undefined
      && target !== undefined
      && ((source.type === "brand" && target.type === "product")
        || (source.type === "product" && target.type === "media"));
  });
  if (!links.length) return null;

  const relatedNodeIdsById = new Map<string, Set<string>>();
  const linkIndexes = new Map<string, Set<number>>();
  const brandIdByProductId: Record<string, string> = {};
  function addRelatedNode(key: string, value: string): void {
    const values = relatedNodeIdsById.get(key) || new Set<string>([key]);
    values.add(value);
    relatedNodeIdsById.set(key, values);
  }
  function addLinkIndex(key: string, index: number): void {
    const values = linkIndexes.get(key) || new Set<number>();
    values.add(index);
    linkIndexes.set(key, values);
  }
  links.forEach((link, index) => {
    const source = nodeById[link.source];
    const target = nodeById[link.target];
    if (!source || !target) return;
    addRelatedNode(source.id, target.id);
    addRelatedNode(target.id, source.id);
    addLinkIndex(source.id, index);
    addLinkIndex(target.id, index);
    if (source.type === "brand" && target.type === "product") {
      brandIdByProductId[target.id] = source.id;
    }
  });

  for (const mediaNode of media) {
    const relatedProducts = relatedNodeIdsById.get(mediaNode.id) || new Set<string>();
    for (const productId of relatedProducts) {
      const brandId = brandIdByProductId[productId];
      if (brandId) {
        addRelatedNode(mediaNode.id, brandId);
        const brandLinkIndex = links.findIndex((link) =>
          link.source === brandId && link.target === productId
        );
        if (brandLinkIndex >= 0) addLinkIndex(mediaNode.id, brandLinkIndex);
      }
    }
  }

  const hoverIndex: Record<string, RevenueFlowHoverState> = {};
  for (const node of nodes) {
    const relatedNodeIds = relatedNodeIdsById.get(node.id) || new Set<string>([node.id]);
    const relatedLinkIndexes = linkIndexes.get(node.id) || new Set<number>();
    hoverIndex[node.id] = {
      nodeId: node.id,
      relatedNodeIds: [...relatedNodeIds],
      relatedLinkIndexes: [...relatedLinkIndexes]
    };
  }

  const totalRevenue = Math.max(
    0,
    numberValue(payload.sankey.summary.totalRevenue, brands.reduce((total, node) => total + node.value, 0))
  );
  return {
    payload,
    brand: brands[0] || null,
    brands,
    products,
    media,
    links,
    nodeById,
    hoverIndex,
    brandIdByProductId,
    totalRevenue,
    brandCount: brands.length,
    productCount: products.length,
    mediaCount: media.length,
    linkCount: links.length
  };
}

export function revenueFlowColor(index: number): string {
  const hue = Math.round((Number(index || 0) * REVENUE_FLOW_COLOR_GOLDEN_ANGLE) % 360);
  return "hsl(" + hue + " 72% 48%)";
}

function brandIndex(model: RevenueFlowModel, brandId: string): number {
  const index = model.brands.findIndex((brand) => brand.id === brandId);
  return index >= 0 ? index : 0;
}

function linkBrandId(model: RevenueFlowModel, link: RevenueFlowLink): string {
  const source = model.nodeById[link.source];
  const target = model.nodeById[link.target];
  if (source?.type === "brand") return source.id;
  if (target?.type === "brand") return target.id;
  return model.brandIdByProductId[link.source]
    || model.brandIdByProductId[link.target]
    || "";
}

function totalForLinks(links: readonly RevenueFlowLink[], nodeId: string, side: "source" | "target"): number {
  return links.reduce((total, link) => total + (
    (side === "source" ? link.source : link.target) === nodeId ? link.value : 0
  ), 0);
}

function constrainedNodeHeights(
  columnNodes: readonly RevenueFlowNode[],
  available: number,
  minimumHeight: number
): number[] {
  const space = Math.max(0, Number(available || 0));
  const minimum = Math.max(0, Number(minimumHeight || 0));
  if (!columnNodes.length) return [];

  const heights = columnNodes.map(() => 0);
  const values = columnNodes.map((node) => Math.max(0, Number(node.value || 0)));
  let active = values
    .map((value, index) => value > 0 ? index : -1)
    .filter((index) => index >= 0);
  let remainingSpace = space;

  values.forEach((value, index) => {
    if (value <= 0) {
      heights[index] = minimum;
      remainingSpace -= minimum;
    }
  });
  remainingSpace = Math.max(0, remainingSpace);

  while (active.length) {
    const remainingValue = active.reduce((total, index) => total + values[index]!, 0);
    const scale = remainingValue > 0 ? remainingSpace / remainingValue : 0;
    const constrained = active.filter((index) => values[index]! * scale < minimum);
    if (!constrained.length) {
      let allocated = 0;
      active.forEach((index, activeIndex) => {
        const height = activeIndex === active.length - 1
          ? Math.max(0, remainingSpace - allocated)
          : values[index]! * scale;
        heights[index] = height;
        allocated += height;
      });
      remainingSpace = 0;
      break;
    }

    const constrainedIndexes = new Set(constrained);
    constrained.forEach((index) => {
      heights[index] = minimum;
      remainingSpace = Math.max(0, remainingSpace - minimum);
    });
    active = active.filter((index) => !constrainedIndexes.has(index));
  }

  return heights;
}

export function buildRevenueFlowLayout(model: RevenueFlowModel, width = 1160): RevenueFlowLayout {
  const graphWidth = Math.max(1160, Number.isFinite(width) ? width : 1160);
  const itemCount = Math.max(model.brands.length, model.products.length, model.media.length, 1);
  const nodeWidth = 12;
  const minimumNodeHeight = 14;
  const nodeGap = Math.min(14, Math.max(5, 10 - itemCount / 40));
  const graphTop = 70;
  const graphBottom = 26;
  const minimumGraphHeight = graphTop + graphBottom + minimumNodeHeight * itemCount
    + nodeGap * Math.max(0, itemCount - 1);
  const graphHeight = Math.max(390, 128 + itemCount * 31, Math.ceil(minimumGraphHeight));
  const panPaddingX = Math.max(220, Math.min(360, Math.round(graphWidth * 0.18)));
  const panPaddingY = 96;
  const height = graphHeight + panPaddingY * 2;
  const top = panPaddingY + graphTop;
  const bottom = panPaddingY + graphBottom;
  const innerHeight = graphHeight - graphTop - graphBottom;
  const responsiveExtra = Math.max(0, graphWidth - 1160);
  const graphColumnX: Record<RevenueFlowNodeType, number> = {
    brand: 36,
    product: Math.round(400 + responsiveExtra * 0.45),
    media: Math.round(820 + responsiveExtra * 0.65)
  };
  const columnX: Record<RevenueFlowNodeType, number> = {
    brand: graphColumnX.brand + panPaddingX,
    product: graphColumnX.product + panPaddingX,
    media: graphColumnX.media + panPaddingX
  };
  const graphSurfaceWidth = Math.max(
    graphWidth,
    graphColumnX.media + nodeWidth + 26 + 360 + 28
  );
  const surfaceWidth = graphSurfaceWidth + panPaddingX * 2;
  const columns = {
    brand: model.brands,
    product: model.products,
    media: model.media
  } as const;
  const colors: Record<RevenueFlowNodeType, (index: number) => string> = {
    brand: (index) => model.brands.length === 1 ? "#17233d" : revenueFlowColor(index * 2),
    product: () => "#246bfe",
    media: (index) => revenueFlowColor(index)
  };
  const layoutNodes: RevenueFlowLayoutNode[] = [];
  const layoutById: Record<string, RevenueFlowLayoutNode> = {};

  function layoutColumn(
    columnNodes: readonly RevenueFlowNode[],
    type: RevenueFlowNodeType
  ): RevenueFlowLayoutNode[] {
    const available = innerHeight - nodeGap * Math.max(0, columnNodes.length - 1);
    const heights = constrainedNodeHeights(columnNodes, available, minimumNodeHeight);
    const totalHeight = heights.reduce((total, item) => total + item, 0)
      + nodeGap * Math.max(0, heights.length - 1);
    let y = top + Math.max(0, (innerHeight - totalHeight) / 2);
    return columnNodes.map((node, index) => {
      const layoutNode: RevenueFlowLayoutNode = {
        ...node,
        x: columnX[type],
        y,
        width: nodeWidth,
        height: heights[index] || minimumNodeHeight,
        column: type,
        color: colors[type](index + 1)
      };
      y += layoutNode.height + nodeGap;
      layoutNodes.push(layoutNode);
      layoutById[node.id] = layoutNode;
      return layoutNode;
    });
  }

  layoutColumn(columns.brand, "brand");
  layoutColumn(columns.product, "product");
  layoutColumn(columns.media, "media");

  const brandIdByProductId = { ...model.brandIdByProductId };
  for (const link of model.links) {
    const source = layoutById[link.source];
    const target = layoutById[link.target];
    if (source?.column === "brand" && target?.column === "product") {
      brandIdByProductId[target.id] = source.id;
    }
  }

  type WorkingLink = {
    index: number;
    source: RevenueFlowLayoutNode;
    target: RevenueFlowLayoutNode;
    sourceId: string;
    targetId: string;
    value: number;
    brandId: string;
    curve: number;
    color: string;
    sourceTop?: number;
    sourceBottom?: number;
    targetTop?: number;
    targetBottom?: number;
    sourceShare?: number;
    targetShare?: number;
    sourceTotal?: number;
    targetTotal?: number;
  };

  const workingLinks: WorkingLink[] = model.links.map((link, index) => {
    const source = layoutById[link.source];
    const target = layoutById[link.target];
    if (!source || !target) return null;
    const brandId = source.column === "brand"
      ? source.id
      : brandIdByProductId[source.id] || "";
    const brandLayoutEntry = brandId ? layoutById[brandId] : undefined;
    const color = source.column === "brand"
      ? source.color
      : model.brands.length > 1 && brandLayoutEntry
        ? brandLayoutEntry.color
        : "#246bfe";
    return {
      index,
      source,
      target,
      sourceId: source.id,
      targetId: target.id,
      value: Math.max(0, Number(link.value || 0)),
      brandId,
      curve: Math.max(60, (target.x - (source.x + source.width)) * 0.46),
      color
    };
  }).filter((link): link is WorkingLink => link !== null);

  const outgoingByNodeId: Record<string, WorkingLink[]> = {};
  const incomingByNodeId: Record<string, WorkingLink[]> = {};
  for (const link of workingLinks) {
    (outgoingByNodeId[link.sourceId] ||= []).push(link);
    (incomingByNodeId[link.targetId] ||= []).push(link);
  }
  Object.values(outgoingByNodeId).forEach((links) => {
    links.sort((left, right) => left.target.y - right.target.y || left.index - right.index);
  });
  Object.entries(incomingByNodeId).forEach(([nodeId, links]) => {
    const target = layoutById[nodeId];
    links.sort((left, right) => {
      if (target?.column === "media") {
        const leftBrand = layoutById[left.brandId];
        const rightBrand = layoutById[right.brandId];
        const brandOrder = (leftBrand?.y || 0) - (rightBrand?.y || 0);
        if (brandOrder) return brandOrder;
      }
      return left.source.y - right.source.y || left.index - right.index;
    });
  });

  function allocateLinkSegments(
    groups: Record<string, WorkingLink[]>,
    topKey: "sourceTop" | "targetTop",
    bottomKey: "sourceBottom" | "targetBottom",
    shareKey: "sourceShare" | "targetShare",
    totalKey: "sourceTotal" | "targetTotal"
  ): void {
    Object.entries(groups).forEach(([nodeId, links]) => {
      const nodeLayout = layoutById[nodeId];
      if (!nodeLayout || !links.length) return;
      const total = links.reduce((sum, link) => sum + link.value, 0);
      let cursor = nodeLayout.y;
      const nodeBottom = nodeLayout.y + nodeLayout.height;
      links.forEach((link, index) => {
        const share = total > 0 ? link.value / total : 1 / links.length;
        const segmentBottom = index === links.length - 1
          ? nodeBottom
          : Math.min(nodeBottom, cursor + nodeLayout.height * share);
        link[topKey] = cursor;
        link[bottomKey] = segmentBottom;
        link[shareKey] = share;
        link[totalKey] = total;
        cursor = segmentBottom;
      });
    });
  }

  allocateLinkSegments(outgoingByNodeId, "sourceTop", "sourceBottom", "sourceShare", "sourceTotal");
  allocateLinkSegments(incomingByNodeId, "targetTop", "targetBottom", "targetShare", "targetTotal");

  const layoutLinks: RevenueFlowLayoutLink[] = workingLinks.map((link) => ({
    index: link.index,
    source: link.source,
    target: link.target,
    sourceId: link.sourceId,
    targetId: link.targetId,
    value: link.value,
    sourceTop: link.sourceTop ?? link.source.y,
    sourceBottom: link.sourceBottom ?? link.source.y,
    targetTop: link.targetTop ?? link.target.y,
    targetBottom: link.targetBottom ?? link.target.y,
    curve: link.curve,
    color: link.color
  }));
  const linkByIndex: Record<number, RevenueFlowLayoutLink> = {};
  layoutLinks.forEach((link) => { linkByIndex[link.index] = link; });

  return {
    width: graphWidth,
    surfaceWidth,
    height,
    graphTop,
    graphHeight,
    top,
    bottom,
    headerY: panPaddingY + 25,
    panPaddingX,
    panPaddingY,
    initialScrollLeft: panPaddingX,
    initialScrollTop: panPaddingY,
    nodeWidth,
    nodeGap,
    columnX,
    nodes: layoutNodes,
    links: layoutLinks,
    layoutById,
    linkByIndex
  };
}

function cubicAt(
  start: number,
  startControl: number,
  endControl: number,
  end: number,
  ratio: number
): number {
  const inverse = 1 - ratio;
  return inverse * inverse * inverse * start
    + 3 * inverse * inverse * ratio * startControl
    + 3 * inverse * ratio * ratio * endControl
    + ratio * ratio * ratio * end;
}

function ribbonRatio(link: RevenueFlowLayoutLink, x: number): number {
  const startX = link.source.x + link.source.width;
  const endX = link.target.x;
  const span = endX - startX;
  if (span <= 0) return 0;
  const curve = Math.max(60, span * 0.46);
  let ratio = Math.min(1, Math.max(0, (x - startX) / span));
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const currentX = cubicAt(startX, startX + curve, endX - curve, endX, ratio);
    const inverse = 1 - ratio;
    const derivative = 3 * inverse * inverse * curve
      + 6 * inverse * ratio * (endX - startX - 2 * curve)
      + 3 * ratio * ratio * curve;
    if (Math.abs(derivative) < 0.001) break;
    ratio = Math.min(1, Math.max(0, ratio - (currentX - x) / derivative));
  }
  return ratio;
}

export function revenueFlowFlowHitTest(
  layout: RevenueFlowLayout,
  x: number,
  y: number,
  allowedLinkIndexes?: ReadonlySet<number>
): RevenueFlowLayoutLink | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let closest: RevenueFlowLayoutLink | null = null;
  let closestScore = Number.POSITIVE_INFINITY;
  for (const link of layout.links) {
    if (allowedLinkIndexes && !allowedLinkIndexes.has(link.index)) continue;
    const startX = link.source.x + link.source.width;
    const endX = link.target.x;
    if (x < startX - 4 || x > endX + 4) continue;
    const ratio = ribbonRatio(link, x);
    const top = cubicAt(link.sourceTop, link.sourceTop, link.targetTop, link.targetTop, ratio);
    const bottom = cubicAt(link.sourceBottom, link.sourceBottom, link.targetBottom, link.targetBottom, ratio);
    const thickness = Math.max(0, bottom - top);
    const tolerance = Math.max(3, Math.min(12, thickness * 0.22));
    if (y < top - tolerance || y > bottom + tolerance) continue;
    const score = Math.abs(y - (top + bottom) / 2) / Math.max(1, thickness);
    if (score < closestScore) {
      closest = link;
      closestScore = score;
    }
  }
  return closest;
}

export function revenueFlowHoverState(model: RevenueFlowModel, nodeId: string): RevenueFlowHoverState {
  return model.hoverIndex[nodeId] || {
    nodeId,
    relatedNodeIds: nodeId ? [nodeId] : [],
    relatedLinkIndexes: []
  };
}

export function revenueFlowLinkOpacity(hasFocus: boolean, isRelated: boolean): number {
  if (!hasFocus) return 0.34;
  return isRelated ? 0.82 : 0.06;
}

export function toggleRevenueFlowNode(
  model: RevenueFlowModel,
  lockedNodeId: string,
  nodeId: string
): string {
  const node = model.nodeById[nodeId];
  if (!node || node.type === "brand") return lockedNodeId;
  return lockedNodeId === nodeId ? "" : nodeId;
}

export function revenueFlowFlowDetail(
  model: RevenueFlowModel,
  link: RevenueFlowLink | undefined
): RevenueFlowFlowDetail | null {
  if (!link) return null;
  const source = model.nodeById[link.source];
  const target = model.nodeById[link.target];
  if (!source || !target) return null;
  const brandId = linkBrandId(model, link);
  const brand = model.nodeById[brandId];
  const sourceTotal = source.value;
  const targetTotal = target.value;
  return {
    index: model.links.indexOf(link),
    sourceId: source.id,
    sourceType: source.type,
    sourceLabel: source.label,
    targetId: target.id,
    targetType: target.type,
    targetLabel: target.label,
    brandLabel: brand?.label || "",
    value: link.value,
    sourceShare: sourceTotal > 0 ? link.value / sourceTotal : 0,
    targetShare: targetTotal > 0 ? link.value / targetTotal : 0,
    sourceTotal,
    targetTotal
  };
}

export function revenueFlowNodeDisplayLabel(node: RevenueFlowNode): string {
  if (node.type === "product" && node.productKey) return node.productKey;
  return node.label;
}
