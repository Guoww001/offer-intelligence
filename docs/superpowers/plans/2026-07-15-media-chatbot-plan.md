# 媒体信息 Chatbot 查询功能 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Chatbot 中新增 `media` 意图，支持通过对话查询联属媒体伙伴（Publisher）的绩效信息、目标和属性数据。

**Architecture:** 复用现有的 LLM 意图分类 + DB 实时查询模式。后端在 `offer_db.py` 中新增 `media_payload()` 跨表聚合函数，内存缓存。前端新增 `MediaSkill` 供 LLM 识别媒体查询，新增 `mediaAnswer()` → `loadDbMediaInsight()` → `renderMediaStats()` 渲染链路。前端统一调用 `/api/db` + `X-Oi-Db-Route: ui-media` header，本地和 Vercel 均不新增 Vercel 函数文件。

**Tech Stack:** Python http.server / Vercel Serverless (WSGI), MySQL (PyMySQL), Vanilla JS IIFE (~8900 行 app.js)

## Global Constraints

- 不新增 Vercel 函数文件（`api/` 下不建新 `.py` 文件）
- 不修改数据库结构（复用现有 `cnpscy_user`、`cnpscy_order_new`、`cnpscy_amazon_click` 等表）
- 不在 `chatbot_data.js` 中构建媒体静态数据
- 不新增前端页面，完全通过 Chatbot 交互
- 前端统一调用 `/api/db` 端点，设置 `X-Oi-Db-Route: ui-media` 请求头
- "上月"指上一个完整日历月
- `media_id` 和 `media_name` 是 OR 关系，ID 优先

---

### Task 1: `offer_db.py` — 新增 media_payload() 函数

**Files:**
- Modify: `offer_db.py`（在现有的 `_merchant_cache` / `_search_cache` 附近添加）

**Interfaces:**
- Consumes: `db_connection()`, `table_columns()`, `pick_column()`, `fetch_all()`, `DIGITS_RE`, `utc_now_iso()` — 均已在 `offer_db.py` 中存在
- Produces: `media_payload(media_id: str = None, media_name: str = None) -> dict`

- [ ] **Step 1: 在 `offer_db.py` 中找到缓存变量定义区域，添加媒体缓存**

在 `_merchant_cache` 和 `_search_cache` 等变量附近添加：

```python
_media_cache: dict[str, tuple[float, dict[str, Any]]] = {}
MEDIA_CACHE_TTL = int(os.environ.get("OFFER_DB_MEDIA_CACHE_TTL", "3600"))  # 1 hour
```

在 `offer_db.py` 的 `_cache_age` 函数（约第 1117 行）之后、`offers_payload()` 之前找到搜索函数末尾的闭包位置。实际插入位置在 `search_payload()` 函数之后（约第 1097 行之后）、`CACHE_DIR` 常量定义之前（约第 1102 行之前）。

- [ ] **Step 2: 实现 `media_payload()` 函数**

在 `search_payload()` 之后、`# ── payload cache ──` 注释之前插入：

```python
def _last_month_key() -> str:
    """返回上一个完整日历月的 key，格式 YYYYMM（如 202606）。"""
    now = dt.datetime.now(dt.timezone.utc)
    year = now.year
    month = now.month - 1
    if month == 0:
        month = 12
        year -= 1
    return f"{year}{month:02d}"


def _current_month_key() -> str:
    """返回当前月的 key，格式 YYYYMM（如 202607）。"""
    now = dt.datetime.now(dt.timezone.utc)
    return f"{now.year}{now.month:02d}"


def _month_start_end_iso(year_month: str) -> tuple[str, str]:
    """根据 YYYYMM 返回该月的起始和结束 ISO 日期字符串。"""
    year = int(year_month[:4])
    month = int(year_month[4:6])
    start = f"{year}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1}-01-01"
    else:
        end = f"{year}-{month + 1:02d}-01"
    return start, end


def media_payload(media_id: str = None, media_name: str = None) -> dict[str, Any]:
    """查询媒体（Publisher）信息，跨表聚合绩效数据。

    参数 media_id 和 media_name 是 OR 关系，ID 优先。
    结果缓存到 _media_cache（TTL 默认 1 小时）。
    """
    if not media_id and not media_name:
        return {"ok": False, "error": "mediaId or mediaName is required"}

    cache_key = f"id:{media_id}" if media_id else f"name:{media_name}"
    now = time.time()
    cached = _media_cache.get(cache_key)
    if cached is not None and now - cached[0] < MEDIA_CACHE_TTL:
        return cached[1]

    with db_connection() as conn:
        # 1. 主查询 — cnpscy_user
        user_columns = table_columns(conn, "cnpscy_user")
        user_id_col = pick_column(user_columns, ["user_id"])
        user_name_col = pick_column(user_columns, ["user_name"])
        company_col = pick_column(user_columns, ["company_name"])
        pub_type_col = pick_column(user_columns, ["PublisherType"])
        state_col = pick_column(user_columns, ["user_state"])
        elite_col = pick_column(user_columns, ["is_elite"])

        if media_id and DIGITS_RE.match(str(media_id)):
            where_clause = f"u.{q(user_id_col)} = %s"
            params: list[Any] = [media_id]
        elif media_name:
            where_clause = f"u.{q(user_name_col)} LIKE %s"
            params = [f"%{media_name}%"]
        else:
            return {"ok": False, "error": "Invalid media lookup parameters"}

        user_rows = fetch_all(
            conn,
            f"SELECT u.{q(user_id_col)}, u.{q(user_name_col)}, "
            f"u.{q(company_col)}, u.{q(pub_type_col)}, "
            f"u.{q(state_col)}, u.{q(elite_col)} "
            f"FROM {q('cnpscy_user')} u WHERE {where_clause} LIMIT 1",
            tuple(params),
        )
        if not user_rows:
            return {"ok": False, "error": "Media not found"}

        uid = str(user_rows[0][0])
        user_name = str(user_rows[0][1] or "")
        company = str(user_rows[0][2] or "") if user_rows[0][2] else ""
        pub_type = str(user_rows[0][3] or "") if user_rows[0][3] else ""
        state_val = user_rows[0][4]
        elite_val = user_rows[0][5]

        # 2. 管理员关联 — 通过 cnpscy_advert_with_user 查找管理员
        admin_name = ""
        try:
            adv_columns = table_columns(conn, "cnpscy_advert_with_user")
            adv_admin_col = pick_column(adv_columns, ["with_admin_id"])
            adv_user_col = pick_column(adv_columns, ["user_id"])
            admin_rows = fetch_all(
                conn,
                f"SELECT DISTINCT w.{q(adv_admin_col)} "
                f"FROM {q('cnpscy_advert_with_user')} w "
                f"WHERE w.{q(adv_user_col)} = %s LIMIT 1",
                (uid,),
            )
            if admin_rows and admin_rows[0][0]:
                admin_id = str(admin_rows[0][0])
                adm_columns = table_columns(conn, "cnpscy_admins")
                adm_name_col = pick_column(adm_columns, ["admin_name"])
                adm_rows = fetch_all(
                    conn,
                    f"SELECT {q(adm_name_col)} FROM {q('cnpscy_admins')} "
                    f"WHERE admin_id = %s LIMIT 1",
                    (admin_id,),
                )
                if adm_rows:
                    admin_name = str(adm_rows[0][0] or "")
        except Exception:
            admin_name = ""

        # 3. 上月 AFF 佣金
        last_month = _last_month_key()
        last_month_commission = 0.0
        try:
            order_columns = table_columns(conn, "cnpscy_order_new")
            payout_col = pick_column(order_columns, ["aff_payout", "Payout", "payout"])
            mon_col = pick_column(order_columns, ["order_time_mon"])
            uid_col_ord = pick_column(order_columns, ["user_id"])
            comm_rows = fetch_all(
                conn,
                f"SELECT COALESCE(SUM({q(payout_col)}), 0) "
                f"FROM {q('cnpscy_order_new')} "
                f"WHERE {q(uid_col_ord)} = %s AND {q(mon_col)} = %s",
                (uid, int(last_month)),
            )
            if comm_rows:
                last_month_commission = float(comm_rows[0][0] or 0)
        except Exception:
            last_month_commission = 0.0

        # 4. 上月点击
        last_month_clicks = 0
        try:
            click_columns = table_columns(conn, "cnpscy_amazon_click")
            click_col = pick_column(click_columns, ["click"])
            uid_col_clk = pick_column(click_columns, ["user_id"])
            day_col = pick_column(click_columns, ["time_day"])
            start_iso, end_iso = _month_start_end_iso(last_month)
            click_rows = fetch_all(
                conn,
                f"SELECT COALESCE(SUM({q(click_col)}), 0) "
                f"FROM {q('cnpscy_amazon_click')} "
                f"WHERE {q(uid_col_clk)} = %s AND {q(day_col)} >= %s AND {q(day_col)} < %s",
                (uid, int(start_iso.replace("-", "")), int(end_iso.replace("-", ""))),
            )
            if click_rows:
                last_month_clicks = int(click_rows[0][0] or 0)
        except Exception:
            last_month_clicks = 0

        # 5. 月目标
        monthly_target = 0.0
        try:
            target_columns = table_columns(conn, "cnpscy_advert_month_payout_target")
            tgt_col = pick_column(target_columns, ["payout_target"])
            uid_col_tgt = pick_column(target_columns, ["user_id"])
            ym_col = pick_column(target_columns, ["year_month"])
            current_month = _current_month_key()
            tgt_rows = fetch_all(
                conn,
                f"SELECT COALESCE(SUM({q(tgt_col)}), 0) "
                f"FROM {q('cnpscy_advert_month_payout_target')} "
                f"WHERE {q(uid_col_tgt)} = %s AND {q(ym_col)} = %s",
                (uid, int(current_month)),
            )
            if tgt_rows:
                monthly_target = float(tgt_rows[0][0] or 0)
        except Exception:
            monthly_target = 0.0

        # 月目标完成 = 本月已发生的佣金（简化：使用上月佣金作为当前预估）
        # 更精确的做法是查当前月的 order_new
        monthly_achieved = 0.0
        try:
            current_month = _current_month_key()
            ach_rows = fetch_all(
                conn,
                f"SELECT COALESCE(SUM({q(payout_col)}), 0) "
                f"FROM {q('cnpscy_order_new')} "
                f"WHERE {q(uid_col_ord)} = %s AND {q(mon_col)} = %s",
                (uid, int(current_month)),
            )
            if ach_rows:
                monthly_achieved = float(ach_rows[0][0] or 0)
        except Exception:
            monthly_achieved = 0.0

        # 6. 违规记录
        violation_records: list[dict] = []
        try:
            viol_columns = table_columns(conn, "cnpscy_violation_log")
            uid_col_viol = pick_column(viol_columns, ["user_id"])
            note_col = pick_column(viol_columns, ["note"])
            created_col = pick_column(viol_columns, ["created_at"])
            viol_rows = fetch_all(
                conn,
                f"SELECT {q(note_col)}, {q(created_col)} "
                f"FROM {q('cnpscy_violation_log')} "
                f"WHERE {q(uid_col_viol)} = %s ORDER BY {q(created_col)} DESC LIMIT 10",
                (uid,),
            )
            for r in viol_rows:
                violation_records.append({
                    "note": str(r[0] or ""),
                    "createdAt": str(r[1] or ""),
                })
        except Exception:
            violation_records = []

        # 7. 媒体备注
        notes: list[dict] = []
        try:
            note_columns = table_columns(conn, "cnpscy_user_note")
            uid_col_note = pick_column(note_columns, ["user_id"])
            note_text_col = pick_column(note_columns, ["note"])
            note_created_col = pick_column(note_columns, ["created_at"])
            note_rows = fetch_all(
                conn,
                f"SELECT {q(note_text_col)}, {q(note_created_col)} "
                f"FROM {q('cnpscy_user_note')} "
                f"WHERE {q(uid_col_note)} = %s ORDER BY {q(note_created_col)} DESC LIMIT 5",
                (uid,),
            )
            for r in note_rows:
                notes.append({
                    "note": str(r[0] or ""),
                    "createdAt": str(r[1] or ""),
                })
        except Exception:
            notes = []

        # 8. Offer 偏好（媒体推广的 Offer 列表）
        offers: list[dict] = []
        try:
            adv_main_columns = table_columns(conn, "cnpscy_advert")
            mcuser_col = pick_column(adv_main_columns, ["advert_mcuserid"])
            adv_id_col = pick_column(adv_main_columns, ["advert_id"])
            adv_name_col = pick_column(adv_main_columns, ["advert_name"])
            adv_status_col = pick_column(adv_main_columns, ["advert_status"])
            adv_del_col = pick_column(adv_main_columns, ["advert_isdel"])
            offer_rows = fetch_all(
                conn,
                f"SELECT {q(adv_id_col)}, {q(adv_name_col)}, {q(adv_status_col)} "
                f"FROM {q('cnpscy_advert')} a "
                f"WHERE a.{q(mcuser_col)} = %s AND a.{q(adv_del_col)} = 0 "
                f"ORDER BY a.{q(adv_id_col)} ASC LIMIT 50",
                (uid,),
            )
            for r in offer_rows:
                offers.append({
                    "advertId": int(r[0]) if r[0] else 0,
                    "advertName": str(r[1] or ""),
                    "status": int(r[2]) if r[2] else 0,
                })
        except Exception:
            offers = []

        completion_rate = round((monthly_achieved / monthly_target * 100) if monthly_target > 0 else 0, 1)

        payload = {
            "ok": True,
            "checkedAt": utc_now_iso(),
            "mediaId": int(uid),
            "mediaName": user_name,
            "companyName": company,
            "publisherType": pub_type,
            "state": state_val,
            "isElite": bool(elite_val),
            "managerName": admin_name,
            "lastMonthCommission": round(last_month_commission, 2),
            "lastMonthClicks": last_month_clicks,
            "monthlyTarget": round(monthly_target, 2),
            "monthlyAchieved": round(monthly_achieved, 2),
            "completionRate": completion_rate,
            "offers": offers,
            "violationRecords": violation_records,
            "notes": notes,
        }

    _media_cache[cache_key] = (time.time(), payload)
    return payload
```

- [ ] **Step 3: 更新 `offer_db.py` 的导入（如果缺少 `table_columns` / `pick_column` 等）**

确认文件顶部以下导入都已存在：
```python
from typing import Any
import time
import os
```

如果 `table_columns` 或 `pick_column` 未在模块作用域中，从 `offer_db.py` 内部确认其定义位置。这些函数通常在文件顶部或中部定义。

- [ ] **Step 4: 验证 Python 编译**

Run: `python -m py_compile offer_db.py`
Expected: 无错误退出

- [ ] **Step 5: 提交**

```bash
git add offer_db.py
git commit -m "feat: add media_payload() for affiliate publisher queries"
```

---

### Task 2: `server.py` — 新增本地 `/api/db` 路由

**Files:**
- Modify: `server.py`（在 `do_GET()` 路由块中添加）

**Interfaces:**
- Consumes: `media_payload`（来自 Task 1），`first_query_value`、`parse_qs`（已在 `server.py` 中使用）
- Produces: 处理 `X-Oi-Db-Route: ui-media` 请求头的路由逻辑

- [ ] **Step 1: 在 `server.py` 的 `do_GET()` 中添加 `/api/db` 路由**

在 `do_GET()` 方法中，找到现有路由（约第 802 行 `/api/ui/db/` 的处理），在其后添加：

```python
        if parsed.path == "/api/db":
            if not require_auth(self):
                return
            db_route = self.headers.get("X-Oi-Db-Route", "").strip()
            query = parse_qs(parsed.query)
            if db_route == "ui-media":
                media_id = first_query_value(query, "mediaId")
                media_name = first_query_value(query, "mediaName")
                try:
                    self.send_json(200, media_payload(media_id=media_id, media_name=media_name))
                except ValueError as error:
                    self.send_json(400, {"ok": False, "error": str(error)})
                except Exception as error:
                    self.send_db_error(error)
                return
            self.send_json(404, {"ok": False, "error": "Unknown DB route"})
            return
```

插入位置：在 `if parsed.path.startswith("/api/ui/db/"):` 块之后（约第 806 行）、`if parsed.path == "/api/tier_moves":` 之前（约第 807 行）。

同时确认 `server.py` 顶部已导入 `media_payload`：
```python
from offer_db import (
    ...,
    media_payload,  # 添加到现有 import 列表
)
```

- [ ] **Step 2: 验证 Python 编译**

Run: `python -m py_compile server.py`
Expected: 无错误退出

- [ ] **Step 3: 提交**

```bash
git add server.py
git commit -m "feat: add /api/db route with ui-media support in server.py"
```

---

### Task 3: `api/db/index.py` — 新增 Vercel 路由

**Files:**
- Modify: `api/db/index.py`

**Interfaces:**
- Consumes: `media_payload`（Task 1），`require_auth`、`first_query_value`、`send_json`、`send_db_error`（已在 index.py 中使用）
- Produces: `handle_ui_media()` 函数 + `"ui-media"` 路由注册

- [ ] **Step 1: 在 `api/db/index.py` 中添加 `handle_ui_media()` 函数**

在 `handle_ui_tier_sheet()` 之后（约第 136 行之前）添加：

```python
def handle_ui_media(target, query):
    media_id = first_query_value(query, "mediaId")
    media_name = first_query_value(query, "mediaName")
    if not media_id and not media_name:
        send_json(target, 400, {"ok": False, "error": "mediaId or mediaName is required"})
        return
    try:
        send_json(target, 200, media_payload(media_id=media_id, media_name=media_name))
    except ValueError as error:
        send_json(target, 400, {"ok": False, "error": str(error)})
    except Exception as error:
        send_db_error(target, error)
```

- [ ] **Step 2: 在路由调度中添加 `"ui-media"` 分支**

在 `app()` 函数中（约第 148 行），在 `elif route in {"ui-keywords", "ui-offers", "ui-tier-sheet"}:` 块内添加 `"ui-media"` 路由：

```python
    elif route in {"ui-keywords", "ui-offers", "ui-tier-sheet", "ui-media"}:
        if require_auth(target):
            if route == "ui-keywords":
                handle_ui_keywords(target)
            elif route == "ui-offers":
                handle_ui_offers(target, query)
            elif route == "ui-tier-sheet":
                handle_ui_tier_sheet(target, query)
            elif route == "ui-media":
                handle_ui_media(target, query)
```

- [ ] **Step 3: 添加 `media_payload` 导入**

在文件顶部的 `from offer_db import (...)` 中添加 `media_payload`：

```python
from offer_db import (
    ...,
    media_payload,
)
```

- [ ] **Step 4: 验证 Python 编译**

Run: `python -m py_compile api/db/index.py`
Expected: 无错误退出

- [ ] **Step 5: 提交**

```bash
git add api/db/index.py
git commit -m "feat: add ui-media route to Vercel DB API"
```

---

### Task 4: `skills/media.py` — 新增 MediaSkill（LLM 意图分类）

**Files:**
- Create: `skills/media.py`
- Modify: `skills/__init__.py`

**Interfaces:**
- Consumes: `IntentSkill`、`ParamDef`、`ExamplePair`（来自 `skills.base`）
- Produces: `media_skill` 实例（被 `skills/__init__.py` 注册到 `registry`）

- [ ] **Step 1: 创建 `skills/media.py`**

```python
"""Media intent skill — detects affiliate media/publisher lookups."""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef


class MediaSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "media"

    def prompt_intent_section(self) -> str:
        return (
            "- media: The query asks about an affiliate media/publisher by name or "
            "numeric media ID. This includes queries like '查媒体Ofelia', "
            "'看看56号媒体的数据', 'media ofelia', 'publisher 56'.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "mediaName": ParamDef(
                type="str",
                description="The media/publisher name, e.g. ofelia, link",
            ),
            "mediaId": ParamDef(
                type="str",
                description="A numeric media/publisher ID, e.g. 56",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="查媒体Ofelia",
                output={"intent": "media", "params": {"mediaName": "ofelia"}},
            ),
            ExamplePair(
                query="media 56",
                output={"intent": "media", "params": {"mediaId": "56"}},
            ),
            ExamplePair(
                query="看看媒体的数据",
                output={"intent": "media", "params": {}},
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["media", "publisher", "affiliate"],
            "zh": ["媒体", "媒介", "推广渠道"],
        }


media_skill = MediaSkill()
```

- [ ] **Step 2: 在 `skills/__init__.py` 中注册**

在文件末尾添加：

```python
from skills.media import media_skill
registry.register(media_skill)
```

- [ ] **Step 3: 验证 Python 编译**

Run: `python -m py_compile skills/media.py && python -m py_compile skills/__init__.py`
Expected: 无错误退出

- [ ] **Step 4: 提交**

```bash
git add skills/media.py skills/__init__.py
git commit -m "feat: add MediaSkill for LLM intent classification"
```

---

### Task 5: `public/app.js` — 前端 Chatbot 集成

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `state.llmParams`（现有状态）, `addMessage()`（现有函数）, `escapeHtml()`（现有函数）, `statCards()`（现有函数）, `miniTable()`（现有函数）, `responseLanguageFor()`（现有函数）, `chatCopy()`（现有函数）
- Produces: `mediaAnswer()`, `loadDbMediaInsight()`, `renderMediaStats()` — 仅在 `answerPrompt()` 中调用，不导出

- [ ] **Step 1: 在 app.js 起始常量区添加媒体相关常量和缓存**

在 `const DB_MERCHANT_UI_API` 附近（约第 61 行）添加：

```javascript
const DB_MEDIA_API = "/api/db";
const dbMediaCache = new Map();
const dbMediaLoading = new Set();
```

在 `dbMerchantCache`（第 66 行）和 `dbMerchantLoading`（第 67 行）之后添加。

- [ ] **Step 2: 在 `detectQueryIntent()` 中添加正则兜底判断**

在 `detectQueryIntent()` 函数中（约第 4011 行），在 `payment` 正则判断之后、`hasStrongMerchantLookup` 之前添加：

```javascript
    if (/media|publisher|媒体|媒介/.test(lower)) return "media";
```

- [ ] **Step 3: 在 `answerPrompt()` 中添加 `media` 意图路由**

在 `answerPrompt()` 函数中，在 `intent === "payment"` 处理块（约第 5625 行）之后、`wantsRecommendation` 处理块（约第 5629 行）之前添加：

```javascript
    if (intent === "media") {
        const mediaId = p.mediaId || null;
        const mediaName = p.mediaName || null;
        return mediaAnswer(prompt, mediaId, mediaName);
    }
```

- [ ] **Step 4: 添加 `mediaAnswer()` 函数**

在现有 `paymentAnswer()` 函数之后（或在 `loadDbMerchantInsight()` 之前，约第 5758 行之前）添加：

```javascript
function mediaAnswer(prompt, mediaId, mediaName) {
    const language = responseLanguageFor(prompt);
    const copy = chatCopy(language);
    const loadingMsg = language === "zh" ? "正在查询媒体信息..." : "Querying media info...";
    addMessage("assistant", `<em>${escapeHtml(loadingMsg)}</em>`);
    // Trigger async load
    setTimeout(function() { loadDbMediaInsight(mediaId, mediaName, language); }, 0);
    return "";
}
```

- [ ] **Step 5: 添加 `loadDbMediaInsight()` 函数**

在 `mediaAnswer()` 之后、`dbLookupSkipPrompt()` 之前添加：

```javascript
async function loadDbMediaInsight(mediaId, mediaName, language) {
    if (typeof fetch !== "function") return;
    const cacheKey = mediaId || mediaName;
    if (!cacheKey || dbMediaLoading.has(cacheKey)) return;
    if (dbMediaCache.has(cacheKey)) {
        const cached = renderMediaStats(dbMediaCache.get(cacheKey), language);
        if (cached) {
            removeLastAssistantIfLoading();
            addMessage("assistant", cached);
        }
        return;
    }
    dbMediaLoading.add(cacheKey);
    try {
        const params = new URLSearchParams();
        if (mediaId) params.set("mediaId", mediaId);
        else if (mediaName) params.set("mediaName", mediaName);
        const response = await fetch(`${DB_MEDIA_API}?${params.toString()}`, {
            headers: { "X-Oi-Db-Route": "ui-media" },
            cache: "no-store"
        });
        let payload = null;
        try { payload = await response.json(); } catch (e) { payload = null; }
        if (!response.ok || (payload && payload.ok === false)) {
            throw new Error((payload && payload.error) || "HTTP " + response.status);
        }
        dbMediaCache.set(cacheKey, payload);
        const html = renderMediaStats(payload, language);
        if (html) {
            removeLastAssistantIfLoading();
            addMessage("assistant", html);
        }
    } catch (error) {
        removeLastAssistantIfLoading();
        const errMsg = (language === "zh"
            ? "媒体信息查询失败: "
            : "Media info query failed: ") + escapeHtml(error.message || "");
        addMessage("assistant", `<section class="db-chat-card db-chat-card-muted"><p>${errMsg}</p></section>`);
    } finally {
        dbMediaLoading.delete(cacheKey);
    }
}

function removeLastAssistantIfLoading() {
    var chat = document.getElementById("chat-messages");
    if (!chat) return;
    var last = chat.lastElementChild;
    if (last && last.classList.contains("assistant")) {
        var text = (last.textContent || "").trim().toLowerCase();
        if (text === "正在查询媒体信息..." || text === "querying media info..." || text === "") {
            last.remove();
        }
    }
}
```

- [ ] **Step 6: 添加 `renderMediaStats()` 函数**

在 `loadDbMediaInsight()` 之后添加：

```javascript
function renderMediaStats(payload, language) {
    if (!payload || payload.ok === false) {
        return (language === "zh"
            ? "<section class=\"db-chat-card db-chat-card-muted\"><p>未找到该媒体信息</p></section>"
            : "<section class=\"db-chat-card db-chat-card-muted\"><p>Media not found</p></section>");
    }
    var m = payload;
    var zh = language === "zh";
    var header = zh
        ? "<strong>📊 媒体信息:</strong> " + escapeHtml(m.mediaName || "") + " (ID: " + escapeHtml(String(m.mediaId || "")) + ")"
        : "<strong>📊 Media:</strong> " + escapeHtml(m.mediaName || "") + " (ID: " + escapeHtml(String(m.mediaId || "")) + ")";

    var completionText = m.completionRate != null ? m.completionRate + "%" : (zh ? "暂无数据" : "N/A");
    var targetText = m.monthlyTarget ? "$" + number(m.monthlyTarget).toLocaleString() : (zh ? "未设置" : "Not set");
    var achievedText = m.monthlyAchieved ? "$" + number(m.monthlyAchieved).toLocaleString() : "$0";

    var cardsHtml = statCards([
        [zh ? "上月AFF佣金" : "Last mo. commission", m.lastMonthCommission != null ? "$" + number(m.lastMonthCommission).toLocaleString() : "$0"],
        [zh ? "上月点击" : "Last mo. clicks", m.lastMonthClicks != null ? number(m.lastMonthClicks).toLocaleString() : "0"],
        [zh ? "月目标" : "Monthly target", targetText],
        [zh ? "月完成" : "Monthly achieved", achievedText],
        [zh ? "完成率" : "Completion rate", completionText],
    ]);

    var detailsHtml = "<div class=\"context-note\">";
    if (m.managerName) {
        detailsHtml += "<strong>" + (zh ? "媒介经理: " : "Manager: ") + "</strong>" + escapeHtml(m.managerName) + "<br>";
    }
    if (m.companyName) {
        detailsHtml += "<strong>" + (zh ? "公司: " : "Company: ") + "</strong>" + escapeHtml(m.companyName) + "<br>";
    }
    if (m.publisherType) {
        detailsHtml += "<strong>" + (zh ? "类型: " : "Type: ") + "</strong>" + escapeHtml(m.publisherType) + "<br>";
    }
    if (m.offers && m.offers.length) {
        detailsHtml += "<strong>" + (zh ? "Offer偏好 (" : "Offers (") + m.offers.length + "):</strong> ";
        detailsHtml += m.offers.slice(0, 10).map(function(o) { return escapeHtml(o.advertName); }).join(", ");
        if (m.offers.length > 10) detailsHtml += " ...";
        detailsHtml += "<br>";
    }
    if (m.violationRecords && m.violationRecords.length) {
        detailsHtml += "<strong style=\"color:#d32f2f;\">" + (zh ? "违规记录 (" : "Violations (") + m.violationRecords.length + "):</strong><br>";
        detailsHtml += m.violationRecords.slice(0, 3).map(function(v) {
            return "&nbsp;&nbsp;• " + escapeHtml(v.note || "") + " <small>(" + escapeHtml(v.createdAt || "") + ")</small>";
        }).join("<br>");
        if (m.violationRecords.length > 3) detailsHtml += "<br>&nbsp;&nbsp;...";
        detailsHtml += "<br>";
    }
    if (m.notes && m.notes.length) {
        detailsHtml += "<strong>" + (zh ? "备注: " : "Notes: ") + "</strong>";
        detailsHtml += m.notes.slice(0, 2).map(function(n) {
            return escapeHtml(n.note || "");
        }).join(" | ");
        if (m.notes.length > 2) detailsHtml += " ...";
        detailsHtml += "<br>";
    }
    detailsHtml += "</div>";

    var offerTable = "";
    if (m.offers && m.offers.length) {
        var statusLabels = zh ? {1: "推广中", 2: "暂停", 3: "推广中"} : {1: "Active", 2: "Paused", 3: "Active"};
        offerTable = "<p><strong>" + (zh ? "推广的 Offer:" : "Promoted Offers:") + "</strong></p>"
            + miniTable(m.offers.slice(0, 20), [
                { label: zh ? "Offer" : "Offer", render: function(o) { return escapeHtml(o.advertName || ""); } },
                { label: "ID", render: function(o) { return String(o.advertId || ""); } },
                { label: zh ? "状态" : "Status", render: function(o) { return statusLabels[o.status] || String(o.status); } }
            ]);
    } else {
        offerTable = "<p><small>" + (zh ? "暂无推广的 Offer" : "No promoted offers") + "</small></p>";
    }

    return "<section class=\"db-chat-card\">" + header + cardsHtml + detailsHtml + offerTable + "</section>";
}
```

- [ ] **Step 7: 验证 JS 语法**

Run: `node --check public/app.js`
Expected: 无错误退出（可能只有 `SHEET_REPORT_DATA` 未定义的 warning，忽略）

- [ ] **Step 8: 提交**

```bash
git add public/app.js
git commit -m "feat: add media chatbot query frontend (mediaAnswer, loadDbMediaInsight, renderMediaStats)"
```

---

### Task 6: i18n 文案补充

**Files:**
- Modify: `public/chatbot_i18n.js`

- [ ] **Step 1: 在 `public/chatbot_i18n.js` 中添加媒体相关文案（可选）**

`renderMediaStats()` 已经在代码中直接使用中文字符串并通过 `zh` 变量判断，因此 i18n 对象可以不新增字段。但如果希望复用 i18n 机制，可以在 `CHATBOT_I18N` 对象中对应的语言区块添加，例如在 `zh` 区块（约第 65 行附近）添加：

```javascript
    media: {
        title: "媒体信息",
        notFound: "未找到该媒体信息",
        loading: "正在查询媒体信息...",
    },
```

在 `en` 区块（约第 105 行附近）添加：

```javascript
    media: {
        title: "Media Info",
        notFound: "Media not found",
        loading: "Querying media info...",
    },
```

- [ ] **Step 2: 验证 JS 语法**

Run: `node --check public/chatbot_i18n.js`
Expected: 无错误退出

- [ ] **Step 3: 提交**

```bash
git add public/chatbot_i18n.js
git commit -m "feat: add media i18n strings"
```

---

### Task 7: 端到端验证

**Files:**
- 运行已有测试套件

- [ ] **Step 1: 运行所有 Python 编译检查**

Run:
```bash
python -m py_compile offer_db.py
python -m py_compile server.py
python -m py_compile api/db/index.py
python -m py_compile skills/media.py
python -m py_compile skills/__init__.py
```
Expected: 全部无错误退出

- [ ] **Step 2: 运行 JS 检查**

Run:
```bash
node --check public/app.js
node --check public/chatbot_i18n.js
```
Expected: 全部无错误退出

- [ ] **Step 3: 运行现有测试**

Run: `node scripts/test_zh_chatbot.mjs`
Expected: 全部 pass（现有测试不受影响）

- [ ] **Step 4: 手动启动本地服务器进行快速验证**

```bash
python server.py
```
Expected: 服务器启动无报错

在浏览器中打开 `http://127.0.0.1:8765`，登录后在 Chatbot 中输入"查媒体ofelia"，验证：
1. Chatbot 显示加载状态
2. 返回媒体信息卡片（含佣金、点击、目标等）
3. 出错时显示降级提示

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "feat: media chatbot query - end-to-end integration"
```
