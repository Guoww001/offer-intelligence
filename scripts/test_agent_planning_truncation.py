"""规划截断、恢复预算及共同月份的行为回归。"""
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent_contract as contract
import chat_agent_http as http
import llm_provider


class PlanningTruncationTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"OI_SESSION_SECRET": "regression-secret", "OI_AGENT_PLAN_MAX_TOKENS": "4096"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def body(self, **extra):
        return {"contractVersion": "v2", "question": "分别分析 Shokz、Roborock、Beatbot Amazon 最近12个月的收入、订单、CVR和EPC，再比较趋势", "language": "zh", "enabledTools": ["trend"], **extra}

    def plan(self, reason):
        return {"ok": True, "finishReason": reason, "tool_calls": [{"name": "trend", "arguments": {"target": "Shokz", "months": 12}}]}

    def test_provider_retains_finish_reason(self):
        response = SimpleNamespace(choices=[SimpleNamespace(finish_reason="length", message=SimpleNamespace(content=None, tool_calls=[]))], usage=None)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **_: response)))
        with patch.dict(os.environ, {"OI_LLM_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "test"}), patch.dict(sys.modules, {"openai": SimpleNamespace(OpenAI=lambda **_: client)}):
            result = llm_provider.call_llm_tools([], [], return_metadata=True)
        self.assertEqual(result["finishReason"], "length")

    def test_claude_retains_max_tokens_reason(self):
        response = SimpleNamespace(stop_reason="max_tokens", content=[], usage=None)
        client = SimpleNamespace(messages=SimpleNamespace(create=lambda **_: response))
        with patch.dict(os.environ, {"OI_LLM_PROVIDER": "claude", "ANTHROPIC_API_KEY": "test"}), patch.dict(sys.modules, {"anthropic": SimpleNamespace(Anthropic=lambda **_: client)}):
            result = llm_provider.call_llm_tools([], [], return_metadata=True)
        self.assertEqual(result["finishReason"], "max_tokens")

    def test_partial_tool_plan_is_not_signed(self):
        request, _ = contract.validate_planning_request(self.body())
        for reason in ("length", "max_tokens"):
            result, error = contract.normalize_planning_result(self.plan(reason), request, "ar_1234567890123456", 1)
            self.assertIsNone(result)
            self.assertEqual(error["errorCode"], "agent_plan_truncated")

    def test_truncation_recovers_once_and_discards_partial_tools(self):
        complete = self.plan("tool_calls")
        complete["tool_calls"] = [{"name": "trend", "arguments": {"target": name, "months": 12}} for name in ("Shokz", "Roborock", "Beatbot Amazon")]
        with patch.object(http, "call_llm_tools", side_effect=[self.plan("length"), complete]) as provider:
            status, result = http.plan_agent_request(self.body())
        self.assertEqual(status, 200)
        self.assertTrue(result["ok"])
        self.assertEqual(result["round"], 2)
        self.assertEqual(len(result["toolCalls"]), 3)
        self.assertEqual([call.kwargs["max_tokens"] for call in provider.call_args_list], [4096, 8192])
        self.assertEqual(result["telemetry"]["finishReason"], "tool_calls")

    def test_second_truncation_is_terminal_even_with_tools(self):
        with patch.object(http, "call_llm_tools", return_value=self.plan("length")) as provider:
            _, result = http.plan_agent_request(self.body())
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(result["round"], 2)
        self.assertEqual(result["errorCode"], "agent_plan_truncated")
        self.assertNotIn("planProof", result)
        with patch.object(http, "call_llm_tools", return_value=self.plan("max_tokens")) as provider:
            _, result = http.plan_agent_request(self.body(planningRound=2))
        self.assertEqual(provider.call_count, 1)
        self.assertFalse(result["ok"])

    def test_token_configuration_is_bounded(self):
        for raw, expected in (("invalid", 4096), ("1", 1024), ("9999999", 8192)):
            with patch.dict(os.environ, {"OI_AGENT_PLAN_MAX_TOKENS": raw}), patch.object(http, "call_llm_tools", return_value=self.plan("tool_calls")) as provider:
                http.plan_agent_request(self.body())
            self.assertEqual(provider.call_args.kwargs["max_tokens"], expected)

    def test_shared_http_timeout_leaves_room_before_serverless_60_seconds(self):
        times = iter([100, 100, 131])
        with patch.object(http, "call_llm_tools", side_effect=[self.plan("length"), self.plan("tool_calls")]) as provider, patch.object(http, "time", SimpleNamespace(monotonic=lambda: next(times)), create=True):
            http.plan_agent_request(self.body())
        self.assertEqual([call.kwargs["timeout"] for call in provider.call_args_list], [30, 24])

    def test_agui_cannot_add_third_round_after_truncation(self):
        import agent_agui
        body = {"threadId": "t", "runId": "r", "messages": [{"role": "user", "content": self.body()["question"]}], "state": {"offerIntelligence": {"version": 1, "language": "zh", "legacyParity": True}}}
        with patch.object(http, "call_llm_tools", return_value=self.plan("length")) as provider:
            events = list(agent_agui.generate_agui_events(body))
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(events[-1]["type"], "RUN_ERROR")
        self.assertEqual(events[-1]["code"], "agent_plan_truncated")
        self.assertFalse(any(event.get("type") == "TOOL_CALL_START" for event in events))

    def test_unavailable_data_planning_cannot_reset_budget_through_fallback(self):
        import agent_agui
        body = {"threadId": "t", "runId": "r", "messages": [{"role": "user", "content": self.body()["question"]}], "state": {"offerIntelligence": {"version": 1, "language": "zh", "legacyParity": True}}}
        with patch.object(http, "call_llm_tools", return_value=None) as provider:
            events = list(agent_agui.generate_agui_events(body))
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(events[-1]["type"], "RUN_ERROR")
        self.assertFalse(any(event.get("name") == "oi.planning_fallback" for event in events))


if __name__ == "__main__":
    unittest.main()
