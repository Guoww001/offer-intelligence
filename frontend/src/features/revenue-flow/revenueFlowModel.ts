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
  readonly color: string;
}

export interface RevenueFlowLayout {
  readonly width: number;
  readonly surfaceWidth: number;
  readonly height: number;
  readonly graphTop: number;
  readonly graphHeight: number;
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

export function buildRevenueFlowLayout(model: RevenueFlowModel, width = 1160): RevenueFlowLayout {
  const surfaceWidth = Math.max(1160, Number.isFinite(width) ? width : 1160);
  const nodeWidth = 14;
  const nodeGap = 14;
  const graphTop = 64;
  const graphBottom = 30;
  const requiredGraphHeight = Math.max(
    390,
    ...REVENUE_FLOW_NODE_TYPES.map((type) => {
      const count = model[type === "brand" ? "brands" : type === "product" ? "products" : "media"].length;
      return count ? count * 14 + Math.max(0, count - 1) * nodeGap : 390;
    })
  );
  const graphHeight = requiredGraphHeight;
  const height = graphTop + graphHeight + graphBottom;
  const columnX: Record<RevenueFlowNodeType, number> = {
    brand: 44,
    product: Math.round(surfaceWidth / 2 - nodeWidth / 2),
    media: Math.max(0, surfaceWidth - 58)
  };
  const columns = {
    brand: model.brands,
    product: model.products,
    media: model.media
  } as const;
  const layoutNodes: RevenueFlowLayoutNode[] = [];
  const layoutById: Record<string, RevenueFlowLayoutNode> = {};

  for (const type of REVENUE_FLOW_NODE_TYPES) {
    const sourceNodes = columns[type];
    const totalValue = sourceNodes.reduce((total, node) => total + node.value, 0);
    const usableHeight = Math.max(0, graphHeight - Math.max(0, sourceNodes.length - 1) * nodeGap);
    const rawHeights = sourceNodes.map((node) => Math.max(
      14,
      usableHeight * (totalValue > 0 ? node.value / totalValue : 1 / Math.max(1, sourceNodes.length))
    ));
    const rawTotal = rawHeights.reduce((total, item) => total + item, 0);
    const scale = rawTotal > usableHeight && rawTotal > 0 ? usableHeight / rawTotal : 1;
    const heights = rawHeights.map((item) => Math.max(14, item * scale));
    const occupiedHeight = heights.reduce((total, item) => total + item, 0)
      + Math.max(0, heights.length - 1) * nodeGap;
    let y = graphTop + Math.max(0, (graphHeight - occupiedHeight) / 2);
    for (let index = 0; index < sourceNodes.length; index += 1) {
      const node = sourceNodes[index];
      if (!node) continue;
      const layoutNode: RevenueFlowLayoutNode = {
        ...node,
        x: columnX[type],
        y,
        width: nodeWidth,
        height: heights[index] || 14,
        column: type
      };
      layoutNodes.push(layoutNode);
      layoutById[node.id] = layoutNode;
      y += layoutNode.height + nodeGap;
    }
  }

  const sourceCursors = new Map<string, number>();
  const targetCursors = new Map<string, number>();
  const layoutLinks: RevenueFlowLayoutLink[] = [];
  const linkByIndex: Record<number, RevenueFlowLayoutLink> = {};
  model.links.forEach((link, index) => {
    const source = layoutById[link.source];
    const target = layoutById[link.target];
    if (!source || !target) return;
    const sourceTotal = totalForLinks(model.links, source.id, "source") || source.value;
    const targetTotal = totalForLinks(model.links, target.id, "target") || target.value;
    const sourceHeight = Math.max(1, source.height * link.value / Math.max(1, sourceTotal));
    const targetHeight = Math.max(1, target.height * link.value / Math.max(1, targetTotal));
    const sourceTop = source.y + (sourceCursors.get(source.id) || 0);
    const targetTop = target.y + (targetCursors.get(target.id) || 0);
    sourceCursors.set(source.id, (sourceCursors.get(source.id) || 0) + sourceHeight);
    targetCursors.set(target.id, (targetCursors.get(target.id) || 0) + targetHeight);
    const layoutLink: RevenueFlowLayoutLink = {
      index,
      source,
      target,
      sourceId: source.id,
      targetId: target.id,
      value: link.value,
      sourceTop,
      sourceBottom: sourceTop + sourceHeight,
      targetTop,
      targetBottom: targetTop + targetHeight,
      color: revenueFlowColor(brandIndex(model, linkBrandId(model, link)))
    };
    layoutLinks.push(layoutLink);
    linkByIndex[index] = layoutLink;
  });

  return {
    width: Math.max(0, Number.isFinite(width) ? width : surfaceWidth),
    surfaceWidth,
    height,
    graphTop,
    graphHeight,
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
  const curve = Math.max(45, span * 0.42);
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
