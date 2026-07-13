"""Tier intent skill — detects tier-level queries (Tier 1-4, BLACK TIER)."""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef

_VALID_TIERS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]


class TierSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "tier"

    def prompt_intent_section(self) -> str:
        return (
            "- tier: The query asks about a specific tier level (Tier 1-4 or BLACK TIER). "
            "In Chinese this includes 第一层/级、Tier 1、黑名单.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "tier": ParamDef(
                type="array",
                enum=_VALID_TIERS,
                required=True,
                description="One or more tier levels being queried. "
                "When the user mentions multiple tiers (e.g. 'Tier1和Tier2', 'Tier 1 and Tier 2'), "
                "return ALL as an array: ['Tier 1', 'Tier 2']. "
                "For a single tier, still return an array: ['Tier 1'].",
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
                query="Show me Tier 1",
                output={"intent": "tier", "params": {"tier": "Tier 1"}},
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["tier", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"],
            "zh": ["第一层", "第二层", "第三层", "第四层", "黑名单", "层级"],
        }


tier_skill = TierSkill()
