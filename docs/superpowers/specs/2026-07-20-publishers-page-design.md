# Publishers（媒介）页面 — 设计方案

## 概述

在现有 Dashboard / Payment / Reports 之外新增一个 Publishers（媒介/发布商）页面，展示按媒介 × 市场聚合的 Amazon 订单性能数据。

## 数据源

### 数据库表

| 表 | 作用 |
|------|------|
| `cnpscy_amazon_order` | 主数据源 — 订单级指标（user_id, clicks, dpv, atc, amount, payout, aff_payout） |
| `cnpscy_user` | 媒介信息（user_id, user_name, admin_id_look → admin_code） |
| `cnpscy_admins` | 媒介经理/负责人（通过 admin_code 关联） |
| `cnpscy_advert` | 广告商 — 解析 `advert_url_real` 提取 Amazon 域名作为 market |

### 市场映射

从 `cnpscy_advert.advert_url_real` 中解析 Amazon 域名：

```
www.amazon.com  → amazon.com
www.amazon.co.uk → amazon.co.uk
www.amazon.de   → amazon.de
www.amazon.fr   → amazon.fr
www.amazon.ca   → amazon.ca
www.amazon.it   → amazon.it
www.amazon.es   → amazon.es
www.amazon.com.mx → amazon.com.mx
www.amazon.nl   → amazon.nl
```

无 URL 或域名不匹配的记录标记为 `"Unknown"`。

## 缓存文件

`protected_data/db_publishers_cache.json`

### JSON 结构

```json
{
  "generatedAt": "2026-07-20T10:00:00Z",
  "publishers": [
    {
      "userId": 25,
      "userName": "shaoxiaoming",
      "adminName": "liwei",
      "markets": {
        "amazon.com": {
          "clicks": 20000,
          "dpv": 15000,
          "atc": 2000,
          "orders": 5000,
          "sales": 150000.00,
          "allCommission": 25000.00,
          "affCommission": 18000.00
        }
      },
      "total": {
        "clicks": 25000,
        "dpv": 18000,
        "atc": 2500,
        "orders": 6000,
        "sales": 180000.00,
        "allCommission": 30000.00,
        "affCommission": 22000.00
      }
    }
  ],
  "summary": {
    "totalPublishers": 388,
    "totalClicks": 1222336,
    "totalDpv": 900000,
    "totalAtc": 100000,
    "totalOrders": 500000,
    "totalSales": 6479629.20,
    "totalAllCommission": 1000000.00,
    "totalAffCommission": 750000.00,
    "markets": ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.ca", "amazon.it", "amazon.es", "amazon.com.mx", "amazon.nl", "Unknown"]
  }
}
```

### 毛利计算

`grossProfit = allCommission - affCommission` (即 `payout - aff_payout`)

## 修改的文件

### 新增文件

| 文件 | 说明 |
|------|------|
| `scripts/build_publishers_data.py` | 构建脚本 — 查询 DB → 生成缓存 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `offer_db.py` | 新增 `publishers_payload()` 函数（读缓存 + 内存缓存模式） |
| `api/db/index.py` | 新增 `/api/ui/db/publishers` 路由 |
| `server.py` | 在 `handle_db_ui_api()` 中新增路由处理 |
| `public/index.html` | 新增导航按钮（位于 Payments 下方）+ `<section class="publishers-page">` |
| `public/app.js` | 新增页面切换逻辑 + 渲染函数 |
| `public/styles.css` | 新增 Publishers 页面样式 |

## 页面布局

### 筛选区（Filter Bar）

```
[日期范围: 2026-07-01 ~ 2026-07-20] [市场 ▼] [联盟 ▼] [链接类型 ▼]
[商家搜索] [商品搜索] [媒介搜索] [站点搜索] [track搜索]
[🔄 搜索] [⟳ 重置] [⬇ 导出]
```

### KPI 指标卡

```
┌─────────┬──────────┬────────┬────────┬──────────┬────────────┐
│ Clicks  │   DPV    │  ATC   │ Orders │  Sales   │ Commission │
│ 434,125 │ 300,377  │ 17,656 │ 8,296  │$761,177  │ $113,941   │
└─────────┴──────────┴────────┴────────┴──────────┴────────────┘
```

### 横向柱状图

按点击量排名的 Top N 媒介条形图。

### 数据表格

| # | 媒介ID | 媒介名称 | 负责人 | 点击 | 转化率 | DPV | ATC | 订单数 | 销售额 | ALL佣金 | AFF佣金 | 毛利 |
|---|--------|---------|-------|------|-------|-----|-----|-------|-------|--------|--------|------|
| 合计 | — | — | — | 434125 | 1.9% | 300377 | 17656 | 8296 | $761k | $113k | $85k | $28k |
| 1 | 25 | shaoxiaoming | liwei | 57198 | ... | ... | ... | ... | ... | ... | ... | ... |

- 合计行固定在表格顶部，背景色略深
- 右上角显示 "Total Num: 320"
- 分页控件

## 前端筛选逻辑

浏览器端做客户端筛选：

| 筛选器 | 字段 |
|--------|------|
| 市场 | `publisher.markets` 中存在该 market key |
| 媒介搜索 | 匹配 `userName` 或 `userId` |
| 媒介经理 | 匹配 `adminName` |

筛选后重新计算 KPI 汇总和图表。

## 实施计划

见 `docs/superpowers/plans/2026-07-20-publishers-page-plan.md`
