"""品类和明确历史区间的批量月度回归；仅使用合成数据。"""

import contextlib
import importlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agent_tool_registry import get_agent_tool_definitions, validate_tool_arguments, validate_tool_result


class 品类月度回归(unittest.TestCase):
    def 模块(self):
        self.assertIsNotNone(importlib.util.find_spec("agent_category_monthly"), "缺少真实品类批量月度查询模块")
        return importlib.import_module("agent_category_monthly")

    def 查询(self, query=None, members=None, order=None, aggregate=None, clicks=None):
        module = self.模块()
        calls = []
        sources = {
            "cnpscy_amazon_order": order or [],
            "cnpscy_order_new_aggregate": aggregate or [],
            "cnpscy_amazon_click": clicks or [],
        }
        columns = {
            "cnpscy_amazon_order": {"advert_id", "order_time_day", "total_purchases", "amount", "payout", "aff_payout", "total_clicks"},
            "cnpscy_order_new_aggregate": {"advert_id", "order_time_day", "amount", "order_num", "payout", "aff_payout", "click_num"},
            "cnpscy_amazon_click": {"advert_id", "time_day", "click"},
        }
        def fetch(conn, sql, params=()):
            calls.append((sql, params))
            if "cnpscy_oi_tier_assignments" in sql:
                return members if members is not None else [
                    {"merchantId": "11", "sheetCategory": "Home", "mainCategory": "Electronics"},
                    {"merchantId": "11", "sheetCategory": "Home", "mainCategory": "Electronics"},
                    {"merchantId": "12", "sheetCategory": "", "mainCategory": "Home"},
                    {"merchantId": "13", "sheetCategory": "Furniture", "mainCategory": "Home"},
                    {"merchantId": "14", "sheetCategory": "Home & Kitchen", "mainCategory": "Home"},
                ]
            for table, rows in sources.items():
                if "`" + table + "`" in sql:
                    return rows
            self.fail("意外数据库查询")
        with patch.object(module, "db_connection", return_value=contextlib.nullcontext(object())), \
             patch.object(module, "fetch_all", side_effect=fetch), \
             patch.object(module, "table_columns", side_effect=lambda conn, table: columns[table]):
            result = module.category_monthly_payload(query or {"category": ["Home"], "startMonth": ["2020-01"], "endMonth": ["2020-03"]})
        return result, calls

    def test_真实分类并集不包含相似名称且成员去重(self):
        payload, calls = self.查询({"category": ["Home", "Furniture", "Home"], "startMonth": ["2020-01"], "endMonth": ["2020-03"]})
        self.assertEqual(payload["categories"], ["Home", "Furniture"])
        self.assertEqual(payload["merchantCount"], 3)
        self.assertEqual(len(calls), 4, "成员加三个批量指标查询，不按商户查询")
        for sql, params in calls[1:]:
            self.assertEqual(tuple(params[:3]), ("11", "12", "13"))
            self.assertIn("GROUP BY", sql)
            self.assertIn("%s", sql)
            self.assertNotIn("LIMIT", sql, "历史区间不能由最新若干个月替代")
            self.assertIn(20191201, params, "内部查询包括前一月环比基期")
            self.assertIn(20200331, params)

    def test_按商户月合并来源后汇总且加权转化率(self):
        payload, _ = self.查询(order=[
            {"merchantId": "11", "month": "202001", "revenue": 100, "orders": 2, "clicks": 100, "payout": 10, "affiliatePayout": 3},
            {"merchantId": "12", "month": "202001", "revenue": 100, "orders": 6, "clicks": 20, "payout": 8, "affiliatePayout": 2},
        ], aggregate=[
            {"merchantId": "11", "month": "202001", "revenue": 0, "orders": 0, "clicks": 900, "payout": None, "affiliatePayout": None},
            {"merchantId": "12", "month": "202001", "revenue": 200, "orders": 12, "clicks": 900, "payout": 12, "affiliatePayout": 4},
        ])
        january = payload["monthly"][0]
        self.assertEqual(january["month"], "2020-01")
        self.assertEqual(january["revenue"], 200)
        self.assertEqual(january["orders"], 12)
        self.assertEqual(january["clicks"], 120, "aggregate点击不能覆盖Amazon官方点击")
        self.assertEqual(january["payout"], 22)
        self.assertEqual(january["affiliatePayout"], 7)
        self.assertEqual(january["conversionRate"], 0.1)
        self.assertEqual(january["epc"], round(7 / 120, 6))

    def test_缺失保持空且真实零保留并返回独立基期(self):
        payload, _ = self.查询(order=[
            {"merchantId": "11", "month": "201912", "revenue": 20, "orders": 1, "clicks": 10},
            {"merchantId": "11", "month": "202001", "revenue": 0, "orders": 0, "clicks": 0, "affiliatePayout": None},
            {"merchantId": "12", "month": "202001", "revenue": None, "orders": None, "clicks": None},
        ], aggregate=[{"merchantId": "11", "month": "202002", "clicks": 99}], clicks=[
            {"merchantId": "11", "month": "202001", "rawClicks": 5},
        ])
        self.assertEqual(payload["monthly"][0]["revenue"], 0)
        self.assertEqual(payload["monthly"][0]["clicks"], 5)
        self.assertIsNone(payload["monthly"][0]["affiliatePayout"])
        self.assertIsNone(payload["monthly"][1]["clicks"], "仅aggregate点击不能假装Amazon点击")
        self.assertIsNone(payload["monthly"][2]["orders"])
        self.assertEqual(payload["previousMonth"]["month"], "2019-12")
        self.assertEqual(payload["previousMonth"]["revenue"], 20)

    def test_拒绝不存在的分类而不查询月度(self):
        with self.assertRaisesRegex(ValueError, "品类"):
            self.查询({"category": ["Kitchen"], "startMonth": ["2020-01"], "endMonth": ["2020-02"]})

    def test_参数拒绝非法或超过二十四个月(self):
        module = self.模块()
        base = {"category": ["Home"], "startMonth": ["2020-01"], "endMonth": ["2021-12"]}
        invalid = [
            {**base, "startMonth": ["2020-13"]},
            {**base, "endMonth": ["2019-12"]},
            {**base, "endMonth": ["2022-01"]},
            {**base, "startMonth": []},
            {**base, "category": []},
            {**base, "endMonth": ["2020-1"]},
        ]
        with patch.object(module, "db_connection") as db:
            for query in invalid:
                with self.subTest(query=query), self.assertRaises(ValueError):
                    module.category_monthly_payload(query)
            db.assert_not_called()
        self.assertEqual(len(self.查询(base)[0]["monthly"]), 24)

    def test_趋势合同支持成对区间及派生指标(self):
        args, error = validate_tool_arguments("trend", {"target": "Home", "entityType": "category", "startMonth": "2020-01", "endMonth": "2021-12", "metric": "revenueMoM"})
        self.assertIsNone(error)
        self.assertEqual(args["startMonth"], "2020-01")
        schema = get_agent_tool_definitions("zh", ["trend"])[0]["parameters"]["properties"]
        self.assertIn("startMonth", schema)
        for patch_args in ({"endMonth": "2022-01"}, {"startMonth": "2022-01"}, {"startMonth": "2020-00"}, {"endMonth": None}):
            invalid = {"target": "Home", "startMonth": "2020-01", "endMonth": "2021-12", **patch_args}
            self.assertIsNotNone(validate_tool_arguments("trend", invalid)[1])
        self.assertIsNotNone(validate_tool_arguments("trend", {"target": "Home", "startMonth": "2020-01"})[1])
        self.assertIsNone(validate_tool_arguments("trend", {"target": "Home", "months": 12})[1])
        for metric in ("revenueMoM", "clicksMoM", "ordersDelta"):
            self.assertIsNone(validate_tool_arguments("trend", {"target": "Home", "metric": metric})[1])
        _, error = validate_tool_result("trend", {"ok": True, "data": {"startMonth": "2020-01", "endMonth": "2020-02", "months": [{"month": "2020-02", "metrics": {"revenueMoM": 0.1, "clicksMoM": None, "ordersDelta": 2}}]}})
        self.assertIsNone(error)

    def test_规划保留明确月份且综合使用已计算环比(self):
        from chat_agent_http import PLANNING_PROMPT_ZH, PLANNING_PROMPT_EN, SYNTHESIS_PROMPT_ZH, SYNTHESIS_PROMPT_EN
        for prompt in (PLANNING_PROMPT_ZH, PLANNING_PROMPT_EN):
            self.assertIn("startMonth", prompt)
            self.assertIn("endMonth", prompt)
            self.assertIn("entityType=category", prompt)
        for prompt in (SYNTHESIS_PROMPT_ZH, SYNTHESIS_PROMPT_EN):
            self.assertIn("revenueMoM", prompt)
            self.assertIn("clicksMoM", prompt)
            self.assertIn("ordersDelta", prompt)

    def test_批量月度SQL保留缺列和全空且商户历史查询不查成员(self):
        module = self.模块()
        calls = []
        def fetch(conn, sql, params):
            calls.append((sql, params))
            return [{"merchantId": "11", "month": "202001", "revenue": None, "orders": 0}]
        with patch.object(module, "db_connection", return_value=contextlib.nullcontext(object())), patch.object(module, "table_columns", return_value={"advert_id", "order_time_day", "amount"}), patch.object(module, "fetch_all", side_effect=fetch):
            payload = module.merchant_monthly_payload({"merchantId": ["11"], "startMonth": ["2020-01"], "endMonth": ["2020-02"]})
        self.assertIsNone(payload["monthly"][0]["revenue"])
        self.assertEqual(payload["monthly"][0]["orders"], 0)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all("cnpscy_oi_tier_assignments" not in sql for sql, _ in calls))
        self.assertIn("NULL AS `payout`", calls[0][0])
        self.assertIn("SUM(`o`.`amount`)", calls[0][0])
        self.assertNotIn("COALESCE", calls[0][0])
        self.assertIn("COUNT(*) AS `orders`", calls[0][0])

    def test_两套路由复用会话权限且查询参数原样传递(self):
        module = self.模块()
        import server
        api = importlib.import_module("api.db.index")
        self.assertEqual(server.UI_DB_PAGE_ACCESS["/api/ui/db/category-monthly"] if hasattr(server, "UI_DB_PAGE_ACCESS") else server.page_access_for_ui_path("/api/ui/db/category-monthly"), "dashboard")
        self.assertEqual(api.PAGE_ACCESS_BY_ROUTE["ui-category-monthly"], "dashboard")
        result = {"ok": True, "categories": ["Home"], "monthly": []}
        def request(allow):
            environ = {"REQUEST_METHOD": "GET", "PATH_INFO": "/api/ui/db/category-monthly", "QUERY_STRING": "category=Home&category=Furniture&startMonth=2020-01&endMonth=2020-02", "HTTP_X_OI_DB_ROUTE": "ui-category-monthly", "wsgi.input": io.BytesIO()}
            with patch.object(api, "require_page_access", return_value=allow) as auth, patch.object(api, "category_monthly_payload", return_value=result) as payload:
                response = api.app(environ, lambda status, headers: None)
                auth.assert_called_once()
                if allow:
                    self.assertEqual(json.loads(b"".join(response)), result)
                    self.assertEqual(payload.call_args.args[0]["category"], ["Home", "Furniture"])
                else:
                    payload.assert_not_called()
        request(True)
        request(False)
        routes = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))["routes"]
        self.assertTrue(any("category-monthly" in row["src"] and row["dest"] == "/api/db/index" for row in routes))
        local = object.__new__(server.Handler)
        with patch.object(local, "send_json") as send, patch.object(server, "category_monthly_payload", return_value=result):
            local.handle_db_ui_api(urlparse("/api/ui/db/category-monthly?category=Home&startMonth=2020-01&endMonth=2020-02"))
            send.assert_called_once_with(200, result)

    def test_明确历史商户查询复用批量查询且旧接口不变(self):
        module = self.模块()
        self.assertTrue(callable(getattr(module, "merchant_monthly_payload", None)), "缺少商户明确区间查询")
        import server
        api = importlib.import_module("api.db.index")
        result = {"ok": True, "merchantId": "11", "monthly": [{"month": "2020-01", "revenue": 1}], "previousMonth": {"month": "2019-12", "revenue": 2}}
        query = {"merchantId": ["11"], "startMonth": ["2020-01"], "endMonth": ["2020-02"]}
        target = api.WsgiTarget({"PATH_INFO": "/api/ui/db/merchant", "wsgi.input": io.BytesIO()})
        with patch.object(api, "read_static_merchant_ids", return_value=["11"]), patch.object(api, "merchant_monthly_payload", return_value=result) as monthly, patch.object(api, "merchant_payload") as old:
            api.handle_ui_merchant(target, query)
            monthly.assert_called_once_with(query)
            old.assert_not_called()
            self.assertEqual(json.loads(target.wfile.getvalue()), result)
        local = object.__new__(server.Handler)
        with patch.object(server, "read_static_merchant_ids", return_value=["11"]), patch.object(local, "send_json") as send, patch.object(server, "merchant_monthly_payload", return_value=result) as monthly, patch.object(server, "merchant_payload") as old:
            local.handle_db_ui_api(urlparse("/api/ui/db/merchant?merchantId=11&startMonth=2020-01&endMonth=2020-02"))
            monthly.assert_called_once_with(query)
            old.assert_not_called()
            send.assert_called_once_with(200, result)

    def test_明确区间保留商户已有月度指标(self):
        payload, _ = self.查询(order=[{"merchantId": "11", "month": "202001", "orders": 2, "clicks": 10, "revenue": 100, "payout": 8, "affiliatePayout": 2, "dpv": 20, "atc": 7, "directSales": 80, "haloSales": 20}])
        row = payload["monthly"][0]
        self.assertEqual(row.get("dpv"), 20)
        self.assertEqual(row["atc"], 7)
        self.assertEqual(row["directSales"], 80)
        self.assertEqual(row["haloSales"], 20)
        self.assertEqual(row["allEpc"], 0.8)
        self.assertEqual(row["affEpc"], 0.2)

    def test_八百多个成员仍只执行固定批量查询(self):
        payload, calls = self.查询(members=[{"merchantId": str(index), "mainCategory": "Home"} for index in range(1, 873)])
        self.assertEqual(payload["merchantCount"], 872)
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(len(params) == 874 for _, params in calls[1:]))

    def test_商户缺少比例输入时不拼接不同覆盖集合(self):
        payload, _ = self.查询(order=[
            {"merchantId": "11", "month": "202001", "orders": 5, "revenue": 100, "affiliatePayout": 4, "payout": 8, "clicks": None},
            {"merchantId": "12", "month": "202001", "orders": 2, "revenue": 50, "affiliatePayout": 2, "payout": 4, "clicks": 10},
            {"merchantId": "11", "month": "202002", "orders": 0, "revenue": None, "affiliatePayout": None, "payout": None, "clicks": 0},
            {"merchantId": "12", "month": "202002", "orders": 2, "revenue": 50, "affiliatePayout": 2, "payout": 4, "clicks": 10},
        ])
        january, february = payload["monthly"][:2]
        self.assertEqual(january["orders"], 7)
        self.assertEqual(january["clicks"], 10)
        self.assertIsNone(january["conversionRate"], "不能用甲乙订单除以仅乙点击")
        self.assertIsNone(january["epc"])
        self.assertIsNone(january["allEpc"])
        self.assertEqual(january["aov"], round(150 / 7, 6))
        self.assertEqual(february["conversionRate"], 0.2, "真实零仍属于完整比例输入")
        for key in ("epc", "affEpc", "allEpc", "aov"):
            self.assertIsNone(february[key], "金额缺失时不使用其他商户金额构造比例")

    def test_未分类占位回退数据库真实主分类(self):
        try:
            payload, _ = self.查询(members=[{"merchantId": "11", "sheetCategory": "Uncategorized", "mainCategory": "Home"}])
        except ValueError:
            self.fail("未分类占位应回退真实主分类，不应拒绝品类查询")
        self.assertEqual(payload["categories"], ["Home"])
        self.assertEqual(payload["merchantCount"], 1)

    def test_接口错误状态隔离校验和数据库失败(self):
        self.模块()
        import server
        api = importlib.import_module("api.db.index")
        environ = {"REQUEST_METHOD": "GET", "PATH_INFO": "/api/ui/db/category-monthly", "QUERY_STRING": "category=Home&startMonth=2020-01&endMonth=2020-02", "HTTP_X_OI_DB_ROUTE": "ui-category-monthly", "wsgi.input": io.BytesIO()}
        for error, expected in ((ValueError("月份无效"), 400), (RuntimeError("不可公开的内部细节"), 502)):
            statuses = []
            with patch.object(api, "require_page_access", return_value=True), patch.object(api, "category_monthly_payload", side_effect=error):
                body = json.loads(b"".join(api.app(environ, lambda status, headers: statuses.append(status))))
            self.assertTrue(statuses[0].startswith(str(expected)))
            self.assertFalse(body["ok"])
            self.assertNotIn("不可公开", body["error"])
        with patch.object(api, "require_page_access", return_value=True), patch.object(api, "category_monthly_payload") as payload:
            statuses = []
            api.app({**environ, "REQUEST_METHOD": "POST"}, lambda status, headers: statuses.append(status))
            self.assertTrue(statuses[0].startswith("405"))
            payload.assert_not_called()
        local = object.__new__(server.Handler)
        with patch.object(local, "send_json") as send, patch.object(server, "category_monthly_payload", side_effect=ValueError("月份无效")):
            local.handle_db_ui_api(urlparse("/api/ui/db/category-monthly?category=Home&startMonth=2020-01"))
            send.assert_called_once_with(400, {"ok": False, "error": "月份无效"})


if __name__ == "__main__":
    unittest.main()
