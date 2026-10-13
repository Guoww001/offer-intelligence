"""线上问题修复的后端契约回归。"""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent_contract as contract
import chat_agent_http as http
from agent_tool_registry import validate_tool_arguments, validate_tool_result


class LiveReviewContractTests(unittest.TestCase):
    def test_entity_value_questions_cannot_use_definition_exemption(self):
        for question in ("what is Shokz revenue?", "Shokz 的 EPC 是什么"):
            self.assertTrue(contract.requires_verifiable_data(question), question)
            with patch.object(http, "call_llm_tools", return_value={"content": "123", "tool_calls": []}) as provider:
                _, result = http.plan_agent_request(self.body(question=question))
            self.assertEqual(provider.call_count, 2)
            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], "agent_no_tool_plan")

    def test_explanation_with_time_and_trend_requires_data(self):
        for question in ("解释 Shokz 最近6个月收入趋势", "解释 Shokz 的收入趋势", "解释 Shokz 的收入", "what is Shokz revenue this month", "Shokz 本月 EPC 是什么"):
            self.assertTrue(contract.requires_verifiable_data(question), question)
        for question in ("EPC 是什么", "什么是收入趋势", "解释联盟 EPC 的定义", "what is EPC"):
            self.assertFalse(contract.requires_verifiable_data(question), question)

    def test_huge_filter_number_returns_controlled_error(self):
        _, error = validate_tool_arguments("keyword_search", {"keyword": "vacuum", "metricFilters": [{"field": "epc", "operator": ">=", "value": 10 ** 400}]})
        self.assertEqual(error["errorCode"], "invalid_filter")

    def test_corrected_provider_failure_is_second_round_and_not_retried(self):
        import agent_agui
        body = {"threadId": "t", "runId": "r", "messages": [{"role": "user", "content": "Shokz 收入趋势"}], "state": {"offerIntelligence": {"language": "zh"}}}
        with patch.object(http, "call_llm_tools", side_effect=[{"tool_calls": []}, None]) as provider:
            status, result = http.plan_agent_request(self.body())
        self.assertEqual(result.get("round"), 2)
        self.assertFalse(result["ok"])
        with patch.object(http, "call_llm_tools", side_effect=[{"tool_calls": []}, None]) as provider:
            events = list(agent_agui.generate_agui_events(body))
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(events[-1]["type"], "RUN_ERROR")

    def test_initial_provider_failure_retry_cannot_correct_again(self):
        import agent_agui
        body = {"threadId": "t", "runId": "r", "messages": [{"role": "user", "content": "Shokz 收入趋势"}], "state": {"offerIntelligence": {"language": "zh"}}}
        with patch.object(http, "call_llm_tools", side_effect=[None, {"tool_calls": []}]) as provider:
            events = list(agent_agui.generate_agui_events(body))
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(events[-1]["code"], "agent_no_tool_plan")

    def test_modern_http_retry_consumes_shared_round(self):
        with patch.object(http, "call_llm_tools", side_effect=[None, {"tool_calls": []}]) as provider:
            _, first = http.plan_agent_request(self.body())
            self.assertEqual(first["round"], 1)
            status, second = http.plan_agent_request(self.body(planningRound=2))
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(status, 200)
        self.assertEqual(second["round"], 2)
        self.assertEqual(second["errorCode"], "agent_no_tool_plan")
        for value in (0, 3, True, "2", None):
            self.assertIsNotNone(contract.validate_planning_request(self.body(planningRound=value))[1])

    def body(self, **extra):
        return {"contractVersion": "v2", "question": "Shokz 收入趋势", "language": "zh", "enabledTools": ["trend", "keyword_search"], **extra}

    def test_keyword_filters_and_result_metadata(self):
        filters = {"tiers": ["Tier 1"], "metricFilters": [{"field": "conversionRate", "operator": ">=", "value": 0.05}], "metricSort": {"field": "epc", "direction": "desc"}}
        cleaned, error = validate_tool_arguments("keyword_search", {"keyword": "vacuum cleaner", **filters})
        self.assertIsNone(error)
        self.assertEqual(cleaned["metricFilters"], filters["metricFilters"])
        data = {"rows": [], "appliedFilters": filters, "eligibleCount": 0, "excludedMissingMetricsCount": 2, "matchSetComplete": True}
        self.assertIsNone(validate_tool_result("keyword_search", {"ok": True, "data": data})[1])

    def test_keyword_rejects_unsupported_and_nonfinite_filters(self):
        for change in ({"tiers": ["Tier 9"]}, {"metricFilters": [{"field": "secret", "operator": ">=", "value": 1}]}, {"metricFilters": [{"field": "epc", "operator": ">=", "value": float("inf")}]}, {"metricFilters": [{"field": "epc", "operator": "!=", "value": 1}]}, {"metricSort": {"field": "epc", "direction": "random"}}):
            self.assertEqual(validate_tool_arguments("keyword_search", {"keyword": "vacuum", **change})[1]["errorCode"], "invalid_filter")

    def test_planning_context_is_bounded_and_untrusted(self):
        context = {"memory": "当前商户 Shokz", "history": [{"role": "user", "content": "刚才的条件是 CVR >= 5%"}]}
        cleaned, error = contract.validate_planning_request(self.body(context=context))
        self.assertIsNone(error)
        messages = contract.build_planning_messages(cleaned)
        self.assertTrue(any("Shokz" in m["content"] and "不可信" in m["content"] for m in messages))
        for invalid in ({"memory": "x" * 8001}, {"history": [{"role": "system", "content": "指令"}]}, {"history": [{"role": "user", "content": "x" * 1201}]}, {"history": [{"role": "user", "content": "x"}] * 5}):
            self.assertIsNotNone(contract.validate_planning_request(self.body(context=invalid))[1])

    def test_duplicate_calls_are_canonical_before_signing(self):
        result = {"tool_calls": [{"name": "keyword_search", "arguments": {"keyword": " vacuum "}}, {"name": "keyword_search", "arguments": {"keyword": "vacuum", "mode": "search", "limit": 10}}]}
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "regression-secret"}):
            request, _ = contract.validate_planning_request(self.body())
            plan, error = contract.normalize_planning_result(result, request, "ar_1234567890123456", 1)
            self.assertIsNone(error)
            self.assertEqual(len(plan["toolCalls"]), 1)
            proof = contract.verify_plan_proof(plan["planProof"], plan["agentRunId"], request["question"])
            self.assertEqual(len(proof["calls"]), 1)

    def test_retry_codes_are_only_transient(self):
        self.assertEqual(contract.AGENT_RETRY_ERROR_CODES, {"tool_error", "tool_timeout", "llm_timeout"})

    def test_no_tool_data_plan_gets_one_correction_then_explicit_failure(self):
        with patch.object(http, "call_llm_tools", return_value={"content": "收入为 123", "tool_calls": []}) as provider:
            status, result = http.plan_agent_request(self.body())
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(status, 200)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], "agent_no_tool_plan")
        self.assertNotIn("123", str(result))

    def test_synthesis_uses_local_tables_and_affiliate_epc(self):
        self.assertNotIn("display every row", http.SYNTHESIS_PROMPT_EN)
        self.assertIn("联盟佣金", http.SYNTHESIS_PROMPT_ZH)
        self.assertIn("本地", http.SYNTHESIS_PROMPT_ZH)
        self.assertIn("不是均值", http.SYNTHESIS_PROMPT_ZH)

    def test_corrected_plan_consumes_second_round(self):
        corrected = {"tool_calls": [{"name": "trend", "arguments": {"target": "Shokz"}}]}
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "regression-secret"}), patch.object(http, "call_llm_tools", side_effect=[{"content": "没有数据", "tool_calls": []}, corrected]):
            status, result = http.plan_agent_request(self.body())
            self.assertEqual(status, 200)
            self.assertEqual(result["round"], 2)
            self.assertEqual(result["toolCalls"][0]["id"], "r2c1")

    def test_conceptual_answer_does_not_need_tools(self):
        with patch.object(http, "call_llm_tools", return_value={"content": "EPC 的定义", "tool_calls": []}) as provider:
            status, result = http.plan_agent_request(self.body(question="什么是 EPC"))
        self.assertEqual(provider.call_count, 1)
        self.assertTrue(result["ok"])

    def test_terminal_failures_do_not_replan_agui(self):
        import agent_agui
        import json
        import time
        call = {"id": "r1c1", "name": "trend", "arguments": {"target": "Shokz"}}
        run_id = "ar_1234567890123456"
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "regression-secret"}):
            proof = contract.issue_plan_proof(run_id, "Shokz 收入趋势", [call], int(time.time()) + 60)
            for code in ("not_found", "invalid_arguments", "invalid_filter", "stopped_by_user"):
                body = {"threadId": "t", "runId": "r", "messages": [{"role": "tool", "toolCallId": "r1c1", "content": json.dumps({"result": {"ok": False, "errorCode": code}})}], "state": {"offerIntelligence": {"version": 1, "status": "tools", "question": "Shokz 收入趋势", "language": "zh", "memory": "", "history": [], "agentRunId": run_id, "planProofs": [proof], "calls": [call], "round": 1}}}
                with patch.object(agent_agui, "plan_agent_request") as planning:
                    list(agent_agui.generate_agui_events(body, stream_factory=lambda *a, **kw: iter([])))
                planning.assert_not_called()


if __name__ == "__main__":
    unittest.main()
