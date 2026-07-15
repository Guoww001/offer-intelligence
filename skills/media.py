"""Media intent skill — detects affiliate media/publisher lookups."""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef


class MediaSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "media"

    def prompt_intent_section(self) -> str:
        return (
            "- media: The query asks about an affiliate media/publisher by name or "
            "numeric media ID. This includes queries like '查媒体Ofelia', "
            "'看看56号媒体的数据', 'media ofelia', 'publisher 56'.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "mediaName": ParamDef(
                type="str",
                description="The media/publisher name, e.g. ofelia, link",
            ),
            "mediaId": ParamDef(
                type="str",
                description="A numeric media/publisher ID, e.g. 56",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="查媒体Ofelia",
                output={"intent": "media", "params": {"mediaName": "ofelia"}},
            ),
            ExamplePair(
                query="media 56",
                output={"intent": "media", "params": {"mediaId": "56"}},
            ),
            ExamplePair(
                query="看看媒体的数据",
                output={"intent": "media", "params": {}},
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {
            "en": ["media", "publisher", "affiliate"],
            "zh": ["媒体", "媒介", "推广渠道"],
        }


media_skill = MediaSkill()
