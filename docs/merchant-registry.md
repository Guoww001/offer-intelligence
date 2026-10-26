# Permanent merchant registry / 长期商家档案

The Merchants → Merchant registry page replaces the month-filtered New merchants page. Existing URLs and the `/api/ui/db/monthly-new-merchants` endpoint remain compatible; the response has `scope: permanent` and returns all active profiles regardless of the `month` parameter.

商家 → 商家档案替代按月份筛选的上新商家页面。原有地址与 API 保持兼容，返回全部有效档案，不按月份筛选。

## Data and migration / 数据与迁移

- `merchant_registry_seed.json` preserves all 47 populated source rows from AMZ (35), DTC (4) and levanta晚宴会见品牌 (8), including the original workbook SHA-256 and original cell values.
- `cnpscy_oi_merchant_registry` stores permanent profiles; `cnpscy_oi_merchant_registry_migrations` records one-off migration markers. Existing monthly records are merged first, followed by the supplied workbook; no source table is removed.
- Profile fields include site, contract number, platform, target, notes, BD, contact, category, onboarding date, status, source section/file and original Merchant ID, plus the previous commission, priority and performance fields.
- The AMZ blank first column contains `offline` values; imports retain those as merchant status. Raw dates, multi-ID strings and `us未接入` are preserved rather than guessed.
- The seed is never reapplied after its migration marker is committed. Deleting a profile sets a persistent tombstone; a future explicit import may restore it.

## Import identity / 导入与去重

Same ID and normalized brand: update the existing profile, retaining existing nonempty data when upload cells are blank. Repeated identical rows within one file are combined before saving. IDs under one brand remain separate accounts; unambiguous name-only contacts can be enriched later with an ID. Slash-separated IDs are retained and match each linked account. All workbook sheets are combined even when their column names and order differ.

重复 ID 与规范化品牌名一致时更新档案；上传空值不覆盖已有非空信息。同一品牌的不同 ID 保留为不同账号；缺少 ID 的档案仅在名称匹配唯一时关联。工作簿内重复行先合并，三个工作表均导入。

**Source conflict:** `406505` is assigned to both Koalu and Bosidin in the workbook. On an empty registry, Koalu keeps the first confirmed ID; Bosidin is preserved separately with original ID `406505`, an explicit identity warning and no active ID. Historical existing profiles may determine which conflicting ID is already occupied. Correct the unresolved profile’s ID in the editor after confirming the source. No ID is invented or taken from a similarly named account.

**原表冲突：** Koalu 与 Bosidin 共用 `406505`。两条品牌信息均保留，共享 ID 的后续档案显示冲突并等待确认。已有历史档案优先保留已占用的 ID；不会通过相似名称猜测替换。

## Tier 1 / Tier 1 规则

`trim(platform).casefold() == direct` is the only Tier 1 membership rule. Linked numeric Merchant IDs of Direct profiles are synchronized to `cnpscy_oi_tier_assignments`, with move history. The seed provides 19 Direct profiles, of which 18 have nonconflicting IDs on an empty registry.

Removing Direct status or deleting a profile restores `movedFromTier` when it is Tier 2–4 or BLACK TIER, otherwise uses Tier 4. Existing non-Tier-1 memberships are preserved. Newly registered numeric accounts without a previous tier start at Tier 4. Unresolved IDs remain visible as profiles and receive no guessed report assignment.

Tier1 手工添加接口、前端本地覆盖以及共享移动记录均不能绕过档案规则。调整平台后，档案与分级在同一事务内提交；失败一起回滚。报表缓存按档案版本校验，旧月份的缓存不会恢复旧 Tier1 规则。

## Deployment and validation / 部署与验证

`Sync permanent merchant registry` runs on changes to the seed or registry implementation on `main`, using the existing `OFFER_DB_*` repository variables and secret. It applies the migration and verifies that actual Tier 1 IDs exactly equal Direct profile IDs. The migration also runs lazily on the first profile/report read, under a MySQL advisory lock shared by serverless instances. Vercel Python functions explicitly package the seed.

推送到 main 后，专用工作流使用仓库现有数据库配置执行持久化并核对 Tier1。首次访问也可执行同一幂等迁移，并通过数据库锁避免并发重复导入。

Local verification:

```bash
python scripts/test_monthly_new_merchants.py
python scripts/test_offer_tracker_date_range.py
python scripts/test_tier_report_date_range.py
python scripts/test_tier_moves_api.py
python scripts/test_vercel_db_wsgi.py
python scripts/test_vercel_function_budget.py
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

The registry integration suite uses persistent SQLite with an adapter for MySQL dialect and advisory locks. Actual production MySQL migration success is confirmed by the dedicated GitHub workflow, not inferred from local tests.
