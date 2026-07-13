"""Analysis intent skill — detects analysis / evaluation / diagnosis queries.

This skill handles *intent classification* for analysis queries (routing to the
analysisAnswer path).  The separate ``analysis_text.py`` skill handles the
follow-up LLM call that generates natural-language prose from structured data.
"""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef

_VALID_ANALYSIS_TYPES = ["merchant", "category", "tier"]


class AnalysisIntentSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "analysis"

    def prompt_intent_section(self) -> str:
        return (
            "- analysis: The query asks to analyze, evaluate, diagnose, or assess the "
            "performance of a merchant, category, or tier. This includes questions about "
            "how something is performing, health checks, trend assessment, comparisons, "
            "or promotion/demotion decisions. In Chinese this includes "
            "分析、评估、诊断、怎么样、表现、趋势、健康度、状态、测测、看看、升级、降级、升降级、提升到.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "analysisType": ParamDef(
                type="str",
                enum=_VALID_ANALYSIS_TYPES,
                required=True,
                description="Type of analysis: merchant, category, or tier",
            ),
            "analysisTarget": ParamDef(
                type="str",
                required=True,
                description="Name of the entity to analyze",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="分析 Shokz",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "merchant", "analysisTarget": "Shokz"},
                },
            ),
            ExamplePair(
                query="how is Electronics doing?",
                output={
                    "intent": "analysis",
                    "params": {
                        "analysisType": "category",
                        "analysisTarget": "electronics",
                    },
                },
            ),
            ExamplePair(
                query="Tier 2 整体表现怎么样",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "tier", "analysisTarget": "Tier 2"},
                },
            ),
            ExamplePair(
                query="哪些Tier2要升Tier1",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "tier", "analysisTarget": "Tier 2"},
                },
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["analyze", "analysis", "evaluate", "diagnose", "assess", "performance",
                   "health", "trend", "promotion", "demotion"],
            "zh": ["分析", "评估", "诊断", "怎么样", "表现", "趋势", "健康度",
                   "状态", "测测", "看看", "升级", "降级", "升降级", "提升到"],
        }


analysis_intent_skill = AnalysisIntentSkill()
