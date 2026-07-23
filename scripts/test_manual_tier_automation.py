from pathlib import Path

from sync_oi_tables import load_feishu_csv, load_product_keywords_csv, parse_args


default_args = parse_args([])
assert not default_args.sync_tier_assignments
assert not default_args.sync_visual_status

manual_args = parse_args([
    "--sync-tier-assignments",
    "--sync-visual-status",
])
assert manual_args.sync_tier_assignments
assert manual_args.sync_visual_status

feishu_rows = load_feishu_csv()
assert feishu_rows
assert {"merchantId", "merchantName", "mainCategory", "subCategory"} <= set(
    feishu_rows[0]
)

keyword_rows = load_product_keywords_csv()
assert keyword_rows
assert {"merchantId", "merchantName", "productKeywords"} <= set(keyword_rows[0])

workflow = (
    Path(__file__).resolve().parent.parent
    / ".github"
    / "workflows"
    / "sync-levanta-payments.yml"
).read_text(encoding="utf-8")
assert "python scripts/sync_oi_tables.py" in workflow
assert "--sync-tier-assignments" not in workflow
assert "--sync-visual-status" not in workflow

print("Manual tier/color automation guard checks passed")
