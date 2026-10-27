"""月度明细必须引用已验证工具事实，不交由模型重新计算。"""
import sys
import unittest
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent_contract


class MonthlyAnswerTests(unittest.TestCase):
    def test_比较品类时保持各自独立目标(self):
        calls = agent_contract.normalize_planning_tool_calls([{"name": "trend", "arguments": {"entityType": "category", "target": target}} for target in ["家具", "家居"]], "比较家具和家居的月度趋势", 1)
        self.assertEqual([call["arguments"]["target"] for call in calls], ["家具", "家居"])

    def test_当前明确品类在签名前覆盖历史目标(self):
        calls = agent_contract.normalize_planning_tool_calls([{"name": "trend", "arguments": {"entityType": "category", "target": "Furniture & Home", "startMonth": "2026-07", "endMonth": "2026-09"}}], "查询家居、厨具、家装2026年7-9月的整体月度数据", 1)
        self.assertEqual(calls[0]["arguments"]["target"], "家居、厨具、家装")

    def test_月度表保留基期环比和明确缺失比例(self):
        from agent_monthly_answer import verified_monthly_answer
        request = {"question": "按月列出GMV、点击、订单和环比，注明站点和币种", "language": "zh", "context": {}}
        results = [{"toolName": "trend", "result": {"ok": True, "data": {"target": "合成品类", "summary": {"latestMonthComplete": True}, "months": [{"month": "2026-07", "metrics": {"revenue": 200, "revenueMoM": 1, "clicks": 20, "orders": 2, "conversionRate": None}}]}}}]
        answer = verified_monthly_answer(request, results)
        self.assertIn("100.00%", answer)
        self.assertIn("未提供", answer)
        self.assertNotIn("10.00%", answer)
        self.assertNotIn("无上月数据", answer)
        self.assertIn("站点和币种：未提供", answer)

    def test_普通趋势解释保留现有综合流程(self):
        from agent_monthly_answer import verified_monthly_answer
        self.assertIsNone(verified_monthly_answer({"question": "分析趋势表现", "language": "zh"}, []))

    def test_两套综合入口校验证明后直接返回事实表(self):
        from scripts.test_agent_synthesis_contract import with_secret, invoke_stream_handlers
        def run():
            question = "按月列出GMV和环比"
            arguments = {"entityType": "merchant", "target": "合成商户", "months": 12}
            proof = agent_contract.issue_plan_proof("monthly-answer-test", question, [{"id": "r1c1", "name": "trend", "arguments": arguments}], int(time.time()) + 300)
            body = {"contractVersion": "v2", "agentRunId": "monthly-answer-test", "planProofs": [proof], "question": question, "language": "zh", "toolResults": [{"callId": "r1c1", "toolName": "trend", "arguments": arguments, "result": {"ok": True, "source": {"dataSource": "database", "dataAsOf": "2026-10-26T09:00:00Z", "estimated": False}, "data": {"target": "合成商户", "months": [{"month": "2026-07", "metrics": {"revenue": 200, "revenueMoM": 1, "clicks": 20, "orders": 2, "conversionRate": None}}]}}}]}
            targets, provider_calls = invoke_stream_handlers(body)
            self.assertEqual([target.status for target in targets], [200, 200])
            self.assertEqual(provider_calls, [])
            for target in targets:
                self.assertIn("100.00%", target.wfile.getvalue().decode("utf-8"))
        with_secret(run)


if __name__ == "__main__": unittest.main()
