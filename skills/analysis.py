"""Analysis intent skill — detects analysis / evaluation / diagnosis queries.

This skill handles *intent classification* for analysis queries (routing to the
analysisAnswer path).  The separate ``analysis_text.py`` skill handles the
follow-up LLM call that generates natural-language prose from structured data.
"""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef

_VALID_ANALYSIS_TYPES = ["merchant", "category", "tier", "trend"]


class AnalysisIntentSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "analysis"

    def prompt_intent_section(self) -> str:
        return (
            "- analysis: The query asks to analyze, evaluate, diagnose, or assess the "
            "performance of a merchant, category, or tier. This includes questions about "
            "how something is performing, health checks, trend assessment, comparisons, "
            "or promotion/demotion decisions. This also covers merchant comparison "
            "(comparing two or more merchants side-by-side), trend analysis "
            "(how metrics change over time), and diagnosis of what's improving or declining. "
            "In Chinese this includes "
            "分析、评估、诊断、怎么样、表现、趋势、健康度、状态、测测、看看、升级、降级、升降级、提升到、对比、比较.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "analysisType": ParamDef(
                type="str",
                enum=_VALID_ANALYSIS_TYPES,
                required=True,
                description="Type of analysis: merchant, category, tier, or trend",
            ),
            "analysisTarget": ParamDef(
                type="str",
                required=False,
                description="Name of a single entity to analyze (use for single-entity queries)",
            ),
            "analysisTargets": ParamDef(
                type="str[]",
                required=False,
                description=(
                    "Array of entity names for multi-entity comparison analysis. "
                    "Use when the user mentions multiple categories, tiers, or merchants "
                    "e.g. 'beauty and electronics', 'Tier 1 and Tier 2'."
                ),
            ),
            "trendMetric": ParamDef(
                type="str",
                enum=["revenue", "orders", "epc", "aov", "conversionRate", "clicks", "commission"],
                required=False,
                description="Specific metric to show trend for, or omit for all key metrics",
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
            # Merchant comparison example
            ExamplePair(
                query="对比 Shokz 和 Soundcore",
                output={
                    "intent": "analysis",
                    "params": {
                        "analysisType": "merchant",
                        "analysisTargets": ["Shokz", "Soundcore"],
                        "analysisTarget": "Shokz",
                    },
                },
            ),
            ExamplePair(
                query="compare merchant A with merchant B",
                output={
                    "intent": "analysis",
                    "params": {
                        "analysisType": "merchant",
                        "analysisTargets": ["merchant A", "merchant B"],
                        "analysisTarget": "merchant A",
                    },
                },
            ),
            # Trend analysis examples
            ExamplePair(
                query="分析Shokz近三个月",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "trend", "analysisTarget": "Shokz"},
                },
            ),
            ExamplePair(
                query="Shokz 过去3个月的revenue趋势",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "trend", "analysisTarget": "Shokz", "trendMetric": "revenue"},
                },
            ),
            ExamplePair(
                query="Tier 2 这个季度的订单趋势",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "trend", "analysisTarget": "Tier 2", "trendMetric": "orders"},
                },
            ),
            ExamplePair(
                query="Tier 2 的趋势",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "trend", "analysisTarget": "Tier 2"},
                },
            ),
            ExamplePair(
                query="分析Beauty类别的趋势",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "trend", "analysisTarget": "Beauty"},
                },
            ),
            ExamplePair(
                query="Electronics最近3个月的趋势",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "trend", "analysisTarget": "Electronics"},
                },
            ),
            ExamplePair(
                query="这个商户的EPC在涨还是跌",
                output={
                    "intent": "analysis",
                    "params": {"analysisType": "trend", "analysisTarget": "Shop name", "trendMetric": "epc"},
                },
            ),
            # Multi-entity examples
            ExamplePair(
                query="分析Tier2的beauty和electronics",
                output={
                    "intent": "analysis",
                    "params": {
                        "analysisType": "category",
                        "analysisTargets": ["Beauty", "Electronics"],
                        "analysisTarget": "Beauty",
                    },
                },
            ),
            ExamplePair(
                query="对比Tier 1和Tier 2的Beauty表现",
                output={
                    "intent": "analysis",
                    "params": {
                        "analysisType": "tier",
                        "analysisTargets": ["Tier 1", "Tier 2"],
                        "analysisTarget": "Tier 1",
                    },
                },
            ),
            ExamplePair(
                query="analyse beauty and electronics in Tier 2",
                output={
                    "intent": "analysis",
                    "params": {
                        "analysisType": "category",
                        "analysisTargets": ["Beauty", "Electronics"],
                        "analysisTarget": "Beauty",
                    },
                },
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["analyze", "analysis", "evaluate", "diagnose", "assess", "performance",
                   "health", "trend", "promotion", "demotion",
                   "how is", "status", "check", "upgrade", "downgrade",
                   "compare", "comparison", "vs", "versus"],
            "zh": ["分析", "评估", "诊断", "怎么样", "表现", "趋势", "健康度",
                   "状态", "测测", "看看", "升级", "降级", "升降级", "提升到",
                   "对比", "比较", "和.*对比", "与.*相比"],
        }


analysis_intent_skill = AnalysisIntentSkill()
