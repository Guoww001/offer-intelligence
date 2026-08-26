(function (root) {
  "use strict";

  var STORAGE_KEY = "oi_agent_memory_v1";
  var VERSION = 1;
  var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  var MAX_SERIALIZED_CHARS = 12000;
  var SOURCE_VALUES = ["cache", "database", "mixed", "unknown"];

  function nowValue(nowMs) {
    return Number.isFinite(nowMs) ? nowMs : Date.now();
  }

  function clip(value, max) {
    return String(value === null || value === undefined ? "" : value).trim().slice(0, max);
  }

  function validMonth(value) {
    var text = clip(value, 7);
    return /^20\d{2}-(0[1-9]|1[0-2])$/.test(text) ? text : null;
  }

  function uniqueStrings(values, limit, maxChars) {
    var seen = Object.create(null);
    var output = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var text = clip(value, maxChars);
      var key = text.toLowerCase();
      if (!text || seen[key] || output.length >= limit) return;
      seen[key] = true;
      output.push(text);
    });
    return output;
  }

  function normalizeEntity(value) {
    value = value && typeof value === "object" ? value : {};
    var rawType = clip(value.type, 16);
    var type = ["merchant", "category", "tier"].indexOf(rawType) >= 0 ? rawType : "merchant";
    var id = clip(value.id, 80);
    var name = clip(value.name, 120);
    return name || id ? { type: type, id: id, name: name || id } : null;
  }

  function entityKey(value) {
    return value.type + ":" + String(value.id || value.name).toLowerCase();
  }

  function uniqueEntities(values, limit) {
    var seen = Object.create(null);
    var output = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var normalized = normalizeEntity(value);
      if (!normalized) return;
      var key = entityKey(normalized);
      if (seen[key] || output.length >= limit) return;
      seen[key] = true;
      output.push(normalized);
    });
    return output;
  }

  function empty(nowMs) {
    return {
      version: VERSION,
      updatedAt: new Date(nowValue(nowMs)).toISOString(),
      focus: { merchants: [], categories: [], tiers: [] },
      query: { startMonth: null, endMonth: null, months: null, metrics: [] },
      lastTool: null,
      candidates: { pending: [], confirmed: [], rejected: [] }
    };
  }

  function normalizeQuery(value) {
    value = value && typeof value === "object" ? value : {};
    var numericMonths = Number(value.months);
    return {
      startMonth: validMonth(value.startMonth),
      endMonth: validMonth(value.endMonth),
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
    if (SOURCE_VALUES.indexOf(source) < 0) source = "unknown";
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

  function normalize(value, nowMs) {
    var source = value && typeof value === "object" ? value : {};
    var focus = source.focus && typeof source.focus === "object" ? source.focus : {};
    var candidates = source.candidates && typeof source.candidates === "object"
      ? source.candidates : {};
    var updatedAt = Date.parse(source.updatedAt);
    return {
      version: VERSION,
      updatedAt: Number.isFinite(updatedAt)
        ? new Date(updatedAt).toISOString()
        : new Date(nowValue(nowMs)).toISOString(),
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
      var lastTool = normalizeLastTool(event.lastTool);
      if (lastTool) next.lastTool = lastTool;

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

    next.updatedAt = new Date(nowValue(nowMs)).toISOString();
    return normalize(next, nowMs);
  }

  function clear(storage) {
    try {
      storage.removeItem(STORAGE_KEY);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function load(storage, nowMs) {
    var now = nowValue(nowMs);
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return empty(now);
      raw = String(raw);
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
    var now = nowValue(nowMs);
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

  function merchantText(value) {
    return value.name + (value.id ? " (ID " + value.id + ")" : "");
  }

  function candidateText(value) {
    return value.name + (value.id ? " (ID " + value.id + ")" : "");
  }

  function periodText(query, english) {
    if (query.startMonth && query.endMonth) {
      return query.startMonth === query.endMonth
        ? query.startMonth : query.startMonth + "–" + query.endMonth;
    }
    return query.startMonth || query.endMonth
      || (query.months ? String(query.months) + (english ? " months" : " 个月") : "");
  }

  function toPromptText(value, language) {
    var state = normalize(value);
    if (!hasMeaningfulContext(state)) return "";
    var english = language === "en";
    var lines = [english ? "[Agent structured memory]" : "[Agent 结构化记忆]"];
    if (state.focus.merchants.length) {
      lines.push((english ? "Active merchants: " : "当前商户：")
        + state.focus.merchants.map(merchantText).join(english ? ", " : "、"));
    }
    if (state.focus.categories.length) {
      lines.push((english ? "Active categories: " : "当前品类：")
        + state.focus.categories.join(english ? ", " : "、"));
    }
    if (state.focus.tiers.length) {
      lines.push((english ? "Active tiers: " : "当前 Tier：")
        + state.focus.tiers.join(english ? ", " : "、"));
    }
    var period = periodText(state.query, english);
    if (period) lines.push((english ? "Period: " : "时间范围：") + period);
    if (state.query.metrics.length) {
      lines.push((english ? "Metrics: " : "指标：")
        + state.query.metrics.join(english ? ", " : "、"));
    }
    if (state.lastTool) {
      lines.push((english ? "Last tool: " : "最近工具：") + [
        state.lastTool.toolName,
        state.lastTool.headline,
        state.lastTool.dataSource,
        state.lastTool.dataAsOf,
        state.lastTool.estimated ? (english ? "estimated" : "估算") : "",
        state.lastTool.partial ? (english ? "partial" : "部分执行") : ""
      ].filter(Boolean).join(" | "));
    }
    [
      ["pending", english ? "Pending candidates: " : "待确认候选："],
      ["confirmed", english ? "Confirmed candidates: " : "已确认候选："],
      ["rejected", english ? "Rejected candidates: " : "已拒绝候选："]
    ].forEach(function (item) {
      var candidates = state.candidates[item[0]];
      if (candidates.length) lines.push(item[1] + candidates.map(candidateText).join(english ? ", " : "、"));
    });
    lines.push(english
      ? "Use this context only to resolve references and carry query scope. Always run a data tool for current numeric values."
      : "这些上下文只用于消解指代和延续查询范围；涉及当前数值时必须重新调用数据工具。");
    return lines.join("\n");
  }

  function toDisplayText(value, language) {
    var state = normalize(value);
    if (!hasMeaningfulContext(state)) return "";
    var english = language === "en";
    var parts = [];
    if (state.focus.merchants.length) parts.push(state.focus.merchants.map(merchantText).join(english ? ", " : "、"));
    if (state.focus.categories.length) parts.push(state.focus.categories.join(english ? ", " : "、"));
    if (state.focus.tiers.length) parts.push(state.focus.tiers.join(english ? ", " : "、"));
    var period = periodText(state.query, english);
    if (period) parts.push(period);
    if (state.query.metrics.length) parts.push(state.query.metrics.join(" / "));
    if (!parts.length && state.candidates.pending.length) {
      parts.push((english ? "pending candidates: " : "待确认候选：")
        + state.candidates.pending.map(candidateText).join(english ? ", " : "、"));
    }
    var prefix = english ? "Restored context: " : "已恢复上下文：";
    return (prefix + parts.join(" · ")).slice(0, 360);
  }

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
