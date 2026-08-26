# Agent 结构化对话记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent 页面从“仅依赖易丢失、按字符截断的成功问答文本”升级为可跨页面刷新恢复的结构化业务上下文，使后续问题能继续识别当前商户、品类、Tier、时间范围、指标、最近工具来源以及候选实体决策。

**Architecture:** 新增一个零依赖的浏览器端状态模块 `public/agent_memory_state.js`，负责版本化 schema、白名单归一化、7 天有效期、`localStorage` 容错、候选实体状态机以及中英文 Prompt/UI 摘要。`public/app.js` 只把工具结果投影成安全的 memory event；成功回合结束后再提交 event，下一轮通过现有 `memoryText` 通道把结构化上下文同时提供给规划和综合阶段。首期只保存一个活动上下文，不保存完整对话正文，不新增数据库或后端接口；“新对话”和退出登录都会清除本地状态。

**Tech Stack:** 原生 JavaScript、浏览器 `localStorage`、现有 Agent 工具与流式接口、Node.js `vm` 回归测试、GitHub Actions、`browser-act` 浏览器验收。

## 执行状态（2026-08-26）

- Task 1：已完成。状态 schema、白名单归一化、本地存储容错、过期和候选状态机已实现并通过 `scripts/test_agent_memory_state.mjs`。
- Task 2：已完成。工具结果安全投影、成功 outcome 的 `memoryEvents` 和 Agent 核心回归已通过，未改变 Trace payload。
- Task 3：已完成。页面刷新恢复、新对话/登出清除、欢迎区提示、cache bust 和生命周期测试已接入。
- Task 4：已完成。路线图、Chatbot 功能档案和 CI 已同步，新增记忆测试已加入 `.github/workflows/ci.yml`。
- Task 5：自动化回归已完成；真实浏览器验收因当前环境没有 BrowserAct 浏览器且未配置 API key 阻塞，不能宣称浏览器验证通过。

## Global Constraints

- [ ] 本方案只实现路线图 4.5 的首期“结构化多轮记忆 + 当前上下文恢复”；会话列表、完整会话恢复、分享和跨设备同步保留为后续范围。
- [ ] 不新增或修改 MySQL 表、DDL、Python 数据库模块、`server.py`、`api/` 或 `/api/chat/*` 请求合同。
- [ ] `localStorage` 只能保存白名单字段；不得保存 Prompt、问答正文、完整历史、完整工具参数、完整工具结果、指标值对象、付款明细行、异常正文或堆栈。
- [ ] 最近工具摘要只保留 `toolName`、最多 240 字符的 `headline`、`dataSource`、`dataAsOf`、`estimated` 和 `partial`。
- [ ] 结构化记忆用于代词消解和补全查询范围，不得把旧上下文当作当前数值来源；涉及当前数值的追问仍必须调用数据工具。
- [ ] 只在 `outcome.handled === true && outcome.ok === true` 后提交状态；失败、网络异常和用户中止不得覆盖上一份有效记忆。
- [ ] 工具综合失败但已生成受控 fallback 回答时，仍可提交本轮已成功执行的工具上下文；歧义候选只能在受控的 `dataUnavailable` 回答后提交。
- [ ] `localStorage` 不可用、JSON 损坏、版本不兼容、状态过期或保存超限时必须静默降级为空记忆，不能阻断 Agent 回答。
- [ ] “新对话”和退出登录必须清理 `oi_agent_memory_v1`；刷新页面不清理。
- [ ] 保留现有 `state.agentPage.history` 成功问答配对逻辑；首期不把文本历史写入持久化存储。
- [ ] 保留 Agent Trace 的隐私边界；结构化记忆不得复用 Trace 表，也不得改变 Trace payload。
- [ ] 修改 `public/app.js` 时同步更新 `public/auth.js` 的 `APP_SCRIPT` cache bust；修改 `public/auth.js` 时同步更新 `public/index.html` 中的 auth cache bust。
- [ ] 浏览器验收必须使用 `$browser-act`，不得使用 Playwright；验收结束后关闭 `http://127.0.0.1:8765/` 的本地服务器。
- [ ] 当前工作树已有 `protected_data/db_offers_cache.json` 修改和 `docs/superpowers/plans/2026-08-25-agent-trace-metrics.md` 未跟踪文件；实施时不得改写、暂存或提交这些无关内容。

---

## 现状映射与目标数据流

### 当前入口

| 责任 | 当前位置 | 本次动作 |
|---|---|---|
| Agent 页面状态 | `public/app.js:549` 的 `state.agentPage` | 增加 `memory`，保留 `history/submitting/abortController` |
| 文本历史裁剪 | `public/app.js:13763-13976` 附近 | 保持原行为，不持久化文本历史 |
| 工具执行 | `public/app.js:14632` 的 `agentExecuteTool()` | 不改变工具输入/输出合同，只在外层投影 memory event |
| Agent 编排 | `public/app.js:15630` 的 `runChatAgent()` | 成功 outcome 增加安全的 `memoryEvents` |
| 页面提交 | `public/app.js:16211` 的 `handleAgentPageSubmit()` | 传入结构化 `memoryText`，成功后提交 event |
| 新对话 | `public/app.js:16179` 的 `resetAgentPageConversation()` | 同时清理结构化状态与存储 |
| 应用加载 | `public/auth.js:2,235` | 保持先取受保护数据、后加载 `app.js`；更新 cache bust |
| 登出 | `public/auth.js:259-270` | reload 前清理结构化状态 |
| 静态脚本顺序 | `public/index.html:2125-2130` | 在 `auth.js` 前加载结构化状态模块 |
| Agent 主测试 | `scripts/test_chat_agent.mjs` | 先加载新模块并增加投影、outcome、生命周期测试 |
| CI | `.github/workflows/ci.yml:80-81` | 增加独立状态模块测试 |

### 目标数据流

```text
Agent 工具结果
  -> agentMemoryEventFromToolItem() 白名单投影
  -> runChatAgent() 返回 memoryEvents，不返回原始工具结果给页面状态
  -> 成功 outcome 后 applyEvents()
  -> state.agentPage.memory + localStorage(oi_agent_memory_v1)
  -> 下一轮 toPromptText()
  -> 现有 planning memoryText + synthesis memoryText

页面刷新 -> load() -> 欢迎区显示“已恢复上下文” -> 后续追问继续取数
新对话/退出登录 -> clear() -> 页面刷新后不再恢复
```

### 持久化 schema v1

```js
{
  version: 1,
  updatedAt: "2026-08-26T08:00:00.000Z",
  focus: {
    merchants: [{ id: "398679", name: "Tapo" }],
    categories: ["Electronics"],
    tiers: ["Tier 1"]
  },
  query: {
    startMonth: "2026-01",
    endMonth: "2026-08",
    months: 8,
    metrics: ["epc", "conversionRate"]
  },
  lastTool: {
    toolName: "trend",
    headline: "Tapo 趋势 · epc",
    dataSource: "database",
    dataAsOf: "2026-08-26T07:40:00Z",
    estimated: false,
    partial: false
  },
  candidates: {
    pending: [],
    confirmed: [{ type: "merchant", id: "398679", name: "Tapo" }],
    rejected: []
  }
}
```

约束：`merchants <= 5`、`categories <= 4`、`tiers <= 5`、`metrics <= 12`、每组候选 `<= 10`、单字符串 `<= 120`、`headline <= 240`、序列化文本 `<= 12000` 字符。

---

## Task 1：建立纯函数状态合同和本地存储边界（已完成）

**Files:**

- Create: `public/agent_memory_state.js`
- Create: `scripts/test_agent_memory_state.mjs`

### 1.1 先写失败测试

- [ ] 新建 `scripts/test_agent_memory_state.mjs`，使用可写 storage stub 和固定时间，至少覆盖：
  - 空状态与 schema v1；
  - 成功事件更新焦点、时间、指标和最近工具摘要；
  - 同一回合有多个成功工具时合并活动实体、周期和指标，不能只保留最后一个工具的商户；新回合首次成功工具会替换上一回合的活动焦点；
  - 歧义候选进入 `pending`；下一次成功选择其中一个后，所选项进入 `confirmed`，其余项进入 `rejected`；
  - 重复实体按 `type + id`，无 ID 时按 `type + name` 去重；
  - Prompt、回答、完整工具结果、指标值和明细行即使混入 event，也不会出现在序列化状态；
  - 版本不兼容、JSON 损坏、超过 7 天、超过 12000 字符时返回空状态并移除坏值；
  - storage 的 `getItem/setItem/removeItem` 抛错时不向上抛出；
  - `toPromptText()` 中英文都包含实体、范围、来源和“当前数值需重新取数”规则；
  - `toDisplayText()` 只生成单行、长度受限的恢复提示。

测试核心夹具按以下形状编写：

```js
import fs from "node:fs";
import vm from "node:vm";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value`);
}

const values = Object.create(null);
const storage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
  setItem(key, value) { values[key] = String(value); },
  removeItem(key) { delete values[key]; }
};
const sandbox = { window: {}, console, Date, JSON, Object, Array, String, Number, Math, RegExp };
vm.runInNewContext(fs.readFileSync("public/agent_memory_state.js", "utf8"), sandbox, {
  filename: "public/agent_memory_state.js"
});

const memory = sandbox.window.AGENT_MEMORY_STATE;
const now = Date.parse("2026-08-26T08:00:00.000Z");
assertTruthy(memory, "memory module should be exported");

let state = memory.empty(now);
state = memory.applyEvents(state, [{
  kind: "tool_success",
  focus: {
    merchants: [{ id: "398679", name: "Tapo" }],
    categories: ["Electronics"],
    tiers: ["Tier 1"]
  },
  query: {
    startMonth: "2026-01",
    endMonth: "2026-08",
    months: 8,
    metrics: ["epc", "conversionRate"]
  },
  lastTool: {
    toolName: "trend",
    headline: "Tapo 趋势 · epc",
    dataSource: "database",
    dataAsOf: "2026-08-26T07:40:00Z",
    estimated: false,
    partial: false
  },
  resolvedEntities: [{ type: "merchant", id: "398679", name: "Tapo" }],
  prompt: "不得保存的原始问题",
  answer: "不得保存的回答正文",
  toolResult: { metrics: { epc: 1.23 }, rows: [{ merchant: "Tapo" }] }
}], now);

assertEqual(state.focus.merchants[0].id, "398679", "merchant id should be retained");
assertEqual(state.query.metrics.join(","), "epc,conversionRate", "metric keys should be retained");
assertEqual(JSON.stringify(state).includes("不得保存"), false, "raw text should be discarded");
assertEqual(JSON.stringify(state).includes("1.23"), false, "metric values should be discarded");
assertTruthy(memory.save(storage, state, now), "valid memory should save");
assertEqual(memory.load(storage, now).lastTool.dataSource, "database", "saved memory should restore");

console.log("Agent structured memory state tests passed.");
```

- [ ] 运行 `node scripts/test_agent_memory_state.mjs`。
- [ ] 预期 RED：`public/agent_memory_state.js` 尚不存在，测试以 `ENOENT` 失败。

### 1.2 实现版本化状态模块

- [ ] 在 `public/agent_memory_state.js` 使用 IIFE 导出 `window.AGENT_MEMORY_STATE`，公开接口固定为：

```js
(function (root) {
  "use strict";

  var STORAGE_KEY = "oi_agent_memory_v1";
  var VERSION = 1;
  var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  var MAX_SERIALIZED_CHARS = 12000;

  root.AGENT_MEMORY_STATE = {
    STORAGE_KEY: STORAGE_KEY,
    VERSION: VERSION,
    empty: empty,
    normalize: normalize,
    applyEvents: applyEvents,
    hasMeaningfulContext: hasMeaningfulContext,
    load: load,
    save: save,
    clear: clear,
    toPromptText: toPromptText,
    toDisplayText: toDisplayText
  };
})(window);
```

- [ ] `empty()` 和归一化输出必须始终返回完整 schema，不能让调用方判断缺失层级：

```js
function empty(nowMs) {
  return {
    version: VERSION,
    updatedAt: new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString(),
    focus: { merchants: [], categories: [], tiers: [] },
    query: { startMonth: null, endMonth: null, months: null, metrics: [] },
    lastTool: null,
    candidates: { pending: [], confirmed: [], rejected: [] }
  };
}
```

- [ ] 实体、月份、来源和布尔值必须用白名单归一化；关键辅助函数采用以下合同：

```js
function clip(value, max) {
  return String(value === null || value === undefined ? "" : value).trim().slice(0, max);
}

function month(value) {
  var text = clip(value, 7);
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(text) ? text : null;
}

function entity(value) {
  value = value && typeof value === "object" ? value : {};
  var type = ["merchant", "category", "tier"].indexOf(clip(value.type, 16)) >= 0
    ? clip(value.type, 16) : "merchant";
  var id = clip(value.id, 80);
  var name = clip(value.name, 120);
  return name || id ? { type: type, id: id, name: name || id } : null;
}

function entityKey(value) {
  return value.type + ":" + String(value.id || value.name).toLowerCase();
}

function uniqueEntities(values, limit) {
  var seen = Object.create(null);
  var out = [];
  (Array.isArray(values) ? values : []).forEach(function (value) {
    var normalized = entity(value);
    if (!normalized) return;
    var key = entityKey(normalized);
    if (seen[key] || out.length >= limit) return;
    seen[key] = true;
    out.push(normalized);
  });
  return out;
}

function uniqueStrings(values, limit, maxChars) {
  var seen = Object.create(null);
  var out = [];
  (Array.isArray(values) ? values : []).forEach(function (value) {
    var text = clip(value, maxChars);
    var key = text.toLowerCase();
    if (!text || seen[key] || out.length >= limit) return;
    seen[key] = true;
    out.push(text);
  });
  return out;
}
```

- [ ] `applyEvents()` 只读取 `kind/focus/query/lastTool/resolvedEntities/candidates`；event 的其他键必须天然丢弃。候选转移逻辑必须匹配以下实现：

```js
function applyEvents(current, events, nowMs) {
  var next = normalize(current, nowMs);
  var sourceEvents = Array.isArray(events) ? events : [];
  if (sourceEvents.some(function (event) { return event && event.kind === "tool_success"; })) {
    next.focus = { merchants: [], categories: [], tiers: [] };
    next.query = { startMonth: null, endMonth: null, months: null, metrics: [] };
  }
  sourceEvents.forEach(function (event) {
    if (!event || typeof event !== "object") return;

    if (event.kind === "candidates") {
      next.candidates.pending = uniqueEntities(event.candidates, 10);
      return;
    }
    if (event.kind !== "tool_success") return;

    var focus = event.focus && typeof event.focus === "object" ? event.focus : {};
    next.focus = {
      merchants: uniqueEntities(next.focus.merchants.concat(focus.merchants || []), 5).map(function (item) {
        return { id: item.id, name: item.name };
      }),
      categories: uniqueStrings(next.focus.categories.concat(focus.categories || []), 4, 120),
      tiers: uniqueStrings(next.focus.tiers.concat(focus.tiers || []), 5, 40)
    };
    next.query = mergeQuery(next.query, event.query);
    next.lastTool = normalizeLastTool(event.lastTool);

    var selected = uniqueEntities(event.resolvedEntities, 10);
    var selectedKeys = Object.create(null);
    selected.forEach(function (item) { selectedKeys[entityKey(item)] = true; });
    var selectedFromPending = next.candidates.pending.some(function (item) {
      return !!selectedKeys[entityKey(item)];
    });
    if (selectedFromPending) {
      var rejected = next.candidates.pending.filter(function (item) {
        return !selectedKeys[entityKey(item)];
      });
      next.candidates.rejected = uniqueEntities(next.candidates.rejected.concat(rejected), 10);
      next.candidates.pending = [];
    }
    next.candidates.confirmed = uniqueEntities(next.candidates.confirmed.concat(selected), 10);
  });
  next.updatedAt = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  return normalize(next, nowMs);
}
```

- [ ] `normalizeQuery()` 只保存月份和指标名；`normalizeLastTool()` 只接受当前 Trace 来源枚举：

```js
function normalizeQuery(value) {
  value = value && typeof value === "object" ? value : {};
  var numericMonths = Number(value.months);
  return {
    startMonth: month(value.startMonth),
    endMonth: month(value.endMonth),
    months: Number.isInteger(numericMonths) && numericMonths >= 1 && numericMonths <= 24
      ? numericMonths : null,
    metrics: uniqueStrings(value.metrics, 12, 40)
  };
}

function mergeQuery(current, incoming) {
  var left = normalizeQuery(current);
  var right = normalizeQuery(incoming);
  var starts = [left.startMonth, right.startMonth].filter(Boolean).sort();
  var ends = [left.endMonth, right.endMonth].filter(Boolean).sort();
  return {
    startMonth: starts.length ? starts[0] : null,
    endMonth: ends.length ? ends[ends.length - 1] : null,
    months: right.months || left.months,
    metrics: uniqueStrings(left.metrics.concat(right.metrics), 12, 40)
  };
}

function normalizeLastTool(value) {
  if (!value || typeof value !== "object") return null;
  var source = clip(value.dataSource, 16);
  if (["cache", "database", "mixed", "unknown"].indexOf(source) < 0) source = "unknown";
  var toolName = clip(value.toolName, 48);
  var headline = clip(value.headline, 240);
  if (!toolName && !headline) return null;
  return {
    toolName: toolName,
    headline: headline,
    dataSource: source,
    dataAsOf: clip(value.dataAsOf, 40) || null,
    estimated: value.estimated === true,
    partial: value.partial === true
  };
}
```

- [ ] `normalize()` 和 `hasMeaningfulContext()` 使用完整白名单重建对象：

```js
function normalize(value, nowMs) {
  var source = value && typeof value === "object" ? value : {};
  var focus = source.focus && typeof source.focus === "object" ? source.focus : {};
  var candidates = source.candidates && typeof source.candidates === "object"
    ? source.candidates : {};
  return {
    version: VERSION,
    updatedAt: Number.isFinite(Date.parse(source.updatedAt))
      ? new Date(Date.parse(source.updatedAt)).toISOString()
      : new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString(),
    focus: {
      merchants: uniqueEntities(focus.merchants, 5).map(function (item) {
        return { id: item.id, name: item.name };
      }),
      categories: uniqueStrings(focus.categories, 4, 120),
      tiers: uniqueStrings(focus.tiers, 5, 40)
    },
    query: normalizeQuery(source.query),
    lastTool: normalizeLastTool(source.lastTool),
    candidates: {
      pending: uniqueEntities(candidates.pending, 10),
      confirmed: uniqueEntities(candidates.confirmed, 10),
      rejected: uniqueEntities(candidates.rejected, 10)
    }
  };
}

function hasMeaningfulContext(value) {
  var state = normalize(value);
  return state.focus.merchants.length > 0
    || state.focus.categories.length > 0
    || state.focus.tiers.length > 0
    || state.query.metrics.length > 0
    || !!state.query.startMonth
    || !!state.query.endMonth
    || !!state.lastTool
    || state.candidates.pending.length > 0
    || state.candidates.confirmed.length > 0
    || state.candidates.rejected.length > 0;
}
```

- [ ] `load/save/clear` 必须捕获 storage 异常；`load()` 校验 `version`、`updatedAt`、7 天有效期和 12000 字符上限，非法值调用一次 `removeItem()` 后返回 `empty(now)`：

```js
function clear(storage) {
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch (_error) {
    return false;
  }
}

function load(storage, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    var raw = storage.getItem(STORAGE_KEY);
    if (!raw) return empty(now);
    if (raw.length > MAX_SERIALIZED_CHARS) throw new Error("agent_memory_too_large");
    var parsed = JSON.parse(raw);
    var updatedAt = Date.parse(parsed && parsed.updatedAt);
    if (!parsed || parsed.version !== VERSION) throw new Error("agent_memory_version");
    if (!Number.isFinite(updatedAt) || now - updatedAt > MAX_AGE_MS || updatedAt > now + 60000) {
      throw new Error("agent_memory_expired");
    }
    return normalize(parsed, now);
  } catch (_error) {
    clear(storage);
    return empty(now);
  }
}

function save(storage, value, nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var normalized = normalize(value, now);
  normalized.updatedAt = new Date(now).toISOString();
  if (!hasMeaningfulContext(normalized)) return clear(storage);
  var serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_SERIALIZED_CHARS) return false;
  try {
    storage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch (_error) {
    return false;
  }
}
```

- [ ] `toPromptText()` 输出顺序固定为活动商户、品类、Tier、时间范围、指标、最近工具、待确认/已确认/已拒绝实体、安全规则；没有有意义上下文时返回空字符串。实现以下格式化函数和组装逻辑：

```js
function merchantText(value) {
  return value.name + (value.id ? " (ID " + value.id + ")" : "");
}

function candidateText(value) {
  return value.name + (value.id ? " (ID " + value.id + ")" : "");
}

function periodText(query, en) {
  if (query.startMonth && query.endMonth) {
    return query.startMonth === query.endMonth
      ? query.startMonth : query.startMonth + "–" + query.endMonth;
  }
  return query.startMonth || query.endMonth
    || (query.months ? String(query.months) + (en ? " months" : " 个月") : "");
}

function toPromptText(value, language) {
  var state = normalize(value);
  if (!hasMeaningfulContext(state)) return "";
  var en = language === "en";
  var lines = [en ? "[Agent structured memory]" : "[Agent 结构化记忆]"];
  if (state.focus.merchants.length) lines.push((en ? "Active merchants: " : "当前商户：") + state.focus.merchants.map(merchantText).join(en ? ", " : "、"));
  if (state.focus.categories.length) lines.push((en ? "Active categories: " : "当前品类：") + state.focus.categories.join(en ? ", " : "、"));
  if (state.focus.tiers.length) lines.push((en ? "Active tiers: " : "当前 Tier：") + state.focus.tiers.join(en ? ", " : "、"));
  var period = periodText(state.query, en);
  if (period) lines.push((en ? "Period: " : "时间范围：") + period);
  if (state.query.metrics.length) lines.push((en ? "Metrics: " : "指标：") + state.query.metrics.join(en ? ", " : "、"));
  if (state.lastTool) {
    lines.push((en ? "Last tool: " : "最近工具：") + [
      state.lastTool.toolName,
      state.lastTool.headline,
      state.lastTool.dataSource,
      state.lastTool.dataAsOf,
      state.lastTool.estimated ? (en ? "estimated" : "估算") : "",
      state.lastTool.partial ? (en ? "partial" : "部分执行") : ""
    ].filter(Boolean).join(" | "));
  }
  [["pending", en ? "Pending candidates: " : "待确认候选："], ["confirmed", en ? "Confirmed candidates: " : "已确认候选："], ["rejected", en ? "Rejected candidates: " : "已拒绝候选："]].forEach(function (item) {
    var values = state.candidates[item[0]];
    if (values.length) lines.push(item[1] + values.map(candidateText).join(en ? ", " : "、"));
  });
  lines.push(en
    ? "Use this context only to resolve references and carry query scope. Always run a data tool for current numeric values."
    : "这些上下文只用于消解指代和延续查询范围；涉及当前数值时必须重新调用数据工具。");
  return lines.join("\n");
}
```

- [ ] `toDisplayText()` 返回单行摘要，例如 `已恢复上下文：Tapo（ID 398679） · Electronics · Tier 1 · 2026-01–2026-08 · epc / conversionRate`；英文对应 `Restored context: Tapo (ID 398679) · Electronics · Tier 1 · 2026-01–2026-08 · epc / conversionRate`。实现：

```js
function toDisplayText(value, language) {
  var state = normalize(value);
  if (!hasMeaningfulContext(state)) return "";
  var en = language === "en";
  var parts = [];
  if (state.focus.merchants.length) parts.push(state.focus.merchants.map(merchantText).join(en ? ", " : "、"));
  if (state.focus.categories.length) parts.push(state.focus.categories.join(en ? ", " : "、"));
  if (state.focus.tiers.length) parts.push(state.focus.tiers.join(en ? ", " : "、"));
  var period = periodText(state.query, en);
  if (period) parts.push(period);
  if (state.query.metrics.length) parts.push(state.query.metrics.join(" / "));
  var prefix = en ? "Restored context: " : "已恢复上下文：";
  return (prefix + parts.join(" · ")).slice(0, 360);
}
```

### 1.3 验证并提交

- [ ] 运行 `node --check public/agent_memory_state.js`，预期退出码 0。
- [ ] 运行 `node scripts/test_agent_memory_state.mjs`，预期输出 `Agent structured memory state tests passed.`。
- [ ] 运行 `git diff --check -- public/agent_memory_state.js scripts/test_agent_memory_state.mjs`。
- [ ] 只暂存本任务两个文件并检查 `git diff --cached --stat`。
- [ ] 提交：

```powershell
git add public/agent_memory_state.js scripts/test_agent_memory_state.mjs
git commit -m "Add structured Agent memory state / 添加 Agent 结构化记忆状态"
```

---

## Task 2：把工具结果投影为安全 memory event（已完成）

**Files:**

- Modify: `public/app.js:13515-14920`
- Modify: `public/app.js:15630-16122`
- Modify: `public/app.js:32366-32394`
- Modify: `scripts/test_chat_agent.mjs`

### 2.1 先写失败测试

- [ ] 在 `scripts/test_chat_agent.mjs` 中先加载状态模块：

```js
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/agent_memory_state.js", sandbox);
runScript("public/app.js", sandbox);
```

- [ ] 增加 hook 存在性断言和以下行为测试：

```js
assertTruthy(hooks.agentMemoryEventFromToolItem, "agentMemoryEventFromToolItem hook missing");
assertTruthy(hooks.agentMemoryEventsFromToolResults, "agentMemoryEventsFromToolResults hook missing");

const offer = sandbox.window.CHATBOT_DATA.offers[0];
const canonicalName = offer.brand || offer.merchantName;
const event = hooks.agentMemoryEventFromToolItem({
  name: "merchant_analysis",
  result: {
    ok: true,
    data: {
      merchant: canonicalName,
      category: offer.mainCategory || offer.category,
      tier: offer.tier,
      latestMonth: "2026-08",
      monthly: [{ month: "2026-08", epc: 1.2 }, { month: "2026-07", epc: 1.1 }],
      headline: `${canonicalName} overview`,
      metrics: { epc: 1.2, conversionRate: 0.03 }
    },
    trace: { dataSource: "mixed", dataAsOf: "2026-08-26T07:40:00Z", estimated: false }
  }
}, `查询 ${canonicalName} 的 EPC 和转化率`, { partial: false });

assertEqual(event.focus.merchants[0].id, String(offer.merchantId), "event should use canonical merchant id");
assertEqual(event.query.metrics.join(","), "epc,conversionRate", "event should keep requested metric names");
assertEqual(event.query.startMonth, "2026-07", "event should derive the actual start month");
assertEqual(event.query.endMonth, "2026-08", "event should derive the actual end month");
assertEqual(event.lastTool.dataSource, "mixed", "event should retain the source metadata");
assertEqual(JSON.stringify(event).includes("1.2"), false, "event must not retain metric values");
```

- [ ] 增加歧义测试：`result.ok=false` 且 `resolution.status="ambiguous"` 时 event 只能包含候选实体，不包含 `error` 正文。
- [ ] 在一个现有成功工具调用测试后断言 `runChatAgent()` 的 outcome 带有非空 `memoryEvents`；在停止测试后断言没有可提交 event。
- [ ] 运行 `node scripts/test_chat_agent.mjs`。
- [ ] 预期 RED：缺少 `agentMemoryEventFromToolItem`/`agentMemoryEventsFromToolResults` hook 或成功 outcome 缺少 `memoryEvents`。

### 2.2 实现指标、实体、周期和候选投影

- [ ] 在 Agent 常量附近新增只返回指标键名的解析器；不得复制任何指标值：

```js
function agentMemoryMetricKeys(prompt, data) {
  var text = String(prompt || "");
  var definitions = [
    { key: "epc", pattern: /\bepc\b/i },
    { key: "aov", pattern: /\baov\b|客单价|平均订单金额/i },
    { key: "conversionRate", pattern: /\b(?:cvr|conversion(?:\s+rate)?)\b|转化率|转换率/i },
    { key: "orders", pattern: /\border(?:s)?\b|订单/i },
    { key: "clicks", pattern: /\bclicks?\b|点击/i },
    { key: "commission", pattern: /\bcommission\b|佣金/i },
    { key: "commissionRate", pattern: /commission\s*rate|佣金率/i },
    { key: "revenue", pattern: /\b(?:revenue|sales)\b|销售额|收入|营收/i },
    { key: "paymentStatus", pattern: /\bpayment\b|付款|支付状态/i }
  ];
  var requested = definitions.filter(function (item) {
    return item.pattern.test(text);
  }).map(function (item) { return item.key; });
  if (requested.length) return requested;
  if (data && typeof data.metric === "string" && data.metric.trim()) return [data.metric.trim()];
  return data && Array.isArray(data.metrics)
    ? data.metrics.filter(function (item) { return typeof item === "string"; }).slice(0, 12)
    : [];
}
```

- [ ] 新增 `agentMemoryResolvedMerchant(name)`，必须复用 `agentResolveMerchant()`，只返回 `{id,name,category,tier}`；解析失败返回 `null`。
- [ ] 新增 `agentMemoryPeriod(data, args)`，按以下优先级生成实际周期：
  1. `data.months[].month`；
  2. `data.monthly[].month`；
  3. `data.filter.month`；
  4. `data.latestMonth`；
  5. 没有合法月份时 `startMonth/endMonth=null`，只保留合法 `args.months`。
- [ ] 新增候选扁平化函数，兼容单商户 `resolution.candidates` 和商户对比 `resolution.merchants[].candidates`，输出只含 `{type:"merchant",id,name}`。
- [ ] `agentMemoryEventFromToolItem(item, prompt, executionMeta)` 映射必须遵循下表：

| 工具 | 活动商户 | 活动品类 | 活动 Tier | 周期/指标 |
|---|---|---|---|---|
| `merchant_analysis` | `data.merchant` 重新严格解析 | 已解析 offer 的 category | 已解析 offer 的 tier | `monthly/latestMonth` + Prompt 指标键 |
| `merchant_comparison` | 每个 `data.entities[].name` 重新严格解析 | 去重后的实体品类 | 去重后的实体 Tier | Prompt 指标键 |
| `category_analysis` | 空 | `data.category` | 空 | Prompt 指标键 |
| `category_comparison` | 空 | `data.entities[].name` | `data.tierFilter`（如有） | Prompt 指标键 |
| `tier_analysis` | 空 | 空 | `data.tier` | Prompt 指标键 |
| `payment_status` | `data.filter.merchant`（如有）严格解析 | 商户对应品类（如有） | filter Tier 或商户 Tier | filter month + Prompt 指标键 |
| `trend` | 仅 `entityType=merchant` 时解析 `data.target` | 仅 category trend | 仅 tier trend | `data.months` + `data.metric/metrics` |

- [ ] 成功 event 的形状固定，不附加原始 `data/result/args/prompt`：

```js
return {
  kind: "tool_success",
  focus: {
    merchants: merchants.map(function (item) { return { id: item.id, name: item.name }; }),
    categories: categories,
    tiers: tiers
  },
  query: {
    startMonth: period.startMonth,
    endMonth: period.endMonth,
    months: period.months,
    metrics: agentMemoryMetricKeys(prompt, data)
  },
  lastTool: {
    toolName: String(item.name || ""),
    headline: String(data.headline || "").slice(0, 240),
    dataSource: meta.dataSource,
    dataAsOf: meta.dataAsOf,
    estimated: meta.estimated,
    partial: !!(executionMeta && executionMeta.partial)
  },
  resolvedEntities: resolvedEntities
};
```

- [ ] 失败 event 只在存在候选时返回：

```js
if (!result.ok) {
  var candidates = agentMemoryCandidatesFromResolution(result.resolution);
  return candidates.length ? { kind: "candidates", candidates: candidates } : null;
}
```

- [ ] `agentMemoryEventsFromToolResults()` 过滤空 event，并保持工具执行顺序：

```js
function agentMemoryEventsFromToolResults(toolResults, prompt, executionMeta) {
  return (Array.isArray(toolResults) ? toolResults : []).map(function (item) {
    return agentMemoryEventFromToolItem(item, prompt, executionMeta);
  }).filter(Boolean);
}
```

### 2.3 让成功 outcome 携带安全事件

- [ ] 在 `runChatAgent()` 内部新增闭包，不把 `toolResults` 原样暴露给调用方：

```js
function memoryEventsForOutcome() {
  return agentMemoryEventsFromToolResults(toolResults, prompt, {
    partial: omittedCalls.length > 0
  });
}
```

- [ ] 以下 `handled:true, ok:true` 返回都增加 `memoryEvents: memoryEventsForOutcome()`：
  - `missingDataOutcome()`；
  - 工具失败后规划器返回受控 `plan.content`；
  - 综合失败后的 `renderAgentFallbackReply()`；
  - 正常综合成功。
- [ ] 规划前直接回答没有工具事件，固定返回 `memoryEvents: []`；`stoppedOutcome()`、`handled:false` 和抛错路径不返回可提交事件。
- [ ] 在测试 hooks 中公开 `agentMemoryMetricKeys`、`agentMemoryEventFromToolItem` 和 `agentMemoryEventsFromToolResults`。

### 2.4 验证并提交

- [ ] 运行 `node --check public/app.js`。
- [ ] 运行 `node scripts/test_chat_agent.mjs`。
- [ ] 运行 `node scripts/test_agent_trace.mjs`，确认新 outcome 字段没有改变 Trace payload。
- [ ] 运行 `git diff --check -- public/app.js scripts/test_chat_agent.mjs`。
- [ ] 检查 `git diff -- public/app.js scripts/test_chat_agent.mjs`，确认没有持久化 Prompt/回答/指标值。
- [ ] 提交：

```powershell
git add public/app.js scripts/test_chat_agent.mjs
git commit -m "Project Agent tool context into memory / 投影 Agent 工具上下文到记忆"
```

---

## Task 3：接入页面生命周期、刷新恢复、清理和可见提示（已完成）

**Files:**

- Modify: `public/index.html:2125-2130`
- Modify: `public/auth.js:2,259-270`
- Modify: `public/app.js:549,2269-2304,16125-16341,31092-31125,32366-32394`
- Modify: `public/styles.css:4019-4068` and dashboard Agent overrides near `public/styles.css:21637-21666`
- Modify: `scripts/test_agent_memory_state.mjs`
- Modify: `scripts/test_chat_agent.mjs`

### 3.1 先写失败测试

- [ ] 在 `scripts/test_agent_memory_state.mjs` 读取 `public/index.html`、`public/auth.js` 和 `public/app.js`，先增加静态合同：

```js
const html = fs.readFileSync("public/index.html", "utf8");
const auth = fs.readFileSync("public/auth.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

assertTruthy(html.includes("agent_memory_state.js?v=20260826-agent-memory1"), "index should load memory module");
assertTruthy(
  html.indexOf("agent_memory_state.js") < html.indexOf("auth.js"),
  "memory module must load before auth and app bootstrap"
);
assertTruthy(auth.includes("app.js?v=20260826-agent-memory1"), "auth should bust the app cache");
assertTruthy(auth.includes("AGENT_MEMORY_STATE.clear(localStorage)"), "logout should clear Agent memory");
assertTruthy(app.includes("memoryText: agentPageMemoryText(language)"), "Agent page should send structured memory");
```

- [ ] 把 `scripts/test_chat_agent.mjs` 的 storage stub 改为真实可写 map，并增加 hooks 生命周期测试：

```js
hooks.commitAgentPageMemory([event]);
assertTruthy(storageValues.oi_agent_memory_v1, "successful memory event should persist");
assertIncludes(hooks.agentPageMemoryText("zh"), String(offer.merchantId), "prompt memory should include merchant id");
assertIncludes(hooks.agentPageWelcomeHtml(), "已恢复上下文", "welcome should disclose restored context");
hooks.resetAgentPageConversation();
assertEqual(storageValues.oi_agent_memory_v1, undefined, "new conversation should clear persisted memory");
```

- [ ] 增加失败/中止回归：先保存一份有效状态，再提交空事件或模拟 stopped outcome，断言 storage 内容不变。
- [ ] 运行 `node scripts/test_agent_memory_state.mjs` 和 `node scripts/test_chat_agent.mjs`。
- [ ] 预期 RED：脚本尚未加载、app cache bust 未更新、页面 helper/hook 不存在、退出登录未清理。

### 3.2 加载模块并初始化页面状态

- [ ] 在 `public/index.html` 中把模块放在 `auth.js` 之前，并同步更新 auth cache bust：

```html
<script src="./tier2_recommendation_rules.js?v=20260626-tier2pub1"></script>
<script src="./agent_memory_state.js?v=20260826-agent-memory1"></script>
<script async src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="./auth.js?v=20260826-agent-memory1"></script>
```

- [ ] 在 `public/auth.js` 更新：

```js
const APP_SCRIPT = "./app.js?v=20260826-agent-memory1";
```

- [ ] 在 `public/app.js` 初始化状态时使用模块容错加载：

```js
const agentMemoryApi = window.AGENT_MEMORY_STATE || null;

agentPage: {
  history: [],
  memory: agentMemoryApi ? agentMemoryApi.load(localStorage) : null,
  submitting: false,
  abortController: null
}
```

### 3.3 提交状态并进入现有 planning/synthesis 通道

- [ ] 新增页面辅助函数：

```js
function agentPageMemoryText(language) {
  return agentMemoryApi
    ? agentMemoryApi.toPromptText(state.agentPage.memory, language === "en" ? "en" : "zh")
    : "";
}

function commitAgentPageMemory(events) {
  if (!agentMemoryApi || !Array.isArray(events) || !events.length) return;
  var next = agentMemoryApi.applyEvents(state.agentPage.memory, events, Date.now());
  if (!agentMemoryApi.save(localStorage, next, Date.now())) return;
  state.agentPage.memory = next;
}
```

- [ ] `handleAgentPageSubmit()` 调用 `runChatAgent()` 时替换空记忆：

```js
memoryText: agentPageMemoryText(language),
```

- [ ] `runChatAgent()` 返回后、处理 `directContent/fullResponse` 前只在成功 outcome 提交：

```js
if (outcome && outcome.handled && outcome.ok === true) {
  commitAgentPageMemory(outcome.memoryEvents);
}
```

- [ ] fallback 的普通 `streamAssistantReply()` 不生成新工具状态；成功时仍只更新文本历史。
- [ ] 在 hooks 中公开 `agentPageMemoryText`、`commitAgentPageMemory`、`agentPageWelcomeHtml`、`resetAgentPageConversation`，以及只读测试 getter：

```js
getAgentPageMemoryForTest: function () {
  return state.agentPage.memory;
}
```

### 3.4 恢复提示、语言切换和清理

- [ ] `agentPageWelcomeHtml()` 从 `toDisplayText()` 生成可见提示，并使用 `role="status"`：

```js
var restored = agentMemoryApi
  ? agentMemoryApi.toDisplayText(state.agentPage.memory, state.language === "en" ? "en" : "zh")
  : "";
var restoredHtml = restored
  ? '<p class="agent-page-memory-status" role="status">' + escapeHtml(restored) + '</p>'
  : "";
```

- [ ] 把 `restoredHtml` 放在欢迎说明和示例按钮之间；没有记忆时 DOM 与当前欢迎页保持一致。
- [ ] `init()` 在事件绑定前调用 `renderAgentPageWelcomeIfIdle()`；仅当聊天区还没有消息时重绘欢迎区。
- [ ] `rerenderForLanguage()` 的 Agent 分支在没有消息时调用同一个函数，使恢复提示随语言切换。
- [ ] `resetAgentPageConversation()` 同时清理内存和 storage：

```js
state.agentPage.history = [];
state.agentPage.memory = agentMemoryApi ? agentMemoryApi.empty(Date.now()) : null;
if (agentMemoryApi) agentMemoryApi.clear(localStorage);
```

- [ ] `public/auth.js` 在 reload 前清理；即使 logout API 失败也执行：

```js
try {
  if (window.AGENT_MEMORY_STATE) window.AGENT_MEMORY_STATE.clear(localStorage);
} catch (_memoryError) {
  localStorage.removeItem("oi_agent_memory_v1");
}
window.location.reload();
```

- [ ] 为提示增加小范围样式，不改 Agent 布局：

```css
.agent-page-memory-status {
  margin-top: 10px;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

body.dashboard-mode .dashboard-agent-page .agent-page-memory-status {
  max-width: 720px;
  color: rgba(226, 232, 240, 0.72);
}
```

### 3.5 验证并提交

- [ ] 运行 `node --check public/agent_memory_state.js`。
- [ ] 运行 `node --check public/auth.js`。
- [ ] 运行 `node --check public/app.js`。
- [ ] 运行 `node scripts/test_agent_memory_state.mjs`。
- [ ] 运行 `node scripts/test_chat_agent.mjs`。
- [ ] 运行 `node scripts/test_dashboard_chat_pages.mjs`。
- [ ] 运行 `node scripts/test_agent_stop_button.mjs`。
- [ ] 运行 `node scripts/test_agent_question_logging.mjs`。
- [ ] 运行 `git diff --check -- public/index.html public/auth.js public/app.js public/styles.css scripts/test_agent_memory_state.mjs scripts/test_chat_agent.mjs`。
- [ ] 提交：

```powershell
git add public/index.html public/auth.js public/app.js public/styles.css scripts/test_agent_memory_state.mjs scripts/test_chat_agent.mjs
git commit -m "Persist Agent context across refreshes / 持久化 Agent 刷新上下文"
```

---

## Task 4：接入 CI，并同步权威文档（已完成）

**Files:**

- Modify: `.github/workflows/ci.yml:73-82`
- Modify: `docs/chat-agent-optimization-roadmap.md:275-287,387-394`
- Modify: `docs/chatbot-feature-report.md` 的 Agent 架构、请求上下文和测试索引章节

### 4.1 先写失败检查

- [ ] 在 `scripts/test_agent_memory_state.mjs` 增加 CI 合同：

```js
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
assertTruthy(ci.includes("node scripts/test_agent_memory_state.mjs"), "CI should run Agent memory tests");
```

- [ ] 运行 `node scripts/test_agent_memory_state.mjs`。
- [ ] 预期 RED：`.github/workflows/ci.yml` 尚未调用新测试。

### 4.2 更新 CI

- [ ] 在现有 Agent Node 测试附近加入：

```yaml
          node scripts/test_agent_memory_state.mjs
          node scripts/test_chat_agent.mjs
          node scripts/test_agent_trace.mjs
```

- [ ] 不新增 npm 依赖，不新增浏览器驱动，不改变 CI 的 Python/Node 版本。

### 4.3 更新路线图

- [ ] 在 4.5 下加入实现状态，准确区分首期和长期项：

```markdown
> 首期实现状态（2026-08-26）：Agent 已在浏览器端保存一个版本化的结构化活动上下文，刷新后可恢复当前实体、查询范围、最近工具来源和候选决策；“新对话”和退出登录会清理。完整问答正文、工具明细和指标值不进入本地存储，当前数值追问仍会重新执行数据工具。

本期不包含会话列表、完整 transcript 恢复、分享和跨设备同步；这些仍属于长期项。
```

- [ ] 把 Phase 3 的“结构化多轮记忆”标记为首期完成；“会话保存、恢复和删除”只能标记为部分完成，明确当前仅有单活动上下文和清除能力。

### 4.4 更新 Chatbot 权威文档

- [ ] 在 `docs/chatbot-feature-report.md` 增加“Agent 结构化对话记忆”小节，至少记录：
  - `public/agent_memory_state.js` 的职责与 storage key；
  - `public/app.js` 的工具结果投影、成功提交时机和 `memoryText` 复用路径；
  - schema v1 字段、7 天有效期和上限；
  - 不保存 Prompt、回答、完整工具 JSON 和指标值；
  - 刷新恢复、新对话清除、退出登录清除；
  - 数值追问继续调用工具，不把旧摘要视为实时数据；
  - 首期不支持会话列表、分享和跨设备同步。
- [ ] 更新文件索引和测试命令，加入 `public/agent_memory_state.js` 与 `scripts/test_agent_memory_state.mjs`。
- [ ] 不修改 Report Mode 的 `reportSnapshot`/记忆栏合同，不把 Agent 结构化状态描述成 Report/Chat Mode 共享持久化。

### 4.5 验证并提交

- [ ] 运行 `node scripts/test_agent_memory_state.mjs`，预期通过 CI 合同。
- [ ] 运行 `rg -n "agent_memory_state|oi_agent_memory_v1|结构化对话记忆" docs public scripts .github/workflows/ci.yml`，核对代码、测试、CI 和文档四处一致。
- [ ] 运行 `git diff --check -- .github/workflows/ci.yml docs/chat-agent-optimization-roadmap.md docs/chatbot-feature-report.md scripts/test_agent_memory_state.mjs`。
- [ ] 提交：

```powershell
git add .github/workflows/ci.yml docs/chat-agent-optimization-roadmap.md docs/chatbot-feature-report.md scripts/test_agent_memory_state.mjs
git commit -m "Document and test Agent memory / 记录并测试 Agent 记忆"
```

---

## Task 5：完整回归、浏览器验收和交付审计（自动化完成；浏览器验收阻塞）

**Files:**

- Verify only; unless a test exposes a defect, do not broaden the implementation scope.

### 5.1 自动化回归

- [ ] 运行语法检查：

```powershell
node --check public/agent_memory_state.js
node --check public/auth.js
node --check public/app.js
```

- [ ] 运行 Agent 前端回归：

```powershell
node scripts/test_agent_memory_state.mjs
node scripts/test_chat_agent.mjs
node scripts/test_agent_trace.mjs
node scripts/test_agent_execution_timeline.mjs
node scripts/test_agent_question_logging.mjs
node scripts/test_agent_stop_button.mjs
node scripts/test_agent_welcome_logo.mjs
node scripts/test_agent_chat_input_glow.mjs
node scripts/test_dashboard_chat_pages.mjs
```

- [ ] 运行 Agent 后端兼容回归，证明本次没有破坏现有 HTTP/Provider/Trace 合同：

```powershell
python scripts/test_llm_agent.py
python scripts/test_agent_http.py
python scripts/test_chat_stream_agent_config.py
python scripts/test_agent_trace.py
python scripts/test_agent_trace_http.py
python scripts/test_llm_usage.py
python scripts/test_agent_config.py
```

- [ ] 任一测试失败时先使用 `systematic-debugging` 定位；只修复与本方案直接相关的问题，然后重跑失败测试及其相邻回归。

### 5.2 使用 browser-act 做真实刷新验收

- [ ] 启动 `python server.py`，记录启动前 8765 端口状态。
- [ ] 调用 `$browser-act` skill，使用可用的已认证浏览器会话打开 `http://127.0.0.1:8765/`；不得改用 Playwright。
- [ ] 在 Agent 页面查询一个能唯一解析的商户及两个指标，确认回答完成后 `localStorage.oi_agent_memory_v1`：
  - 有 `version=1`；
  - 有标准商户 ID/名称、指标键和 `lastTool` 来源；
  - 不含原问题、回答正文、指标值对象和工具明细行。
- [ ] 刷新页面，确认欢迎区出现“已恢复上下文”；提问“那它最近 6 个月的 EPC 趋势呢？”，确认规划调用的是同一商户的 trend 工具，而不是猜测实体或直接复述旧数据。
- [ ] 制造一次多候选商户结果，随后选择其中一个；确认 `pending -> confirmed/rejected` 转移符合预期。
- [ ] 点击“新对话”，刷新页面，确认恢复提示和 storage 都已清除。
- [ ] 再生成一次上下文后退出登录，确认 reload 前后 storage 均已清除。
- [ ] 如果本地环境无法完成认证或真实工具请求，明确记录“自动化通过、浏览器验收受认证/数据条件阻塞”，不得宣称已完成浏览器验证。
- [ ] 结束后按项目要求关闭 `http://127.0.0.1:8765/`，重新检查端口无 LISTEN 进程。

### 5.3 最终安全与范围审计

- [ ] 搜索持久化调用，确认只有结构化模块写入该 key：

```powershell
rg -n -F "oi_agent_memory_v1" public scripts docs .github/workflows/ci.yml
rg -n "localStorage\.(setItem|removeItem)|AGENT_MEMORY_STATE\.(save|clear)" public/agent_memory_state.js public/app.js public/auth.js
```

- [ ] 检查 memory event 与 schema，不得出现 `prompt`、`answer`、`fullResponse`、`messages`、`toolResult`、`rows`、异常堆栈字段。
- [ ] 检查 `git status --short`，确认无关的缓存文件和既有 Agent Trace 方案未进入提交。
- [ ] 检查每个提交的 `git show --stat --oneline HEAD`，确认双语提交、文件边界和任务一致。
- [ ] 运行 `git diff --check`，预期无输出。

### 5.4 验收标准

- [ ] 页面刷新后，Agent 能恢复当前活动商户的标准 ID/名称、品类、Tier、时间范围和指标键。
- [ ] “它/这个商户/该品类/同一 Tier”等后续提问能利用结构化上下文生成正确工具参数。
- [ ] 当前数值追问仍执行工具，不把旧摘要当作实时数据。
- [ ] 最近工具摘要明确保留来源、快照时间、估算和部分执行状态。
- [ ] 候选实体可从待确认转为已确认/已拒绝，且不会通过模糊名称偷偷猜选。
- [ ] 失败和中止不覆盖上一份有效状态；storage 异常不影响回答。
- [ ] 新对话和退出登录清理状态；普通刷新保留状态；7 天后自动失效。
- [ ] 本地存储中没有完整 Prompt、回答正文、完整工具 JSON、指标值对象、付款明细或异常堆栈。
- [ ] 无数据库、后端 API、Report Mode 或 Chat Mode 记忆栏合同变化。

---

## 实施完成后的交付选择

1. **Subagent-Driven（推荐）：** 在当前会话中按 Task 1–5 分任务实施，每个任务完成后复核测试、diff 和提交边界。
2. **Inline Execution（已选择并执行）：** 在当前会话中由单一执行者顺序完成全部任务；Task 2、Task 3 已通过检查，最终浏览器验收因环境能力不可用而保留阻塞记录。
