"""Analysis text-generation skill — turns structured summaries into prose.

This skill handles the *follow-up LLM call* that generates natural-language
analysis narratives.  It is separate from the ``analysis`` intent classification
skill — this one produces text, not an intent label.
"""

from __future__ import annotations

import json

from skills.base import AnalysisSkill
from llm_provider import call_llm, _default_timeout  # no circular imports


class AnalysisTextSkill(AnalysisSkill):
    """Generates natural-language analysis narratives from structured summaries."""

    def build_system_prompt(self, language: str) -> str:
        """Build the analysis system prompt — migrated from the original
        ``_build_analysis_system_prompt()`` in ``llm_classify.py``."""
        lang_instruction = (
            "Write your analysis in Chinese (Simplified). Use a professional but "
            "conversational tone. Keep it between 200-400 characters."
            if language == "zh"
            else (
                "Write your analysis in English. Use a professional but conversational "
                "tone. Keep it between 150-300 words."
            )
        )
        return (
            "You are an Amazon affiliate marketing data analyst. A user has asked you to "
            "analyze performance data from an offer intelligence dashboard.\n\n"
            "You will receive a JSON object containing structured statistical summaries. "
            "Based on this data, write a concise analysis that includes:\n"
            "1. Overall assessment — a one-sentence summary of the entity's performance.\n"
            "2. Key strengths — what metrics stand out positively (with specific numbers).\n"
            "3. Areas of concern — what metrics are below expectations (with specific numbers).\n"
            "4. Actionable recommendations — 2-3 specific suggestions for the affiliate manager.\n\n"
            "Rules:\n"
            "- Only use the data provided. Do not fabricate numbers.\n"
            "- Be specific — mention actual values and comparisons (e.g. 'EPC of $2.35 is 30% "
            "above the category average of $1.80').\n"
            "- If certain data is missing or unavailable, skip that point rather than guessing.\n"
            "- Format your response as plain paragraphs, no markdown headings or bullet points.\n"
            "- Do NOT start with phrases like 'Here is the analysis' or 'Based on the data' — "
            "just give the analysis directly.\n"
            f"{lang_instruction}\n"
        )

    def generate(
        self, summary: dict, language: str = "en", timeout: float | None = None
    ) -> str | None:
        """Generate prose analysis from a structured summary.

        Uses the shared ``call_llm`` provider abstraction from ``llm_provider``
        so that DeepSeek / Claude switching works identically to intent
        classification — with no circular imports.
        """
        if timeout is None:
            timeout = _default_timeout()

        system_prompt = self.build_system_prompt(language)
        user_message = json.dumps(summary, ensure_ascii=False, indent=2)

        return call_llm(system_prompt, user_message, max_tokens=600, timeout=timeout)


analysis_text_skill = AnalysisTextSkill()
