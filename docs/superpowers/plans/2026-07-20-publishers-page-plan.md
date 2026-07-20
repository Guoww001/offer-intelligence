# Publishers（媒介）页面 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 Publishers 页面，展示按媒介 × 市场聚合的 Amazon 订单性能数据（KPI 指标卡 + 横向柱状图 + 数据表格）

**Architecture:** 构建脚本从 MySQL 聚合数据 → JSON 缓存文件 → API 读取缓存 → 前端 JS 渲染全页面（客户端筛选）

**Tech Stack:** Python 3 (PyMySQL), vanilla JS SPA, CSS variables

## Global Constraints

- 缓存文件路径: `protected_data/db_publishers_cache.json`
- 市场解析: 从 `cnpscy_advert.advert_url_real` 解析 Amazon 域名
- 毛利 = `allCommission - affCommission`（即 `payout - aff_payout`）
- 遵循现有的 `offers_payload()` / `product_keywords_payload()` 缓存模式
- 前端页面遵循现有 Dashboard/Payment 页面模式（`switchPage` + `els` + i18n）
- i18n key 命名: `nav.publishers`, `publishers.*`
- All historical data（不分时间范围）

---
### Task 1: 构建脚本 — `scripts/build_publishers_data.py`

**Files:**
- Create: `scripts/build_publishers_data.py`

**Interfaces:**
- Consumes: `cnpscy_amazon_order`, `cnpscy_user`, `cnpscy_admins`, `cnpscy_advert` (MySQL)
- Produces: `protected_data/db_publishers_cache.json`

- [ ] **Step 1: 创建脚本骨架**

`scripts/build_publishers_data.py`:

```python
#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from offer_db import db_connection, fetch_all, utc_now_iso

AMAZON_DOMAIN_MAP = {
    "www.amazon.com": "amazon.com",
    "www.amazon.co.uk": "amazon.co.uk",
    "www.amazon.de": "amazon.de",
    "www.amazon.fr": "amazon.fr",
    "www.amazon.ca": "amazon.ca",
    "www.amazon.it": "amazon.it",
    "www.amazon.es": "amazon.es",
    "www.amazon.com.mx": "amazon.com.mx",
    "www.amazon.nl": "amazon.nl",
}

AMAZON_DOMAIN_PATTERNS = [
    (f"%{domain}%", code) for domain, code in AMAZON_DOMAIN_MAP.items()
]

CACHE_FILE = ROOT / "protected_data" / "db_publishers_cache.json"


def extract_market(advert_url: str | None) -> str:
    if not advert_url:
        return "Unknown"
    for domain, code in AMAZON_DOMAIN_MAP.items():
        if domain in advert_url:
            return code
    return "Unknown"


def build_publishers_payload() -> dict:
    with db_connection() as conn:
        # 1) 查询所有有 publisher 的订单数据，JOIN advert 获取URL
        rows = fetch_all(
            conn,
            """
            SELECT
              o.user_id,
              o.clicks,
              o.detail_page_views AS dpv,
              o.add_to_carts AS atc,
              o.total_purchases AS orders,
              o.amount AS sales,
              o.payout AS all_commission,
              o.aff_payout AS aff_commission,
              a.advert_url_real
            FROM cnpscy_amazon_order o
            LEFT JOIN cnpscy_advert a ON o.advert_id = a.advert_id
            WHERE o.user_id IS NOT NULL AND o.user_id > 0
            """
        )

        # 2) 获取所有用户和管理员映射
        admins_map = _load_admin_map(conn)

        # 3) 聚合数据: { userId -> { userName, adminName, markets: { market -> metrics }, total } }
        publishers: dict[int, dict] = {}
        summary = {
            "totalPublishers": 0,
            "totalClicks": 0, "totalDpv": 0, "totalAtc": 0, "totalOrders": 0,
            "totalSales": 0.0, "totalAllCommission": 0.0, "totalAffCommission": 0.0,
        }
        markets_set: set[str] = set()

        for row in rows:
            uid = int(row["user_id"])
            market = extract_market(row["advert_url_real"])
            markets_set.add(market)

            if uid not in publishers:
                publishers[uid] = {
                    "userId": uid,
                    "userName": str(uid),
                    "adminName": "Unknown",
                    "markets": {},
                    "total": {"clicks": 0, "dpv": 0, "atc": 0, "orders": 0,
                              "sales": 0.0, "allCommission": 0.0, "affCommission": 0.0},
                }

            pub = publishers[uid]
            _accumulate(pub["total"], row)
            if market not in pub["markets"]:
                pub["markets"][market] = {"clicks": 0, "dpv": 0, "atc": 0, "orders": 0,
                                          "sales": 0.0, "allCommission": 0.0, "affCommission": 0.0}
            _accumulate(pub["markets"][market], row)

        # 4) 填充用户名称和经理信息
        _fill_user_info(conn, publishers, admins_map)

        # 5) 计算 summary
        for pub in publishers.values():
            summary["totalClicks"] += pub["total"]["clicks"]
            summary["totalDpv"] += pub["total"]["dpv"]
            summary["totalAtc"] += pub["total"]["atc"]
            summary["totalOrders"] += pub["total"]["orders"]
            summary["totalSales"] += pub["total"]["sales"]
            summary["totalAllCommission"] += pub["total"]["allCommission"]
            summary["totalAffCommission"] += pub["total"]["affCommission"]
        summary["totalPublishers"] = len(publishers)

        payload = {
            "generatedAt": utc_now_iso(),
            "publishers": sorted(publishers.values(), key=lambda p: p["total"]["clicks"], reverse=True),
            "summary": summary,
            "markets": sorted(m for m in markets_set if m != "Unknown") + (["Unknown"] if "Unknown" in markets_set else []),
        }
        return payload


def _accumulate(target: dict, row: dict) -> None:
    target["clicks"] += int(row["clicks"] or 0)
    target["dpv"] += int(row["dpv"] or 0)
    target["atc"] += int(row["atc"] or 0)
    target["orders"] += int(row["orders"] or 0)
    target["sales"] += float(row["sales"] or 0)
    target["allCommission"] += float(row["all_commission"] or 0)
    target["affCommission"] += float(row["aff_commission"] or 0)


def _load_admin_map(conn) -> dict[str, str]:
    """admin_code -> admin_name"""
    rows = fetch_all(
        conn,
        "SELECT admin_code, admin_name FROM cnpscy_admins WHERE is_delete = 0 AND admin_code IS NOT NULL AND admin_code != ''"
    )
    return {str(r["admin_code"]).strip(): str(r["admin_name"]) for r in rows}


def _fill_user_info(conn, publishers: dict, admins_map: dict[str, str]) -> None:
    """批量查询用户名称和管理员"""
    uids = list(publishers.keys())
    if not uids:
        return
    placeholders = ", ".join(["%s"] * len(uids))
    rows = fetch_all(
        conn,
        f"SELECT user_id, user_name, admin_id_look FROM cnpscy_user WHERE user_id IN ({placeholders})",
        tuple(uids),
    )
    for row in rows:
        uid = int(row["user_id"])
        if uid in publishers:
            publishers[uid]["userName"] = str(row["user_name"] or uid)
            admin_code = str(row["admin_id_look"] or "").strip()
            publishers[uid]["adminName"] = admins_map.get(admin_code, "Unknown")


def main():
    payload = build_publishers_payload()
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CACHE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
    tmp.replace(CACHE_FILE)
    print(f"OK: {CACHE_FILE} ({len(payload['publishers'])} publishers, {len(payload['markets'])} markets)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行构建脚本验证**

```bash
cd D:/Code/offer-intelligence-main && python scripts/build_publishers_data.py
```

预期输出：`OK: protected_data/db_publishers_cache.json (N publishers, M markets)`

验证缓存文件存在且 JSON 结构正确：
```bash
python -c "import json; d=json.load(open('protected_data/db_publishers_cache.json')); print(f'publishers={len(d[\"publishers\"])}, markets={d[\"markets\"]}, summary_clicks={d[\"summary\"][\"totalClicks\"]}')"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/build_publishers_data.py protected_data/db_publishers_cache.json
git commit -m "feat(publishers): add build script for publishers cache data"
```

---
### Task 2: 后端 API 端点

**Files:**
- Modify: `offer_db.py` (新增 `publishers_payload` 函数)
- Modify: `api/db/index.py` (新增路由)
- Modify: `server.py` (新增路由处理)

**Interfaces:**
- Consumes: `protected_data/db_publishers_cache.json` (from Task 1)
- Produces: `GET /api/ui/db/publishers` → JSON payload

- [ ] **Step 1: 在 `offer_db.py` 中新增 `publishers_payload()` 函数

在 `product_keywords_payload()` 函数附近（约 line 2131）添加：

```python
# ── publishers cache ──────────────────────────────────────────────────

PUBLISHERS_CACHE_FILE = CACHE_DIR / "db_publishers_cache.json"
PUBLISHERS_CACHE_TTL = int(os.environ.get("OFFER_DB_PUBLISHERS_CACHE_TTL", "3600"))  # 1 hour
_publishers_memory_cache: tuple[float, dict[str, Any]] | None = None


def publishers_payload(force_refresh: bool = False) -> dict[str, Any]:
    """从 db_publishers_cache.json 读取聚合的媒介数据。

    遵循 offers_payload 的缓存模式: 内存缓存 + 文件缓存 + TTL + 后台刷新。
    数据由 scripts/build_publishers_data.py 构建。
    """
    global _publishers_memory_cache
    now = time.time()

    if not force_refresh and _publishers_memory_cache is not None:
        ts, payload = _publishers_memory_cache
        if now - ts < PUBLISHERS_CACHE_TTL:
            return payload

    if not force_refresh:
        cached = _load_any_cache(PUBLISHERS_CACHE_FILE)
        if cached is not None:
            age = _cache_age(PUBLISHERS_CACHE_FILE)
            if age is not None and age < PUBLISHERS_CACHE_TTL:
                _publishers_memory_cache = (now, cached)
                return cached
            # Stale: return stale, trigger background refresh
            _publishers_memory_cache = (now, cached)
            if not _bg_refresh_running.get("publishers"):
                _bg_refresh_running["publishers"] = True

                def _refresh_publishers():
                    global _publishers_memory_cache
                    try:
                        cached_file = _load_any_cache(PUBLISHERS_CACHE_FILE)
                        if cached_file is not None:
                            _publishers_memory_cache = (time.time(), cached_file)
                    finally:
                        _bg_refresh_running["publishers"] = False

                threading.Thread(target=_refresh_publishers, daemon=True).start()
            return cached

    cached = _load_any_cache(PUBLISHERS_CACHE_FILE)
    if cached is None:
        return {"ok": False, "error": "Publishers cache not built yet. Run scripts/build_publishers_data.py first."}
    _publishers_memory_cache = (now, cached)
    return cached
```

在文件顶部的 `CACHE_DIR` 定义旁（约 line 1323）添加 `PUBLISHERS_CACHE_FILE` 常量。

在 `_bg_refresh_running` 和 `_offers_memory_cache` 区域（约 line 1331-1339）附近添加 `_publishers_memory_cache`。

- [ ] **Step 2: 在 `offer_db.py` 的 `__all__`/导入区域添加导出**

在文件末尾或顶部添加导出（如果已有 `__all__` 或有其他函数被导入的模式）：

```python
# 确保可以被 api/db/index.py 和 server.py 导入
# （不需要改动 __all__，直接 import 即可）
```

- [ ] **Step 3: 在 `api/db/index.py` 中新增路由**

导入处添加：
```python
from offer_db import (
    ...
    publishers_payload,    # 新增
    ...
)
```

在 `handle_ui_tier_sheet` 函数后面（约 line 149）添加：

```python
def handle_ui_publishers(target, query):
    try:
        send_json(target, 200, publishers_payload(
            force_refresh=first_query_value(query, "refresh").lower() in {"1", "true", "yes"}
        ))
    except Exception as error:
        send_db_error(target, error)
```

在 `app()` 函数的 `route` 判断中（约 line 162）添加 `"ui-publishers"`：

```python
    elif route in {"ui-keywords", "ui-offers", "ui-tier-sheet", "ui-tier-summary", "ui-publishers"}:
        if require_auth(target):
            if route == "ui-keywords":
                handle_ui_keywords(target)
            elif route == "ui-publishers":
                handle_ui_publishers(target, query)
            elif route == "ui-offers":
                handle_ui_offers(target, query)
            ...
```

- [ ] **Step 4: 在 `server.py` 中新增路由**

导入处添加：
```python
from offer_db import (
    ...
    publishers_payload,    # 新增
    ...
)
```

在 `handle_db_ui_api()` 方法中（约 line 983，在 `tier-summary` 之后）添加：

```python
            if parsed.path == "/api/ui/db/publishers":
                force = first_query_value(query, "refresh") == "1"
                self.send_json(200, publishers_payload(force_refresh=force))
                return
```

- [ ] **Step 5: 验证 API 端点**

```bash
cd D:/Code/offer-intelligence-main
python -c "
import json, sys
sys.path.insert(0, '.')
from offer_db import publishers_payload
data = publishers_payload()
print(f'OK: {len(data.get(\"publishers\", []))} publishers, {len(data.get(\"markets\", []))} markets')
print(f'Summary: {json.dumps(data.get(\"summary\", {}), ensure_ascii=False)}')
"
```

- [ ] **Step 6: Commit**

```bash
git add offer_db.py api/db/index.py server.py
git commit -m "feat(publishers): add API endpoint for publishers data"
```

---
### Task 3: HTML 结构 + 导航 + i18n

**Files:**
- Modify: `public/index.html` (导航 + 页面容器)
- Modify: `public/app.js` (els + switchPage + i18n)

- [ ] **Step 1: 在 `index.html` 中添加导航按钮**

在 Payments 导航按钮之后（约 line 79），Reports 折叠组之前：

```html
          <button class="page-nav-button" id="publishersNav" type="button">
            <span class="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
            </span>
            <span data-i18n="nav.publishers">Publishers</span>
          </button>
```

解释: 使用地球/网络 SVG 图标 (Material Design `public` icon)。

- [ ] **Step 2: 在 `index.html` 中添加 Publishers 页面容器**

在 payments 页面之后、sheet 页面之前（约 line 308）添加：

```html
        <section class="publishers-page hidden" id="publishersPage" aria-label="Publishers">
          <div class="publishers-header">
            <div>
              <h2 data-i18n="publishers.title">Publishers</h2>
              <p data-i18n="publishers.subtitle">Publisher performance aggregation by market</p>
            </div>
          </div>

          <!-- 筛选区 -->
          <section class="panel publishers-filters" aria-label="Publisher filters">
            <div class="publishers-filter-row">
              <label>
                <span data-i18n="label.Market">Market</span>
                <select id="publisherMarketFilter">
                  <option value="all">All markets</option>
                </select>
              </label>
              <label>
                <span data-i18n="publishers.search">Publisher</span>
                <input id="publisherSearch" type="search" placeholder="Publisher name or ID" data-i18n-placeholder="publishers.searchPlaceholder" />
              </label>
              <label>
                <span data-i18n="publishers.manager">Manager</span>
                <input id="publisherManagerSearch" type="search" placeholder="Manager name" data-i18n-placeholder="publishers.managerPlaceholder" />
              </label>
            </div>
            <div class="publishers-filter-actions">
              <button class="primary-button" id="publisherSearchBtn" type="button" data-i18n="action.search">Search</button>
              <button class="secondary-button" id="publisherResetBtn" type="button" data-i18n="action.reset">Reset</button>
            </div>
          </section>

          <!-- KPI 指标卡 -->
          <section class="publishers-kpi" id="publishersKpi" aria-label="Publisher KPI summary">
            <div class="publishers-kpi-row" id="publishersKpiRow"></div>
          </section>

          <!-- 横向柱状图 -->
          <section class="panel publishers-chart-panel" aria-label="Publisher clicks chart">
            <div class="panel-title">
              <h3 data-i18n="publishers.chartTitle">Clicks by Publisher</h3>
            </div>
            <div class="publishers-chart" id="publishersChart"></div>
          </section>

          <!-- 数据表格 -->
          <section class="panel table-panel publishers-table-panel" aria-label="Publisher data table">
            <div class="table-toolbar">
              <div>
                <h3 data-i18n="publishers.tableTitle">Publisher Records</h3>
                <p id="publishersTableCount"></p>
              </div>
            </div>
            <div class="table-wrap publishers-table-wrap">
              <table class="publishers-table">
                <thead id="publishersTableHead"></thead>
                <tbody id="publishersTableRows"></tbody>
              </table>
            </div>
          </section>
        </section>
```

- [ ] **Step 3: 在 `app.js` 中添加 i18n 翻译**

在 `translations.zh` 对象中（约 line 321）添加：
```javascript
"nav.publishers": "媒体",
"publishers.title": "媒体概览",
"publishers.subtitle": "按市场聚合的媒介表现数据",
"publishers.search": "媒介搜索",
"publishers.searchPlaceholder": "媒介名称或 ID",
"publishers.manager": "媒介经理",
"publishers.managerPlaceholder": "经理名称",
"publishers.chartTitle": "按点击量排名",
"publishers.tableTitle": "媒介数据",
```

在 `translations.en` 的对应位置（不需要——英文默认是 key 本身）

- [ ] **Step 4: 在 `app.js` 的 `els` 对象中添加新元素**

```javascript
    publishersNav: document.getElementById("publishersNav"),
    publishersPage: document.getElementById("publishersPage"),
    publisherMarketFilter: document.getElementById("publisherMarketFilter"),
    publisherSearch: document.getElementById("publisherSearch"),
    publisherManagerSearch: document.getElementById("publisherManagerSearch"),
    publisherSearchBtn: document.getElementById("publisherSearchBtn"),
    publisherResetBtn: document.getElementById("publisherResetBtn"),
    publishersKpiRow: document.getElementById("publishersKpiRow"),
    publishersChart: document.getElementById("publishersChart"),
    publishersTableHead: document.getElementById("publishersTableHead"),
    publishersTableRows: document.getElementById("publishersTableRows"),
    publishersTableCount: document.getElementById("publishersTableCount"),
```

- [ ] **Step 5: 在 `switchPage()` 中添加页面切换逻辑**

```javascript
    els.publishersPage.classList.toggle("hidden", page !== "publishers");
    els.publishersNav.classList.toggle("active", page === "publishers");
```

放在 payments 和 sheets 之间的切换逻辑中（约 line 10843）：

```javascript
    els.paymentsPage.classList.toggle("hidden", page !== "payments");
    els.publishersPage.classList.toggle("hidden", page !== "publishers");  // 新增
    els.sheetPage.classList.toggle("hidden", !isSheets);
```

和：

```javascript
    els.paymentsNav.classList.toggle("active", page === "payments");
    els.publishersNav.classList.toggle("active", page === "publishers");  // 新增
    els.sheetsNav.classList.toggle("active", isSheets || isCategory || isTier);
```

在 `init()` 中添加导航点击事件（约 line 10926）：

```javascript
    els.publishersNav.addEventListener("click", () => switchPage("publishers"));
```

并在 `switchPage("publishers")` 时调用渲染：

```javascript
    if (page === "publishers") {
      renderPublishersPage();
    }
```

在 `renderPaymentsPage()` 调用行（约 line 10864）附近添加：

```javascript
    if (page === "payments") {
      renderPaymentsPage();
      ...
    }
    if (page === "publishers") {          // 新增
      renderPublishersPage();             // 新增
    }                                     // 新增
```

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat(publishers): add HTML structure, navigation and i18n"
```

---
### Task 4: CSS 样式

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: 在 `public/styles.css` 末尾添加 Publishers 页面样式

```css
/* ── Publishers Page ───────────────────────────────────────────── */

.publishers-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  max-width: 1600px;
  margin: 0 auto;
  width: 100%;
}

.publishers-page.hidden {
  display: none;
}

.publishers-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.publishers-header h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.publishers-header p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 14px;
}

/* ── 筛选区 ── */

.publishers-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  padding: 16px;
}

.publishers-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  flex: 1;
}

.publishers-filter-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--muted);
}

.publishers-filter-row label select,
.publishers-filter-row label input {
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #fff;
  font-size: 14px;
  min-width: 140px;
}

.publishers-filter-row label input {
  min-width: 160px;
}

.publishers-filter-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding-bottom: 2px;
}

/* ── KPI 指标卡 ── */

.publishers-kpi {
  width: 100%;
}

.publishers-kpi-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.publishers-kpi-row .metric {
  flex: 1;
  min-width: 140px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: var(--shadow);
}

.publishers-kpi-row .metric span {
  font-size: 13px;
  color: var(--muted);
}

.publishers-kpi-row .metric strong {
  font-size: 20px;
  font-weight: 700;
  color: var(--ink);
}

/* ── 横向柱状图 ── */

.publishers-chart-panel {
  padding: 16px;
}

.publishers-chart-panel .panel-title h3 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}

.publishers-chart {
  width: 100%;
  overflow-x: auto;
}

.publishers-chart .chart-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 13px;
}

.publishers-chart .chart-bar-label {
  width: 160px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  color: var(--ink);
}

.publishers-chart .chart-bar-track {
  flex: 1;
  height: 24px;
  background: var(--line);
  border-radius: 4px;
  overflow: hidden;
  min-width: 60px;
}

.publishers-chart .chart-bar-fill {
  height: 100%;
  background: #66b3ff;
  border-radius: 4px;
  transition: width 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;
  font-size: 11px;
  color: #fff;
  font-weight: 600;
  min-width: fit-content;
}

.publishers-chart .chart-bar-value {
  width: 80px;
  text-align: left;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
  flex-shrink: 0;
}

/* ── 数据表格 ── */

.publishers-table-panel {
  padding: 0;
}

.publishers-table-wrap {
  overflow-x: auto;
}

.publishers-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.publishers-table th {
  position: sticky;
  top: 0;
  background: var(--panel);
  border-bottom: 2px solid var(--line);
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--muted);
}

.publishers-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.publishers-table tbody tr:hover {
  background: var(--blue-soft);
}

.publishers-table tbody tr.total-row {
  background: #f0f2f4;
  font-weight: 600;
}

.publishers-table tbody tr.total-row td {
  border-top: 2px solid var(--line);
}

/* ── 空状态 ── */

.publishers-empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--muted);
  font-size: 15px;
}

/* ── 加载状态 ── */

.publishers-loading {
  text-align: center;
  padding: 60px 20px;
  color: var(--muted);
  font-size: 15px;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/styles.css
git commit -m "feat(publishers): add CSS styles for publishers page"
```

---
### Task 5: 前端渲染函数

**Files:**
- Modify: `public/app.js` (新增 renderPublishersPage + 辅助函数)

**Interfaces:**
- Consumes: `GET /api/ui/db/publishers` → JSON payload (from Task 2)
- State: `state.publisherMarket`, `state.publisherSearch`, `state.publisherManagerSearch`

- [ ] **Step 1: 在 `app.js` 的 `state` 对象中添加状态**

```javascript
    publisherMarket: "all",
    publisherSearch: "",
    publisherManagerSearch: "",
```

- [ ] **Step 2: 添加数据加载函数 `loadPublishersData()`**

```javascript
  let _publishersCache = null;

  function loadPublishersData(forceRefresh) {
    if (_publishersCache && !forceRefresh) return Promise.resolve(_publishersCache);
    return fetch("/api/ui/db/publishers" + (forceRefresh ? "?refresh=1" : ""))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok === false) throw new Error(data.error || "Failed to load publishers data");
        _publishersCache = data;
        return data;
      });
  }
```

- [ ] **Step 3: 添加筛选函数 `getFilteredPublishers()`**

```javascript
  function getFilteredPublishers(data) {
    if (!data || !data.publishers) return [];
    var market = state.publisherMarket || "all";
    var search = (state.publisherSearch || "").toLowerCase().trim();
    var manager = (state.publisherManagerSearch || "").toLowerCase().trim();

    return data.publishers.filter(function (pub) {
      // 市场筛选
      if (market !== "all" && !pub.markets[market]) return false;
      // 媒介搜索
      if (search) {
        var name = (pub.userName || "").toLowerCase();
        var id = String(pub.userId);
        if (name.indexOf(search) === -1 && id.indexOf(search) === -1) return false;
      }
      // 经理搜索
      if (manager) {
        var adminName = (pub.adminName || "").toLowerCase();
        if (adminName.indexOf(manager) === -1) return false;
      }
      return true;
    });
  }
```

- [ ] **Step 4: 注: 聚合函数 `aggregatePublisherMetrics()`**

```javascript
  function aggregatePublisherMetrics(filteredPubs, market) {
    var agg = { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 };
    filteredPubs.forEach(function (pub) {
      var m = market && market !== "all" ? pub.markets[market] : pub.total;
      if (!m) return;
      agg.clicks += m.clicks;
      agg.dpv += m.dpv;
      agg.atc += m.atc;
      agg.orders += m.orders;
      agg.sales += m.sales;
      agg.allCommission += m.allCommission;
      agg.affCommission += m.affCommission;
    });
    agg.grossProfit = agg.allCommission - agg.affCommission;
    agg.conversionRate = agg.clicks > 0 ? agg.orders / agg.clicks : 0;
    return agg;
  }
```

- [ ] **Step 5: 注: 渲染 KPI 指标卡 `renderPublishersKpi()`**

```javascript
  function renderPublishersKpi(agg) {
    var cards = [
      ["Clicks", number(agg.clicks)],
      ["DPV", number(agg.dpv)],
      ["ATC", number(agg.atc)],
      ["Orders", number(agg.orders)],
      ["Sales", money(agg.sales)],
      ["Commission", money(agg.allCommission)]
    ];
    els.publishersKpiRow.innerHTML = cards.map(function (c) {
      return '<div class="metric"><span>' + escapeHtml(c[0]) + '</span><strong>' + escapeHtml(c[1]) + '</strong></div>';
    }).join("");
  }
```

- [ ] **Step 6: 注: 渲染柱状图 `renderPublishersChart()`**

```javascript
  function renderPublishersChart(filteredPubs, market) {
    var topN = filteredPubs.slice(0, 15);
    var maxClicks = topN.length > 0 ? topN[0].total.clicks : 1;
    var html = "";
    topN.forEach(function (pub) {
      var m = market && market !== "all" ? pub.markets[market] : pub.total;
      var clicks = m ? m.clicks : 0;
      var pct = Math.max(2, (clicks / maxClicks) * 100);
      html += '<div class="chart-bar-row">' +
        '<span class="chart-bar-label" title="' + escapeHtml(pub.userName) + '">' + escapeHtml(pub.userName) + '</span>' +
        '<div class="chart-bar-track"><div class="chart-bar-fill" style="width:' + pct.toFixed(1) + '%">' +
          (pct > 15 ? number(clicks) : '') +
        '</div></div>' +
        '<span class="chart-bar-value">' + number(clicks) + '</span>' +
      '</div>';
    });
    if (!html) html = '<div class="publishers-empty">' + escapeHtml(t("publishers.empty", "No data")) + '</div>';
    els.publishersChart.innerHTML = html;
  }
```

- [ ] **Step 7: 主渲染函数 `renderPublishersPage()`**

```javascript
  function renderPublishersPage() {
    els.publishersTableRows.innerHTML = '<tr><td colspan="13" class="publishers-loading">' +
      escapeHtml(t("publishers.loading", "Loading...")) + '</td></tr>';

    loadPublishersData().then(function (data) {
      // 填充市场下拉
      fillSelect(els.publisherMarketFilter, data.markets || [], state.publisherMarket);

      var filtered = getFilteredPublishers(data);
      var market = state.publisherMarket || "all";
      var agg = aggregatePublisherMetrics(filtered, market);

      // KPI
      renderPublishersKpi(agg);

      // 柱状图（按当前市场排序）
      renderPublishersChart(filtered, market);

      // 表格
      renderPublishersTable(filtered, market, agg);
    }).catch(function (err) {
      els.publishersTableRows.innerHTML = '<tr><td colspan="13" class="publishers-empty">' +
        escapeHtml(t("publishers.error", "Error: ") + err.message) + '</td></tr>';
    });
  }
```

- [ ] **Step 8: 注: 表格渲染 `renderPublishersTable()`**

```javascript
  var PUBLISHER_TABLE_COLUMNS = [
    { key: "rank", label: "#", render: function(r) { return String(r.rank); } },
    { key: "userId", label: "Publisher ID", render: function(r) { return String(r.userId); } },
    { key: "userName", label: "Publisher Name", render: function(r) { return escapeHtml(r.userName); } },
    { key: "adminName", label: "Manager", render: function(r) { return escapeHtml(r.adminName || "Unknown"); } },
    { key: "clicks", label: "Clicks", render: function(r) { return number(r.clicks); } },
    { key: "conversionRate", label: "CVR", render: function(r) { return pct(r.conversionRate); } },
    { key: "dpv", label: "DPV", render: function(r) { return number(r.dpv); } },
    { key: "atc", label: "ATC", render: function(r) { return number(r.atc); } },
    { key: "orders", label: "Orders", render: function(r) { return number(r.orders); } },
    { key: "sales", label: "Sales", render: function(r) { return money(r.sales); } },
    { key: "allCommission", label: "All Comm", render: function(r) { return money(r.allCommission); } },
    { key: "affCommission", label: "Aff Comm", render: function(r) { return money(r.affCommission); } },
    { key: "grossProfit", label: "Gross Profit", render: function(r) { return money(r.grossProfit); } },
  ];

  function renderPublishersTable(filteredPubs, market, totals) {
    // 表头
    els.publishersTableHead.innerHTML = "<tr>" + PUBLISHER_TABLE_COLUMNS.map(function (c) {
      return '<th>' + escapeHtml(c.label) + '</th>';
    }).join("") + "</tr>";

    // 预计算每行的指标
    var rows = filteredPubs.map(function (pub, idx) {
      var m = market && market !== "all" ? pub.markets[market] : pub.total;
      m = m || { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 };
      return {
        rank: idx + 1,
        userId: pub.userId,
        userName: pub.userName,
        adminName: pub.adminName || "Unknown",
        clicks: m.clicks,
        conversionRate: m.clicks > 0 ? m.orders / m.clicks : 0,
        dpv: m.dpv,
        atc: m.atc,
        orders: m.orders,
        sales: m.sales,
        allCommission: m.allCommission,
        affCommission: m.affCommission,
        grossProfit: m.allCommission - m.affCommission,
      };
    });

    // 合计行
    var totalRow = {
      rank: "",
      userId: "",
      userName: "Total",
      adminName: "",
      clicks: totals.clicks,
      conversionRate: totals.conversionRate,
      dpv: totals.dpv,
      atc: totals.atc,
      orders: totals.orders,
      sales: totals.sales,
      allCommission: totals.allCommission,
      affCommission: totals.affCommission,
      grossProfit: totals.grossProfit,
    };

    els.publishersTableCount.textContent = "Total: " + filteredPubs.length.toLocaleString();

    var allRows = [totalRow].concat(rows);
    els.publishersTableRows.innerHTML = allRows.map(function (r, i) {
      var cls = i === 0 ? ' class="total-row"' : "";
      return "<tr" + cls + ">" + PUBLISHER_TABLE_COLUMNS.map(function (c) {
        return "<td>" + c.render(r) + "</td>";
      }).join("") + "</tr>";
    }).join("");
  }
```

- [ ] **Step 9: 注: 绑定筛选事件**

在 `init()` 函数的末尾（约 line 10950 附近）添加：

```javascript
    els.publisherMarketFilter.addEventListener("change", function () {
      state.publisherMarket = els.publisherMarketFilter.value;
      renderPublishersPage();
    });
    els.publisherSearch.addEventListener("input", function () {
      state.publisherSearch = els.publisherSearch.value;
      renderPublishersPage();
    });
    els.publisherManagerSearch.addEventListener("input", function () {
      state.publisherManagerSearch = els.publisherManagerSearch.value;
      renderPublishersPage();
    });
    els.publisherSearchBtn.addEventListener("click", function () {
      renderPublishersPage();
    });
    els.publisherResetBtn.addEventListener("click", function () {
      state.publisherMarket = "all";
      state.publisherSearch = "";
      state.publisherManagerSearch = "";
      els.publisherMarketFilter.value = "all";
      els.publisherSearch.value = "";
      els.publisherManagerSearch.value = "";
      renderPublishersPage();
    });
```

- [ ] **Step 10: 验证页面加载**

```bash
cd D:/Code/offer-intelligence-main
python server.py &
# 浏览器打开 http://127.0.0.1:8765
# 点击左侧 Publishers 导航按钮
# 验证: KPI 卡片显示、柱状图渲染、表格显示合计行和数据行
```

- [ ] **Step 11: Commit**

```bash
git add public/app.js
git commit -m "feat(publishers): add frontend rendering functions"
```

---
### Task 6: 集成到 CI 和构建流程

**Files:**
- Modify: `scripts/build_sheet_report_data.py` (或新增单独的构建命令)
- Modify: `CLAUDE.md` (添加构建命令说明)

- [ ] **Step 1: 更新 CLAUDE.md 中的构建命令**

```markdown
### Rebuild static data payloads
```bash
python scripts/build_sheet_report_data.py
ruby scripts/build_offer_chatbot_data.rb
python scripts/build_publishers_data.py
...
```
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add publishers build command to CLAUDE.md"
```

---
### Task 7: 端到端验证

- [ ] **Step 1: 运行完整构建流程**

```bash
cd D:/Code/offer-intelligence-main
python scripts/build_publishers_data.py
```

- [ ] **Step 2: 运行本地服务并检查**

```bash
python server.py
# 验证:
# 1. 左侧导航栏出现 "媒体" 按钮
# 2. 点击切换到 Publishers 页面
# 3. KPI 卡片显示正确数据
# 4. 柱状图渲染 Top 15 媒介
# 5. 表格显示合计行 + 数据行
# 6. 市场下拉筛选切换
# 7. 媒介名称搜索筛选
```

- [ ] **Step 3: 运行现有测试确保不破坏已有功能**

```bash
node --check public/auth.js
node --check public/app.js
python -m py_compile offer_db.py server.py api/db/index.py scripts/build_publishers_data.py
```

- [ ] **Step 4: 最终提交**

```bash
git add -A
git commit -m "feat(publishers): complete publishers page implementation"
```
