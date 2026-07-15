# Task 1: `offer_db.py` — 新增 media_payload() 函数

## 任务描述

在 `offer_db.py` 中新增 `media_payload()` 函数，用于跨表聚合联属媒体（Affiliate Publisher）的信息。

## 文件

- Modify: `offer_db.py`

在现有的 `_merchant_cache` / `_search_cache` 附近添加缓存变量。
在 `search_payload()` 函数之后、`# ── payload cache ──` 注释之前插入 `media_payload()` 函数。

## 接口

- 签名: `def media_payload(media_id: str = None, media_name: str = None) -> dict[str, Any]`
- 参数 `media_id` 和 `media_name` 是 OR 关系，ID 优先
- 返回 `dict`，格式见下面的 "返回结构"

## 需要添加的缓存变量

```python
_media_cache: dict[str, tuple[float, dict[str, Any]]] = {}
MEDIA_CACHE_TTL = int(os.environ.get("OFFER_DB_MEDIA_CACHE_TTL", "3600"))  # 1 hour
```

## 辅助函数

需要添加 3 个辅助函数（放在 `media_payload` 之前）：

### `_last_month_key()` → str
返回上一个完整日历月的 key，格式 YYYYMM（如 202606）。

### `_current_month_key()` → str  
返回当前月的 key，格式 YYYYMM（如 202607）。

### `_month_start_end_iso(year_month: str)` → tuple[str, str]
根据 YYYYMM 返回该月的起始和结束 ISO 日期字符串。

## 查询逻辑

### 1. 主查询 — `cnpscy_user`
- 按 `user_id` 精确匹配（如果提供了 `media_id`）或按 `user_name LIKE` 模糊匹配
- 获取字段：`user_id`, `user_name`, `company_name`, `PublisherType`, `user_state`, `is_elite`

### 2. 管理员关联（媒介经理）
- 通过 `cnpscy_advert_with_user` 的 `with_admin_id` 找到 `admin_id`
- 再查 `cnpscy_admins` 的 `admin_name`

### 3. 上月 AFF 佣金
- `cnpscy_order_new`，按 `user_id` + `order_time_mon = 上月` 聚合 `aff_payout` 的 SUM

### 4. 上月点击
- `cnpscy_amazon_click`，按 `user_id` + `time_day` 在月范围内聚合 `click` 的 SUM

### 5. 月目标
- `cnpscy_advert_month_payout_target`，按 `user_id` + `year_month = 当前月` 取 `payout_target` 的 SUM

### 6. 月目标完成
- `cnpscy_order_new`，按 `user_id` + `order_time_mon = 当前月` 聚合 `aff_payout` 的 SUM

### 7. 违规记录
- `cnpscy_violation_log`，按 `user_id` 查 `note` 和 `created_at`，取最近 10 条

### 8. 媒体备注
- `cnpscy_user_note`，按 `user_id` 查 `note` 和 `created_at`，取最近 5 条

### 9. Offer 偏好（媒体推广的 Offer 列表）
- `cnpscy_advert`，按 `advert_mcuserid` 匹配 + `advert_isdel = 0`，取 `advert_id`, `advert_name`, `advert_status`

## 返回结构

```json
{
    "ok": true,
    "checkedAt": "2026-07-15T...",
    "mediaId": 56,
    "mediaName": "ofelia",
    "companyName": "...",
    "publisherType": "...",
    "state": 1,
    "isElite": false,
    "managerName": "媒介经理名",
    "lastMonthCommission": 1234.56,
    "lastMonthClicks": 50000,
    "monthlyTarget": 5000.00,
    "monthlyAchieved": 3500.00,
    "completionRate": 70.0,
    "offers": [{"advertId": 111240, "advertName": "Macy's", "status": 3}, ...],
    "violationRecords": [{"note": "...", "createdAt": "..."}, ...],
    "notes": [{"note": "...", "createdAt": "..."}, ...]
}
```

## 缓存模式

- 内存缓存，key = `f"id:{media_id}"` 或 `f"name:{media_name}"`
- TTL 默认 1 小时，可通过环境变量 `OFFER_DB_MEDIA_CACHE_TTL` 配置
- 缓存过期后同步重建

## 需要使用的现有函数

- `db_connection()` — 获取数据库连接
- `table_columns(conn, table_name)` — 动态获取表列信息
- `pick_column(columns, aliases)` — 模糊匹配列名
- `fetch_all(conn, sql, params)` — 执行查询并返回所有行
- `q(name)` — 引用标识符（表名/列名）
- `DIGITS_RE` — 数字正则
- `utc_now_iso()` — 返回当前 UTC ISO 字符串
- `time.time()` — 用于缓存过期检查

所有 `table_columns` / `pick_column` / `q` / `fetch_all` 函数已在 `offer_db.py` 中定义并可在模块级别直接使用。

## 验证

```bash
python -m py_compile offer_db.py
# 无错误退出
```
