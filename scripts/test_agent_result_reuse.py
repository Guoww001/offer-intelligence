"""复用只接受原问题证明和已成功、覆盖范围内的结果。"""
from copy import deepcopy
from pathlib import Path
import os
import sys
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent_contract as contract


def request():
    original = "分析 Shokz 和 Roborock 月度趋势"
    calls = [{"id": f"r1c{i + 1}", "name": "trend", "arguments": {
        "entityType": "merchant", "target": target, "months": 12,
    }} for i, target in enumerate(("Shokz", "Roborock"))]
    return {
        "contractVersion": "v2", "agentRunId": "reuse-agent-run-2026",
        "question": "不要重查，只整理成表", "language": "zh",
        "planProofs": [contract.issue_plan_proof("reuse-agent-run-2026", original, calls, int(time.time()) + 300)],
        "trace": {"runId": "current-run", "questionEventId": "current-event", "tracePhase": "synthesis"},
        "reuse": {"originalQuestion": original, "sourceQuestionEventId": "source-event",
                  "scope": {"targets": [], "months": [], "metrics": []}},
        "toolResults": [{"callId": call["id"], "toolName": call["name"], "arguments": call["arguments"],
            "result": {"ok": True, "source": {"dataSource": "database", "dataAsOf": "2026-10-14", "estimated": False},
            "data": {"entityType": "merchant", "target": call["arguments"]["target"],
                     "summary": {"latestMonthComplete": False}, "months": [
                         {"month": month, "metrics": {"revenue": 100, "orders": 7, "clicks": 100,
                           "commission": 20, "conversionRate": .07, "epc": .2}}
                         for month in ("2026-08", "2026-09", "2026-10")]}}} for call in calls],
    }


class ReuseTests(unittest.TestCase):
    def setUp(self):
        self.secret = patch.dict(os.environ, {"OI_SESSION_SECRET": "result-reuse-unit-secret"})
        self.secret.start()
        self.addCleanup(self.secret.stop)

    def validate(self, body):
        validated, error = contract.validate_synthesis_request(body)
        self.assertIsNone(error, error)
        return validated, contract.validate_bound_tool_results(validated)

    def test_current_question_and_trace_keep_original_binding(self):
        body = request()
        validated, (results, error) = self.validate(body)
        self.assertIsNone(error)
        self.assertEqual(len(results), 2)
        self.assertEqual(validated["trace"]["questionEventId"], "current-event")
        messages = contract.build_synthesis_messages(validated, results)
        self.assertIn(body["question"], "\n".join(m["content"] for m in messages))
        self.assertNotIn(body["planProofs"][0], str(messages))

    def test_no_reuse_keeps_old_question_binding(self):
        body = request()
        body["question"] = body.pop("reuse")["originalQuestion"]
        _, (_, error) = self.validate(body)
        self.assertIsNone(error)

    def test_scope_is_projected_and_uncovered_scope_rejected(self):
        body = request()
        body["reuse"]["scope"] = {"targets": ["Shokz"], "months": ["2026-09"], "metrics": ["revenue"]}
        _, (results, error) = self.validate(body)
        self.assertIsNone(error)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["result"]["data"]["months"], [{"month": "2026-09", "metrics": {"revenue": 100}}])
        for field, value in (("targets", ["Unknown"]), ("months", ["2026-07"]), ("metrics", ["payout"])):
            changed = deepcopy(body)
            changed["reuse"]["scope"][field] = value
            _, (_, error) = self.validate(changed)
            self.assertEqual(error["errorCode"], "agent_reuse_scope_unavailable", field)

    def test_coverage_must_exist_for_each_selected_target_and_month(self):
        body = request()
        body["toolResults"][1]["result"]["data"]["months"][0]["metrics"]["epc"] = None
        body["reuse"]["scope"] = {"targets": [], "months": ["2026-08"], "metrics": ["epc"]}
        _, (_, error) = self.validate(body)
        self.assertEqual(error["errorCode"], "agent_reuse_scope_unavailable")

    def test_failed_results_are_never_reused(self):
        body = request()
        body["toolResults"][0]["result"] = {"ok": False, "errorCode": "tool_error"}
        _, (_, error) = self.validate(body)
        self.assertEqual(error["errorCode"], "agent_reuse_scope_unavailable")

    def test_expiry_tampering_wrong_question_arguments_and_run_rejected(self):
        for field in ("expiry", "proof", "question", "arguments", "run"):
            body = request()
            if field == "expiry":
                with patch.object(contract.time, "time", return_value=time.time() + 700):
                    _, (_, error) = self.validate(body)
            else:
                if field == "proof":
                    body["planProofs"][0] += "x"
                elif field == "question":
                    body["reuse"]["originalQuestion"] += "其他问题"
                elif field == "arguments":
                    body["toolResults"][0]["arguments"]["target"] = "Other"
                else:
                    body["agentRunId"] = "another-agent-run-2026"
                _, (_, error) = self.validate(body)
            self.assertEqual(error["errorCode"], "run_binding_failed", field)

    def test_unknown_reuse_fields_and_invalid_metric_are_rejected(self):
        for field in ("extra", "metric", "month", "source"):
            body = request()
            if field == "extra":
                body["reuse"]["proofBypass"] = True
            elif field == "metric":
                body["reuse"]["scope"]["metrics"] = ["secret"]
            elif field == "month":
                body["reuse"]["scope"]["months"] = ["2026-13"]
            else:
                body["reuse"]["sourceQuestionEventId"] = ""
            _, error = contract.validate_synthesis_request(body)
            self.assertEqual(error["errorCode"], "invalid_agent_contract")

    def test_restricted_month_keeps_its_original_completeness(self):
        body = request()
        body["reuse"]["scope"]["months"] = ["2026-09"]
        validated, (results, error) = self.validate(body)
        self.assertIsNone(error)
        summary = contract.build_trend_summary(results)
        self.assertEqual(summary["months"], ["2026-09"])
        self.assertEqual(results[0]["result"]["source"]["dataAsOf"], "2026-10-14")
        self.assertEqual(body["toolResults"][0]["result"]["data"]["summary"]["latestMonthComplete"], False)

    def test_ratio_only_reuse_preserves_weighted_summary_without_exposing_inputs(self):
        import json
        for metric, monthly_expected, expected in (("conversionRate", .07, 14 / 300), ("epc", .2, 40 / 300)):
            body = request()
            body["reuse"]["scope"] = {"targets": ["Shokz"], "months": ["2026-08", "2026-09"], "metrics": [metric]}
            # 两个月分母不同，汇总必须使用总分子/总分母而非月比例平均。
            monthly = body["toolResults"][0]["result"]["data"]["months"]
            monthly[1]["metrics"].update({"orders": 7, "clicks": 200, "commission": 20,
                                          "conversionRate": .035, "epc": .1})
            validated, (results, error) = self.validate(body)
            self.assertIsNone(error)
            self.assertEqual(results[0]["result"]["data"]["months"][0]["metrics"], {metric: monthly_expected})
            messages = contract.build_synthesis_messages(validated, results)
            summary = json.loads(next(message["content"].split("\n", 1)[1] for message in messages if "共同完整月份汇总" in message["content"]))
            self.assertAlmostEqual(summary["entities"][0]["commonCompleteMetrics"][metric], expected)
            self.assertEqual(set(summary["entities"][0]["commonCompleteMetrics"]), {metric})
            self.assertEqual(set(summary["metricLeaders"]), {metric})
            self.assertEqual(summary["metricLeaders"][metric]["lowest"]["targets"], ["Shokz"])
            joined = "\n".join(message["content"] for message in messages)
            for unselected in ("orders", "clicks", "commission", "revenue"):
                self.assertNotIn('"' + unselected + '"', joined)

    def test_selecting_one_completed_target_is_not_partial_execution(self):
        body = request()
        body["reuse"]["scope"]["targets"] = ["Shokz"]
        validated, (results, error) = self.validate(body)
        self.assertIsNone(error)
        self.assertEqual(len(results), 1)
        messages = contract.build_synthesis_messages(validated, results)
        self.assertFalse(any("工具执行结果不完整" in message["content"] for message in messages))

    def test_partial_success_set_is_allowed_without_claiming_full_completion(self):
        body = request()
        body["toolResults"] = body["toolResults"][:1]
        validated, (results, error) = self.validate(body)
        self.assertIsNone(error)
        messages = contract.build_synthesis_messages(validated, results)
        self.assertTrue(any("执行结果不完整" in m["content"] for m in messages))
        body["reuse"]["scope"]["targets"] = ["Roborock"]
        _, (_, error) = self.validate(body)
        self.assertEqual(error["errorCode"], "agent_reuse_scope_unavailable")

    def test_local_and_vercel_stream_reuse_current_question_without_new_tools(self):
        from test_agent_synthesis_contract import invoke_stream_handlers, assert_error
        body = request()
        targets, captured = invoke_stream_handlers(body)
        self.assertEqual([target.status for target in targets], [200, 200])
        self.assertEqual(len(captured), 2)
        for capture in captured:
            joined = "\n".join(message["content"] for message in capture["messages"])
            self.assertIn(body["question"], joined)
            self.assertIn("2026-08", joined)
            self.assertNotIn(body["planProofs"][0], joined)
        body["reuse"]["scope"]["months"] = ["2026-01"]
        targets, captured = invoke_stream_handlers(body)
        self.assertEqual(captured, [])
        for target in targets:
            assert_error(target, 409, "agent_reuse_scope_unavailable")


if __name__ == "__main__":
    unittest.main()
