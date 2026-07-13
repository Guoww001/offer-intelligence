"""Merchant intent skill — detects brand / merchant name or ID lookups."""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef


class MerchantSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "merchant"

    def prompt_intent_section(self) -> str:
        return (
            "- merchant: The query asks about a specific merchant/brand by name or by "
            "numeric merchant ID (5-8 digits). This includes queries like 'Shokz', "
            "'Aiper offers', '362938'.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "merchantName": ParamDef(
                type="str",
                description="The brand/merchant name mentioned, e.g. Shokz, Aiper",
            ),
            "merchantId": ParamDef(
                type="str",
                description="A 5-8 digit numeric merchant ID, e.g. 362938",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="hello",
                output={"intent": "merchant", "params": {}},
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["merchant", "brand", "offer"],
            "zh": ["商户", "品牌", "店铺", "商家"],
        }


merchant_skill = MerchantSkill()
