"""Category intent skill — detects product-category queries."""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef


class CategorySkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "category"

    def prompt_intent_section(self) -> str:
        return (
            "- category: The query asks about offers in a product category "
            "(e.g. beauty, electronics, pet supplies). In Chinese this includes "
            "category aliases like 美妆、电子、宠物.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "category": ParamDef(
                type="array",
                required=True,
                description="One or more product category names (canonical from known list). "
                "When the user mentions multiple categories (e.g. '美妆和电子', 'beauty and electronics'), "
                "return ALL as an array: ['beauty', 'electronics'].",
            ),
            "tier": ParamDef(
                type="array",
                enum=["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"],
                description="One or more tier levels to filter by. "
                "When the user mentions a tier (e.g. 'tier2美妆' → ['Tier 2'], "
                "'Tier1和Tier2 electronics' → ['Tier 1', 'Tier 2']).",
            ),
            "includeTier4": ParamDef(
                type="bool",
                description="Whether to include Tier 4 offers",
            ),
            "includeBlack": ParamDef(
                type="bool",
                description="Whether to include BLACK TIER / blocked merchants",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="Show me beauty offers",
                output={
                    "intent": "category",
                    "params": {"category": "beauty"},
                },
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["category", "products in",
                   "beauty", "electronics", "pet", "home", "supplement", "outdoors"],
            "zh": ["品类", "分类", "美妆", "电子", "宠物"],
        }


category_skill = CategorySkill()
