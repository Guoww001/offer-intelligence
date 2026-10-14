"""比较只使用共同完整月份，缺失不补零。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent_contract as contract
import agent_trend_comparison as comparison


def trend(target, months, metrics=None, complete=False):
    return {"toolName": "trend", "arguments": {"target": target, "months": 12}, "result": {"ok": True, "data": {
        "entityType": "merchant", "target": target, "summary": {"latestMonthComplete": complete},
        "months": [{"month": month, "metrics": metrics or {"revenue": 100, "orders": 10, "clicks": 100, "commission": 20}} for month in months]
    }}}


class TrendComparisonTests(unittest.TestCase):
    def calculate(self, results):
        return contract.build_trend_comparison(results)

    def test_different_coverage_compares_common_complete_months(self):
        months = [f"2025-{m:02}" for m in (11, 12)] + [f"2026-{m:02}" for m in range(1, 11)]
        result = self.calculate([trend("Shokz", months), trend("Roborock", months[-8:]), trend("Beatbot Amazon", months[-5:])])
        self.assertEqual(result["months"], ["2026-06", "2026-07", "2026-08", "2026-09"])
        self.assertEqual(result["excludedIncompleteMonths"], ["2026-10"])
        self.assertEqual([row["availableMonths"] for row in result["entities"]], [12, 8, 5])
        self.assertEqual(result["entities"][0]["availablePeriodMetrics"]["revenue"], 1200)
        self.assertEqual(result["entities"][0]["commonCompleteMetrics"]["revenue"], 400)
        self.assertEqual(result["entities"][0]["commonCompleteMetrics"], {"revenue": 400, "orders": 40, "clicks": 400, "commission": 80, "conversionRate": 0.1, "epc": 0.2})

    def test_ratios_use_totals_and_gaps_are_not_filled(self):
        first = trend("A", ["2026-06", "2026-08"], complete=True)
        first["result"]["data"]["months"][1]["metrics"] = {"revenue": 0, "orders": 1, "clicks": 10, "commission": 0}
        result = self.calculate([first, trend("B", ["2026-06", "2026-07", "2026-08"], complete=True)])
        self.assertEqual(result["months"], ["2026-06", "2026-08"])
        self.assertEqual(result["entities"][0]["commonCompleteMetrics"]["epc"], 20 / 110)
        self.assertEqual(result["entities"][0]["commonCompleteMetrics"]["conversionRate"], 11 / 110)
        self.assertEqual(result["entities"][0]["commonCompleteTrends"]["revenue"], {"first": 100, "latest": 0, "changePercent": -100})

    def test_missing_inputs_do_not_become_zero_or_partial_total(self):
        first = trend("A", ["2026-06", "2026-07"], complete=True)
        first["result"]["data"]["months"][1]["metrics"]["commission"] = None
        result = self.calculate([first, trend("B", ["2026-06", "2026-07"], {"revenue": 0, "orders": 0, "clicks": 100, "commission": 0}, True)])
        self.assertIsNone(result["entities"][0]["commonCompleteMetrics"]["epc"])
        self.assertIsNone(result["entities"][0]["commonCompleteMetrics"]["commission"])
        self.assertEqual(result["entities"][1]["commonCompleteMetrics"]["epc"], 0)
        self.assertEqual(result["entities"][1]["commonCompleteMetrics"]["conversionRate"], 0)

    def test_no_overlap_explicitly_has_no_totals(self):
        result = self.calculate([trend("A", ["2026-06"], complete=True), trend("B", ["2026-07"], complete=True)])
        self.assertEqual(result["months"], [])
        self.assertTrue(all(row["commonCompleteMetrics"]["revenue"] is None for row in result["entities"]))

    def test_retry_result_does_not_duplicate_merchant(self):
        self.assertIsNone(self.calculate([trend("A", ["2026-06"]), trend("A", ["2026-06"])]))

    def test_missing_metric_object_is_unavailable(self):
        first = trend("A", ["2026-06", "2026-07"], complete=True)
        first["result"]["data"]["months"][1]["metrics"] = None
        result = self.calculate([first, trend("B", ["2026-06", "2026-07"], complete=True)])
        self.assertIsNone(result["entities"][0]["commonCompleteMetrics"]["revenue"])

    def test_nullable_months_and_summary_are_supported(self):
        first = trend("A", ["2026-06", "2026-07"], complete=True)
        first["result"]["data"]["months"] = None
        self.assertIsNone(self.calculate([first, trend("B", ["2026-06", "2026-07"], complete=True)]))
        first["result"]["data"]["months"] = [{"month": "2026-06", "metrics": {}}]
        first["result"]["data"]["summary"] = None
        self.assertEqual(self.calculate([first, trend("B", ["2026-06"], complete=True)])["months"], ["2026-06"])

    def test_summary_is_in_synthesis_context(self):
        results = [trend("A", ["2026-06", "2026-07"], complete=True), trend("B", ["2026-06", "2026-07"], complete=True)]
        for index, row in enumerate(results):
            row["callId"] = f"r1c{index+1}"
        messages = contract.build_synthesis_messages({"context": {}, "language": "zh", "question": "比较趋势", "planProofs": []}, results)
        self.assertTrue(any("共同完整月份" in message["content"] for message in messages))

    def test_single_merchant_uses_complete_months_and_formats_ratios(self):
        row = trend("Shokz", ["2026-08", "2026-09", "2026-10"])
        row["result"]["source"] = {"dataAsOf": "2026-10-14T01:00:00Z"}
        row["result"]["data"]["months"][0]["metrics"]["revenue"] = 1.234
        row["result"]["data"]["months"][1]["metrics"]["revenue"] = 3.456
        row["result"]["data"]["months"][2]["metrics"]["revenue"] = 999999
        result = comparison.build_trend_summary([row])
        self.assertEqual(result["months"], ["2026-08", "2026-09"])
        entity = result["entities"][0]
        self.assertEqual(entity["completeMonths"], 2)
        self.assertEqual(entity["commonCompleteMetricsDisplay"]["revenue"], "4.69")
        self.assertEqual(entity["commonCompleteMetricsDisplay"]["conversionRate"], "10.00%")
        self.assertEqual(entity["commonCompleteMetricsDisplay"]["epc"], "0.200")
        self.assertAlmostEqual(entity["commonCompleteTrends"]["revenue"]["changePercent"], (3.456 - 1.234) / 1.234 * 100)

    def test_format_missing_zero_and_change_percent_units(self):
        self.assertEqual(comparison.format_agent_metric("conversionRate", .072), "7.20%")
        self.assertEqual(comparison.format_agent_metric("changePercent", 120.5), "120.50%")
        self.assertEqual(comparison.format_agent_metric("revenue", 0), "0.00")
        self.assertEqual(comparison.format_agent_metric("epc", 0), "0.000")
        self.assertEqual(comparison.format_agent_metric("revenue", None), "未提供")
        self.assertEqual(comparison.format_agent_metric("clicks", 1234), "1,234")

    def test_business_timezone_date_excludes_current_month_even_if_flag_says_complete(self):
        row = trend("A", ["2026-09", "2026-10"], complete=True)
        row["result"]["source"] = {"dataAsOf": "2026-09-30T20:00:00Z"}
        result = comparison.build_trend_summary([row])
        self.assertEqual(result["months"], ["2026-09"])

    def test_unknown_completeness_is_not_asserted_for_single_merchant(self):
        row = trend("A", ["2026-09", "2026-10"], complete=True)
        row["result"]["data"]["summary"] = None
        result = comparison.build_trend_summary([row])
        self.assertEqual(result["months"], [])
        self.assertEqual(result["unknownCompleteMonths"], ["2026-09", "2026-10"])

    def test_synthesis_prompt_prefers_display_and_complete_summary(self):
        from chat_agent_http import agent_synthesis_system_prompt
        prompt = agent_synthesis_system_prompt("zh")
        self.assertIn("必要的对比表", prompt)
        self.assertIn("commonCompleteMetricsDisplay", prompt)
        self.assertIn("单商户", prompt)

    def test_each_merchant_complete_count_uses_own_coverage(self):
        result = comparison.build_trend_summary([
            trend("A", ["2026-08", "2026-09", "2026-10"], complete=False),
            trend("B", ["2026-08", "2026-09"], complete=True),
        ])
        self.assertEqual([row["completeMonths"] for row in result["entities"]], [2, 2])
        result = comparison.build_trend_summary([
            trend("A", ["2026-08", "2026-09", "2026-10"], complete=False),
            trend("B", ["2026-08", "2026-09"], complete=False),
        ])
        self.assertEqual([row["completeMonths"] for row in result["entities"]], [2, 1])

    def test_metric_leaders_do_not_mix_cvr_and_epc_order(self):
        rows = [trend(target, ["2026-06", "2026-09"], {
            "revenue": 100, "orders": orders, "clicks": 10000, "commission": commission,
        }, complete=True) for target, orders, commission in (
            ("Shokz", 207, 2930), ("Roborock", 180, 9520), ("Beatbot Amazon", 359, 27140))]
        result = comparison.build_trend_summary(rows)
        self.assertEqual(result["metricLeaders"]["conversionRate"]["lowest"]["targets"], ["Roborock"])
        self.assertEqual(result["metricLeaders"]["epc"]["lowest"]["targets"], ["Shokz"])
        self.assertEqual(result["metricLeaders"]["conversionRate"]["highest"]["targets"], ["Beatbot Amazon"])
        self.assertEqual(result["metricLeaders"]["conversionRate"]["lowest"]["display"], "1.80%")

    def test_metric_leaders_preserve_ties_and_missing_coverage(self):
        rows = [trend("A", ["2026-06", "2026-09"], complete=True),
                trend("B", ["2026-06", "2026-09"], complete=True),
                trend("C", ["2026-06", "2026-09"], {"revenue": None, "orders": None, "clicks": 100, "commission": None}, complete=True)]
        result = comparison.build_trend_summary(rows)
        for metric in ("revenue", "conversionRate", "epc"):
            leaders = result["metricLeaders"][metric]
            self.assertEqual(leaders["highest"]["targets"], ["A", "B"])
            self.assertEqual(leaders["lowest"]["targets"], ["A", "B"])
            self.assertEqual(leaders["unavailableTargets"], ["C"])
        for row in rows:
            for month in row["result"]["data"]["months"]:
                month["metrics"]["commission"] = None
        result = comparison.build_trend_summary(rows)
        self.assertIsNone(result["metricLeaders"]["epc"]["highest"])
        self.assertIsNone(result["metricLeaders"]["epc"]["lowest"])

    def test_synthesis_messages_require_metric_specific_leaders(self):
        rows = [trend("A", ["2026-06", "2026-09"], complete=True),
                trend("B", ["2026-06", "2026-09"], complete=True)]
        for i, row in enumerate(rows):
            row["callId"] = f"r1c{i+1}"
        messages = contract.build_synthesis_messages({"context": {}, "language": "zh", "question": "比较", "planProofs": []}, rows)
        self.assertTrue(any("最高或最低" in message["content"] and "metricLeaders" in message["content"] for message in messages))


if __name__ == "__main__":
    unittest.main()
