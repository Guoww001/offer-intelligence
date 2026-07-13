"""Recommendation intent skill — detects ranking / top-N / filtered-list queries."""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef

_VALID_METRIC_FIELDS = [
    "aov", "epc", "conversionRate", "orders", "clicks",
    "affCommission", "commissionRate", "salesAmount", "dpv", "atc",
]

_VALID_TIERS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]


class RecommendationSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "recommendation"

    def prompt_intent_section(self) -> str:
        return (
            "- recommendation: The query asks for recommendations, rankings, best/top "
            "offers, or filtered lists. In Chinese this includes "
            "推荐、排行、最好、最佳、优先、选品、主推.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "category": ParamDef(
                type="array",
                description="One or more product category names (canonical from known list). "
                "When the user mentions multiple categories (e.g. '美妆和电子', 'beauty and electronics'), "
                "return ALL as an array: ['beauty', 'electronics']. "
                "For a single category, still return an array: ['beauty'].",
            ),
            "tier": ParamDef(
                type="array",
                enum=_VALID_TIERS,
                description="One or more tier levels to filter by, used when ALL tiers "
                "share the same count (via the 'count' param). "
                "For a single tier, still return an array: ['Tier 1']. "
                "IMPORTANT: If EACH tier has its OWN count (e.g. '各5个', 'Tier1 3个 Tier2 5个'), "
                "use 'tierOfferPlan' instead — do NOT use 'tier'+'count'.",
            ),
            "includeTier4": ParamDef(
                type="bool",
                description="Whether to include Tier 4 offers",
            ),
            "includeBlack": ParamDef(
                type="bool",
                description="Whether to include BLACK TIER / blocked merchants",
            ),
            "count": ParamDef(
                type="int",
                description="Number of offers requested",
            ),
            "metricFilters": ParamDef(
                type="array",
                nested_schema={
                    "field": ParamDef(
                        type="str",
                        required=True,
                        enum=_VALID_METRIC_FIELDS,
                        description="Metric field name",
                    ),
                    "operator": ParamDef(
                        type="str",
                        required=True,
                        enum=[">", ">=", "<", "<="],
                        description="Comparison operator",
                    ),
                    "value": ParamDef(
                        type="int",
                        required=True,
                        description="Numeric threshold value",
                    ),
                },
                description="Metric comparison filters",
            ),
            "metricSort": ParamDef(
                type="object",
                nested_schema={
                    "field": ParamDef(
                        type="str",
                        required=True,
                        enum=_VALID_METRIC_FIELDS,
                        description="Metric field to sort by",
                    ),
                    "direction": ParamDef(
                        type="str",
                        required=True,
                        enum=["asc", "desc"],
                        description="Sort direction",
                    ),
                },
                description="Sort specification",
            ),
            "keywordSearch": ParamDef(
                type="str",
                description="Keyword/phrase to search for",
            ),
            "tierOfferPlan": ParamDef(
                type="array",
                nested_schema={
                    "tier": ParamDef(
                        type="str",
                        required=True,
                        enum=_VALID_TIERS,
                        description="Tier level",
                    ),
                    "count": ParamDef(
                        type="int",
                        required=True,
                        description="Number of offers for this tier",
                    ),
                },
                description="MANDATORY when the user asks for a DIFFERENT count PER tier. "
                "This means queries with '各N个' (each N), or any pattern where each tier "
                "gets its own count. Examples: 'Tier1和Tier2各推荐5个' → "
                "[{tier:'Tier 1',count:5},{tier:'Tier 2',count:5}]; "
                "'Tier1推荐3个，Tier2推荐5个' → "
                "[{tier:'Tier 1',count:3},{tier:'Tier 2',count:5}]. "
                "Do NOT use 'tier'+'count' for these — that would give all tiers the same count.",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="Show me top 5 electronics offers with aov above 100",
                output={
                    "intent": "recommendation",
                    "params": {
                        "category": "electronics",
                        "count": 5,
                        "metricFilters": [
                            {"field": "aov", "operator": ">", "value": 100}
                        ],
                    },
                },
            ),
            ExamplePair(
                query="tier1 推荐6个",
                output={
                    "intent": "recommendation",
                    "params": {"tier": "Tier 1", "count": 6},
                },
            ),
            ExamplePair(
                query="Tier 2 推荐10个",
                output={
                    "intent": "recommendation",
                    "params": {"tier": "Tier 2", "count": 10},
                },
            ),
            ExamplePair(
                query="Tier 1 前5个 aov最高的",
                output={
                    "intent": "recommendation",
                    "params": {
                        "tier": "Tier 1",
                        "count": 5,
                        "metricSort": {"field": "aov", "direction": "desc"},
                    },
                },
            ),
            ExamplePair(
                query="Tier2推荐10个",
                output={
                    "intent": "recommendation",
                    "params": {"tier": "Tier 2", "count": 10},
                },
            ),
            ExamplePair(
                query="Tier1和Tier2各推荐5个",
                output={
                    "intent": "recommendation",
                    "params": {
                        "tierOfferPlan": [
                            {"tier": "Tier 1", "count": 5},
                            {"tier": "Tier 2", "count": 5},
                        ],
                    },
                },
            ),
            ExamplePair(
                query="推荐Tier1和Tier2各5个",
                output={
                    "intent": "recommendation",
                    "params": {
                        "tierOfferPlan": [
                            {"tier": "Tier 1", "count": 5},
                            {"tier": "Tier 2", "count": 5},
                        ],
                    },
                },
            ),
            ExamplePair(
                query="Tier1推荐3个，Tier2推荐5个",
                output={
                    "intent": "recommendation",
                    "params": {
                        "tierOfferPlan": [
                            {"tier": "Tier 1", "count": 3},
                            {"tier": "Tier 2", "count": 5},
                        ],
                    },
                },
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["top", "best", "recommend", "ranking", "recommendation"],
            "zh": ["推荐", "排行", "最好", "最佳", "优先", "选品", "主推"],
        }


recommendation_skill = RecommendationSkill()
