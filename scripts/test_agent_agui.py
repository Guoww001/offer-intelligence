import os
import json
import time
import unittest
from unittest.mock import patch
from io import BytesIO
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import agent_agui
import auth
from agent_contract import issue_plan_proof


class FakeTarget:
    def __init__(self, headers=None, body=b""):
        self.headers = {"Host": "127.0.0.1", **(headers or {})}
        self.rfile = BytesIO(body)
        self.wfile = BytesIO()
        self.status = None
        self.response_headers = []

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.response_headers.append((name, value))

    def end_headers(self):
        return None


class AgentAguiTests(unittest.TestCase):
    def test_keyword_brand_recommendation_requires_verified_data(self):
        self.assertTrue(agent_agui._requires_verifiable_data("vacuum cleaner brand recommendation"))
        self.assertTrue(agent_agui._requires_verifiable_data("/keyword vacuum cleaner"))
        self.assertFalse(agent_agui._requires_verifiable_data("what is keyword search"))

    def test_asin_followup_context_reaches_planning(self):
        body = self.body()
        asins = ["B0D2HKCMBP", "B09BVXT8TJ"]
        body["state"]["offerIntelligence"]["asinContext"] = asins
        with patch("agent_agui.plan_agent_request", return_value=(200, {"ok": True, "content": "test", "toolCalls": []})) as planning:
            list(agent_agui.generate_agui_events(body))
        self.assertEqual(planning.call_args.args[0]["asinContext"], asins)

    def test_six_top_asin_results_flow_through_two_batches_and_signed_synthesis(self):
        merchants = [("406220", "AOCHUAN"), ("362448", "Midland Radio"), ("380928", "DS18"),
                     ("384704", "ISOtunes"), ("385315", "SABRENT"), ("362602", "Productech")]
        question = "\n".join("\t".join(row) for row in merchants) + "；以上商家的top asin可以帮我提取吗"
        calls = [{"id": f"r1c{i+1}", "name": "merchant_analysis", "arguments": {"merchant": mid, "view": "top_asins"}}
                 for i, (mid, _) in enumerate(merchants)]
        run_id = "ar_top_asins_12345678"
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "top-asins-test-secret"}):
            proof = issue_plan_proof(run_id, question, calls, int(time.time()) + 60)
            body = self.body()
            body["messages"] = [{"id": "user-1", "role": "user", "content": question}]
            with patch("agent_agui.plan_agent_request", return_value=(200, {"ok": True, "agentRunId": run_id, "planProof": proof, "toolCalls": calls})):
                events = list(agent_agui.generate_agui_events(body))
            self.assertEqual(sum(e["type"] == "TOOL_CALL_START" for e in events), 4)
            body["state"] = next(e["snapshot"] for e in events if e["type"] == "STATE_SNAPSHOT")

            def add_results(first, last):
                for i in range(first, last):
                    mid, name = merchants[i]
                    data = {"merchant": {"id": mid, "name": name}, "topAsins": [f"B00000000{i}"],
                            "asinRanking": {"status": "available", "basis": "unknown", "limit": 5, "returned": 1,
                                            "version": None, "startDate": None, "endDate": None, "dataAsOf": None}}
                    body["messages"].append({"id": f"tool-{i}", "role": "tool", "toolCallId": calls[i]["id"],
                        "content": json.dumps({"toolResult": {"result": {"ok": True, "data": data,
                            "source": {"dataSource": "cache", "dataAsOf": None, "estimated": False}}}})})

            add_results(0, 4)
            events = list(agent_agui.generate_agui_events(body))
            self.assertEqual([e["toolCallId"] for e in events if e["type"] == "TOOL_CALL_START"], ["r1c5", "r1c6"])
            body["state"] = next(e["snapshot"] for e in events if e["type"] == "STATE_SNAPSHOT")
            add_results(4, 6)
            captured = []

            def stream(_prompt, _system, **kwargs):
                captured.append(kwargs["messages"][-1]["content"])
                kwargs["on_complete"]({"provider": "test"})
                yield "六家商家的 Top ASIN"

            events = list(agent_agui.generate_agui_events(body, 100, stream))
            self.assertEqual(events[-1]["type"], "RUN_FINISHED")
            self.assertEqual(len(captured), 1)
            for i, (mid, name) in enumerate(merchants):
                self.assertIn(mid, captured[0])
                self.assertIn(name, captured[0])
                self.assertIn(f"B00000000{i}", captured[0])

    def test_local_server_exposes_the_same_agui_route_as_vercel(self):
        source = (ROOT / "server.py").read_text(encoding="utf-8")
        self.assertIn("from agent_agui import handle_agui_request", source)
        for method in ("GET", "OPTIONS", "POST"):
            self.assertIn(
                f'if parsed.path == "/api/chat/agui":\n            handle_agui_request(self, "{method}")',
                source,
            )

    @patch("agent_agui.plan_agent_request")
    def test_parity_delegates_no_tool_outcome_to_shared_source_policy(self, planning):
        planning.return_value = (200, {"ok": True, "content": "Unverified revenue 999", "toolCalls": []})
        body = self.body()
        body["state"]["offerIntelligence"]["legacyParity"] = True
        events = list(agent_agui.generate_agui_events(body))
        self.assertFalse(any(event["type"] == "TEXT_MESSAGE_CONTENT" for event in events))
        fallback = next(event for event in events if event.get("name") == "oi.planning_fallback")
        self.assertEqual(fallback["value"]["content"], "Unverified revenue 999")
        self.assertEqual(events[-1]["type"], "RUN_FINISHED")

    @patch("agent_agui.plan_agent_request")
    def test_unavailable_planning_cannot_reset_budget_for_conceptual_question(self, planning):
        planning.return_value = (200, {"ok": False, "errorCode": "agent_planning_unavailable"})
        body = self.body()
        body["messages"] = [{"role": "user", "content": "什么是EPC"}]
        body["state"]["offerIntelligence"]["legacyParity"] = True
        events = list(agent_agui.generate_agui_events(body))
        self.assertFalse(any(event.get("name") == "oi.planning_fallback" for event in events))
        self.assertEqual(planning.call_count, 2)
        self.assertEqual(events[-1]["type"], "RUN_ERROR")

    @patch("agent_agui.plan_agent_request")
    def test_initial_planning_retries_once_after_a_transient_unavailable_result(self, planning):
        planning.side_effect = [
            (200, {"ok": False, "errorCode": "agent_planning_unavailable"}),
            (200, {
                "ok": True,
                "agentRunId": "ar_retry_agui_1234",
                "planProof": "proof",
                "toolCalls": [{"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "Tapo"}}],
            }),
        ]
        events = list(agent_agui.generate_agui_events(self.body()))
        self.assertEqual(planning.call_count, 2)
        self.assertTrue(any(event.get("name") == "oi.timeline" and event["value"]["step"]["id"] == "planning-retry" for event in events))
        self.assertEqual(events[-1]["type"], "RUN_FINISHED")
        self.assertEqual(events[-1]["result"]["status"], "tools")

    @patch("agent_agui.plan_agent_request")
    def test_parity_preserves_prepared_history_in_continuation_state(self, planning):
        planning.return_value = (200, {"ok": True, "agentRunId": "fixture", "planProof": "proof", "toolCalls": [
            {"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "Tapo"}}
        ]})
        body = self.body()
        history = [{"role": "assistant", "content": "EPC: 1.2"}]
        body["state"]["offerIntelligence"].update({"legacyParity": True, "history": history, "memory": "Tier 2"})
        events = list(agent_agui.generate_agui_events(body))
        state = next(event["snapshot"]["offerIntelligence"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(state["history"], history)
        self.assertEqual(state["memory"], "Tier 2")

    @patch("agent_agui.plan_agent_request")
    def test_promotion_context_is_preserved_and_tool_is_hidden_without_it(self, planning):
        planning.return_value = (200, {
            "ok": True,
            "agentRunId": "ar_promotion_agui",
            "planProof": "proof",
            "toolCalls": [{"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "First merchant"}}],
        })
        plain_events = list(agent_agui.generate_agui_events(self.body()))
        plain_request = planning.call_args.args[0]
        self.assertNotIn("promotion_analysis", plain_request["enabledTools"])
        self.assertNotIn("promotionContext", plain_request)
        self.assertNotIn("promotionContext", next(event["snapshot"]["offerIntelligence"] for event in plain_events if event["type"] == "STATE_SNAPSHOT"))

        context = {
            "attachmentId": "attachment-a",
            "fileName": "campaign.csv",
            "merchantCount": 1,
            "merchants": [{"merchantId": "101", "merchantName": "First merchant"}],
            "window": {
                "launchDate": "2026-09-07",
                "startDate": "2026-09-07",
                "endDate": "2026-09-13",
                "beforeStart": "2026-08-31",
                "beforeEnd": "2026-09-06",
                "days": 7,
            },
        }
        body = self.body()
        body["state"]["offerIntelligence"]["promotionContext"] = context
        context_events = list(agent_agui.generate_agui_events(body))
        context_request = planning.call_args.args[0]
        self.assertIn("promotion_analysis", context_request["enabledTools"])
        self.assertEqual(context_request["promotionContext"], context)
        context_state = next(event["snapshot"]["offerIntelligence"] for event in context_events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(context_state["promotionContext"], context)

    def body(self):
        return {
            "threadId": "thread-1",
            "runId": "run-1",
            "messages": [{"id": "user-1", "role": "user", "content": "查询商户数据"}],
            "state": {"offerIntelligence": {"version": 1, "status": "planning", "language": "zh", "memory": ""}},
        }

    @patch("agent_agui.plan_agent_request")
    def test_direct_answer_has_one_terminal_event(self, planning):
        planning.return_value = (200, {
            "ok": True,
            "agentRunId": "ar_test",
            "content": "可以先明确指标。",
            "toolCalls": [],
        })
        events = list(agent_agui.generate_agui_events(self.body(), 100))
        self.assertEqual(events[0]["type"], "RUN_STARTED")
        self.assertEqual(events[-1]["type"], "RUN_FINISHED")
        self.assertEqual(sum(event["type"] in {"RUN_FINISHED", "RUN_ERROR"} for event in events), 1)
        self.assertIn("可验证", next(event["delta"] for event in events if event["type"] == "TEXT_MESSAGE_CONTENT"))

    @patch("agent_agui.plan_agent_request")
    def test_tools_are_emitted_in_bounded_batches(self, planning):
        calls = [
            {"id": f"r1c{index}", "name": "merchant_analysis", "arguments": {"merchant": f"M{index}"}}
            for index in range(1, 7)
        ]
        planning.return_value = (200, {
            "ok": True,
            "agentRunId": "ar_test",
            "planProof": "signed-proof",
            "toolCalls": calls,
        })
        events = list(agent_agui.generate_agui_events(self.body(), 100))
        self.assertEqual(sum(event["type"] == "TOOL_CALL_START" for event in events), 4)
        snapshot = next(event["snapshot"] for event in events if event["type"] == "STATE_SNAPSHOT")
        self.assertEqual(len(snapshot["offerIntelligence"]["calls"]), 6)
        self.assertEqual(events[-1]["result"]["status"], "tools")

    def test_internal_adapter_reuses_existing_session_secret(self):
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "shared-secret"}, clear=True):
            self.assertTrue(agent_agui.is_internal_request({"X-OI-Copilot-Token": "shared-secret"}))
            self.assertFalse(agent_agui.is_internal_request({"X-OI-Copilot-Token": "wrong"}))

    def test_internal_token_alone_cannot_bypass_user_session(self):
        with patch.dict(os.environ, {
            "OI_AUTH_ENABLED": "1",
            "OI_SESSION_SECRET": "shared-secret",
            "VERCEL_ENV": "preview",
            "OFFER_DB_HOST": "db.example.test",
            "OFFER_DB_NAME": "offer_intelligence",
            "OFFER_DB_USER": "readonly",
            "OFFER_DB_PASSWORD": os.urandom(12).hex(),
        }, clear=True):
            target = FakeTarget({
                "X-OI-Copilot-Token": "shared-secret",
                "Content-Length": "0",
            })
            agent_agui.handle_agui_request(target, "POST")
            self.assertEqual(target.status, 401)

    def test_python_agui_denies_level_two_before_reading_request_body(self):
        with patch.dict(os.environ, {
            "OI_AUTH_ENABLED": "1",
            "OI_SESSION_SECRET": "shared-secret",
            "VERCEL_ENV": "preview",
            "OFFER_DB_HOST": "db.example.test",
            "OFFER_DB_NAME": "offer_intelligence",
            "OFFER_DB_USER": "readonly",
            "OFFER_DB_PASSWORD": os.urandom(12).hex(),
        }, clear=True):
            cookie, _ = auth.create_session("limited")
            row = {
                "id": 2,
                "username": "limited",
                "display_name": "Limited",
                "email": "limited@example.test",
                "password_hash": auth.make_password_hash(os.urandom(12).hex(), iterations=1_000, salt="agui-salt"),
                "level": 2,
                "is_active": 1,
            }
            with patch("auth.user_record_by_username", return_value=row):
                target = FakeTarget({
                    "X-OI-Copilot-Token": "shared-secret",
                    "Cookie": f"oi_session={cookie}",
                    "Content-Length": "999",
                }, body=b"not-read")
                agent_agui.handle_agui_request(target, "POST")
            self.assertEqual(target.status, 403)

    def test_continuation_synthesizes_only_a_proof_bound_result(self):
        call = {"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "Tapo"}}
        agent_run_id = "ar_1234567890123456"
        question = "查询 Tapo 数据"
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "shared-secret"}, clear=True):
            proof = issue_plan_proof(agent_run_id, question, [call], int(time.time()) + 60)
            body = {
                "threadId": "thread-1",
                "runId": "run-2",
                "messages": [
                    {"id": "user-1", "role": "user", "content": question},
                    {
                        "id": "tool-1",
                        "role": "tool",
                        "toolCallId": "r1c1",
                        "content": json.dumps({
                            "toolResult": {
                                "callId": "client-value-is-ignored",
                                "toolName": "merchant_analysis",
                                "arguments": {"merchant": "Tapo"},
                                "result": {
                                    "ok": True,
                                    "source": {"dataSource": "cache", "dataAsOf": None, "estimated": False},
                                    "data": {"merchant": "Tapo"},
                                },
                            }
                        }),
                    },
                ],
                "state": {"offerIntelligence": {
                    "version": 1,
                    "status": "tools",
                    "question": question,
                    "language": "zh",
                    "memory": "",
                    "history": [],
                    "agentRunId": agent_run_id,
                    "planProofs": [proof],
                    "calls": [call],
                    "round": 1,
                }},
            }

            def fake_stream(_prompt, _system, **kwargs):
                self.assertIn("Tapo", kwargs["messages"][-1]["content"])
                kwargs["on_complete"]({"provider": "test", "model": "test-model"})
                yield "Tapo result"

            events = list(agent_agui.generate_agui_events(body, 100, fake_stream))
        self.assertEqual(events[-1]["type"], "RUN_FINISHED")
        self.assertIn("Tapo result", "".join(event.get("delta", "") for event in events))
        self.assertEqual(sum(event["type"] in {"RUN_FINISHED", "RUN_ERROR"} for event in events), 1)

    def test_synthesis_provider_failure_is_a_run_error(self):
        call = {"id": "r1c1", "name": "merchant_analysis", "arguments": {"merchant": "Tapo"}}
        agent_run_id = "ar_1234567890123456"
        question = "查询 Tapo 数据"
        with patch.dict(os.environ, {"OI_SESSION_SECRET": "shared-secret"}, clear=True):
            proof = issue_plan_proof(agent_run_id, question, [call], int(time.time()) + 60)
            body = {
                "threadId": "thread-1",
                "runId": "run-2",
                "messages": [
                    {"id": "user-1", "role": "user", "content": question},
                    {"id": "tool-1", "role": "tool", "toolCallId": "r1c1", "content": json.dumps({
                        "toolResult": {
                            "result": {
                                "ok": True,
                                "source": {"dataSource": "cache", "dataAsOf": None, "estimated": False},
                                "data": {"merchant": "Tapo"},
                            }
                        }
                    })},
                ],
                "state": {"offerIntelligence": {
                    "version": 1,
                    "status": "tools",
                    "question": question,
                    "language": "zh",
                    "memory": "",
                    "history": [],
                    "agentRunId": agent_run_id,
                    "planProofs": [proof],
                    "calls": [call],
                    "round": 1,
                }},
            }

            def unavailable_stream(_prompt, _system, **kwargs):
                kwargs["on_complete"]({"ok": False, "errorCode": "llm_unavailable"})
                yield from ()

            events = list(agent_agui.generate_agui_events(body, 100, unavailable_stream))
        self.assertEqual(events[-1]["type"], "RUN_ERROR")
        self.assertEqual(events[-1]["code"], "llm_unavailable")
        self.assertEqual(sum(event["type"] in {"RUN_FINISHED", "RUN_ERROR"} for event in events), 1)


if __name__ == "__main__":
    unittest.main()
