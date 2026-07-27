"""检查为什么 publishers 的 link type 没有 'product'。"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

missing = [k for k in ["OFFER_DB_HOST", "OFFER_DB_NAME", "OFFER_DB_USER", "OFFER_DB_PASSWORD"]
           if not os.environ.get(k)]
if missing:
    print(f"缺少环境变量: {missing}")
    sys.exit(1)

from offer_db import connect
conn = connect()
cur = conn.cursor()

# 1) 整体概览
cur.execute("""
    SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN o.advert_id IS NOT NULL AND o.advert_id > 0 THEN 1 ELSE 0 END) AS has_advert,
        SUM(CASE WHEN a.advert_id IS NULL THEN 1 ELSE 0 END) AS join_miss
    FROM cnpscy_amazon_order o
    LEFT JOIN cnpscy_advert a ON o.advert_id = a.advert_id
    WHERE o.user_id IS NOT NULL AND o.user_id > 0
""")
r = cur.fetchone()
print(f"总行数:                    {r['total']}")
print(f"有 advert_id:              {r['has_advert']}")
print(f"LEFT JOIN 未命中:          {r['join_miss']}")

# 2) URL 分类
cur.execute("""
    SELECT
        SUM(CASE WHEN a.advert_url_real IS NULL THEN 1 ELSE 0 END) AS null_url,
        SUM(CASE WHEN a.advert_url_real LIKE '%/dp/%' THEN 1 ELSE 0 END) AS dp,
        SUM(CASE WHEN a.advert_url_real LIKE '%/gp/product/%' THEN 1 ELSE 0 END) AS gp_product,
        SUM(CASE WHEN a.advert_url_real LIKE '%/exec/obidos/%' THEN 1 ELSE 0 END) AS exec_obidos,
        SUM(CASE WHEN a.advert_url_real LIKE '%&asin=%' THEN 1 ELSE 0 END) AS amp_asin,
        SUM(CASE WHEN a.advert_url_real LIKE '%?asin=%' THEN 1 ELSE 0 END) AS q_asin,
        SUM(CASE WHEN a.advert_url_real NOT LIKE '%/dp/%'
                   AND a.advert_url_real NOT LIKE '%/gp/product/%'
                   AND a.advert_url_real NOT LIKE '%/exec/obidos/%'
                   AND a.advert_url_real NOT LIKE '%&asin=%'
                   AND a.advert_url_real NOT LIKE '%?asin=%'
                   THEN 1 ELSE 0 END) AS storefront_or_other
    FROM cnpscy_amazon_order o
    INNER JOIN cnpscy_advert a ON o.advert_id = a.advert_id
    WHERE o.user_id IS NOT NULL AND o.user_id > 0
""")
r = cur.fetchone()
print(f"\n--- 广告 URL 分类 (已匹配到 advert 表的行) ---")
print(f"URL 为 NULL:                    {r['null_url']}")
print(f"匹配 /dp/ (product):            {r['dp']}")
print(f"匹配 /gp/product/:              {r['gp_product']}")
print(f"匹配 /exec/obidos/:             {r['exec_obidos']}")
print(f"匹配 &asin= (product):          {r['amp_asin']}")
print(f"匹配 ?asin= (product):          {r['q_asin']}")
print(f"未匹配任何模式 (storefront):    {r['storefront_or_other']}")

# 3) LEFT JOIN 未命中的原因
cur.execute("""
    SELECT
        SUM(CASE WHEN o.advert_id IS NULL THEN 1 ELSE 0 END) AS null_advert_id,
        SUM(CASE WHEN o.advert_id IS NOT NULL AND o.advert_id > 0
                   AND a.advert_id IS NULL THEN 1 ELSE 0 END) AS orphan_advert_id
    FROM cnpscy_amazon_order o
    LEFT JOIN cnpscy_advert a ON o.advert_id = a.advert_id
    WHERE o.user_id IS NOT NULL AND o.user_id > 0
      AND (o.advert_id IS NULL OR o.advert_id <= 0 OR a.advert_id IS NULL)
""")
r = cur.fetchone()
print(f"\n--- LEFT JOIN 未命中的原因 ---")
print(f"advert_id 本身为 NULL:           {r['null_advert_id']}")
print(f"advert_id 有值但不在 advert 表:  {r['orphan_advert_id']}")

# 4) 抽样查看实际的 URL 格式
cur.execute("""
    SELECT a.advert_url_real, SUM(o.clicks) AS total_clicks
    FROM cnpscy_amazon_order o
    INNER JOIN cnpscy_advert a ON o.advert_id = a.advert_id
    WHERE o.user_id IS NOT NULL AND o.user_id > 0
      AND a.advert_url_real IS NOT NULL AND a.advert_url_real != ''
    GROUP BY a.advert_url_real
    ORDER BY total_clicks DESC
    LIMIT 20
""")
rows = cur.fetchall()
print(f"\n--- 点击最多的前 20 个广告 URL ---")
for row in rows:
    url = row['advert_url_real']
    clicks = row['total_clicks']
    print(f"  [{clicks}]  {url[:150]}")

conn.close()
