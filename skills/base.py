"""Skill base classes and registry for the modular intent classification system.

Each intent (asin, merchant, payment, recommendation, tier, category) is
represented as an IntentSkill subclass that self-describes its prompt fragment,
parameter schema, validation rules, and few-shot examples.

The AnalysisSkill is a separate abstraction for the analysis text-generation
LLM call — it shares provider infrastructure but is not an intent classifier.
"""

from __future__ import annotations

import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


# ── data classes ────────────────────────────────────────────────────────────


@dataclass
class ParamDef:
    """Defines a single parameter that an intent skill expects to extract.

    This is the single source of truth — it drives both the system-prompt
    description AND the response-validation logic.
    """

    type: str  # "str" | "int" | "bool" | "object" | "array"
    required: bool = False
    enum: list[str] | None = None  # allowed values for str/enum params
    nested_schema: dict[str, ParamDef] | None = None  # for object / array[object]
    description: str = ""  # human-readable, reused in prompt


@dataclass
class ExamplePair:
    """A single few-shot example: user query → expected JSON output."""

    query: str
    output: dict[str, Any]


# ── abstract skill bases ────────────────────────────────────────────────────


class IntentSkill(ABC):
    """Abstract base for an intent-classification skill.

    Subclasses must provide:
    - intent: the canonical intent label (e.g. "payment")
    - prompt_intent_section(): a paragraph describing the intent for the LLM
    - param_schema(): a mapping of param-name → ParamDef for validation
    - examples(): a list of ExamplePair for few-shot prompting
    - fallback_keywords(): optional dict of keywords for the JS regex fallback

    Parameter descriptions in the system prompt are generated automatically
    from ``param_schema()`` — there is no separate ``prompt_params_section()``.
    """

    @property
    @abstractmethod
    def intent(self) -> str:
        """Canonical intent label, e.g. 'payment', 'recommendation'."""
        ...

    @abstractmethod
    def prompt_intent_section(self) -> str:
        """Return the intent-definition paragraph inserted into the system prompt.

        Should include the intent label, what kinds of queries match, and
        relevant Chinese / English keywords.
        """
        ...

    @abstractmethod
    def param_schema(self) -> dict[str, ParamDef]:
        """Return the parameter schema that drives response validation.

        Keys are the JSON field names the LLM may return in ``params``.
        """
        ...

    @abstractmethod
    def examples(self) -> list[ExamplePair]:
        """Return few-shot examples for this intent (at least 2-3)."""
        ...

    def fallback_keywords(self) -> dict[str, list[str]]:
        """Return keyword lists for the JS regex fallback layer (optional).

        Keys are language codes ('en', 'zh'); values are lists of keywords.
        """
        return {}


class AnalysisSkill(ABC):
    """Abstract base for the analysis text-generation skill.

    This is NOT an intent classifier — it is a separate LLM call that
    transforms a structured statistical summary into natural-language prose.
    It shares the provider / timeout / error-handling infrastructure with
    the intent-classification path.
    """

    @abstractmethod
    def build_system_prompt(self, language: str) -> str:
        """Build the system prompt for the analysis LLM call."""
        ...

    @abstractmethod
    def generate(
        self, summary: dict, language: str = "en", timeout: float | None = None
    ) -> str | None:
        """Generate a natural-language analysis narrative from a summary dict.

        Returns the generated text, or None if the call fails.
        """
        ...


# ── registry ────────────────────────────────────────────────────────────────


class SkillRegistry:
    """Central registry for intent-classification skills and the analysis skill.

    Skills auto-register on import (see ``skills/__init__.py``).  The registry
    is a module-level singleton — import ``registry`` from this module.
    """

    def __init__(self) -> None:
        self._intent_skills: dict[str, IntentSkill] = {}
        self._analysis_skill: AnalysisSkill | None = None

    # -- intent skills --------------------------------------------------------

    def register(self, skill: IntentSkill) -> None:
        if skill.intent in self._intent_skills:
            print(
                f"[skills] WARNING: overwriting intent '{skill.intent}' "
                f"({type(self._intent_skills[skill.intent]).__name__} → {type(skill).__name__})",
                file=sys.stderr,
            )
        self._intent_skills[skill.intent] = skill
        print(f"[skills] registered intent: {skill.intent}", file=sys.stderr)

    def get(self, intent: str) -> IntentSkill | None:
        return self._intent_skills.get(intent)

    def list_all(self) -> list[IntentSkill]:
        """Return all registered intent skills (order is insertion order)."""
        return list(self._intent_skills.values())

    def list_intents(self) -> list[str]:
        """Return all registered intent labels (can be used to derive VALID_INTENTS)."""
        return list(self._intent_skills.keys())

    # -- analysis skill -------------------------------------------------------

    def register_analysis(self, skill: AnalysisSkill) -> None:
        self._analysis_skill = skill
        print(f"[skills] registered analysis: {type(skill).__name__}", file=sys.stderr)

    def get_analysis(self) -> AnalysisSkill | None:
        return self._analysis_skill


# Module-level singleton — import this everywhere.
registry = SkillRegistry()
