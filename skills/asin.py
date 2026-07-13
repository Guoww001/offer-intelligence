"""ASIN intent skill — detects Amazon Standard Identification Number queries."""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef


class AsinSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "asin"

    def prompt_intent_section(self) -> str:
        return (
            "- asin: The query contains a 10-character ASIN starting with 'B' "
            "(e.g. B0D2HKCMBP).\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "asin": ParamDef(
                type="array",
                required=True,
                description="One or more 10-character ASINs starting with 'B', "
                "e.g. B0D2HKCMBP. When the user mentions multiple ASINs, "
                "return ALL as an array: ['B0D2HKCMBP', 'B0ABC12345'].",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="B0D2HKCMBP",
                output={"intent": "asin", "params": {"asin": ["B0D2HKCMBP"]}},
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {"en": ["B0"], "zh": []}


asin_skill = AsinSkill()
