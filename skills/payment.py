"""Payment intent skill — detects payment status / cycle / commission queries."""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef


class PaymentSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "payment"

    def prompt_intent_section(self) -> str:
        return (
            "- payment: The query asks about payment status, unpaid/paid/overdue/pending "
            "amounts, payment cycles, or commissions. In Chinese this includes "
            "付款、未付款、已付款、逾期、到期、待处理、佣金、结算、收款.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "merchantName": ParamDef(
                type="str",
                description="Brand/merchant name for payment lookup",
            ),
            "month": ParamDef(
                type="str",
                description="Month name like January, February, etc.",
            ),
            "paymentStatus": ParamDef(
                type="str",
                enum=["unpaid", "paid", "pending", "partial", "overdue"],
                description="Payment status filter",
            ),
            "paymentCycleFilter": ParamDef(
                type="object",
                nested_schema={
                    "operator": ParamDef(
                        type="str",
                        enum=[">", ">=", "<", "<="],
                        description="Comparison operator for payment cycle days",
                    ),
                    "threshold": ParamDef(
                        type="int",
                        description="Number of days threshold",
                    ),
                },
                description="Payment cycle duration filter",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="Shokz payment status",
                output={
                    "intent": "payment",
                    "params": {"merchantName": "Shokz"},
                },
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["payment", "paid", "unpaid", "overdue", "pending", "commission"],
            "zh": [
                "付款", "未付款", "已付款", "逾期", "到期", "待处理",
                "佣金", "结算", "收款", "支付",
            ],
        }


payment_skill = PaymentSkill()
