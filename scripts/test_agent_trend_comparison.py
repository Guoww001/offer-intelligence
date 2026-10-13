"""比较只使用共同完整月份，缺失不补零。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent_contract as contract


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


if __name__ == "__main__":
    unittest.main()
