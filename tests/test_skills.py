"""Unit tests for the modular skill system.

Run with: python tests/test_skills.py
"""

import sys
import os

# Ensure we can import from the project root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import skills
from skills.base import registry, IntentSkill, ParamDef, ExamplePair, AnalysisSkill
from llm_classify import (_build_system_prompt, _build_router_prompt, _build_skill_prompt,
                          _parse_response, _parse_intent_only, _parse_params_only,
                          VALID_INTENTS, _validate_param_value)


EXPECTED_INTENTS = {"asin", "merchant", "payment", "recommendation", "tier", "category", "analysis"}


# ── Registry ─────────────────────────────────────────────────────────────────

def test_registry_all_intents_present():
    """Verify all 7 intents are registered."""
    registered = set(registry.list_intents())
    assert registered == EXPECTED_INTENTS, f"Missing intents: {EXPECTED_INTENTS - registered}, extra: {registered - EXPECTED_INTENTS}"
    print("  PASS test_registry_all_intents_present")


def test_each_skill_has_prompt_section():
    """Every skill must return a non-empty intent prompt section."""
    for skill in registry.list_all():
        section = skill.prompt_intent_section()
        assert section, f"{skill.intent}: prompt_intent_section() returned empty string"
        assert len(section) > 10, f"{skill.intent}: prompt_intent_section() too short: {section!r}"
    print("  PASS test_each_skill_has_prompt_section")


def test_each_skill_has_param_schema():
    """Every skill must return a non-empty param schema."""
    for skill in registry.list_all():
        schema = skill.param_schema()
        assert isinstance(schema, dict), f"{skill.intent}: param_schema() did not return dict"
        for pname, pdef in schema.items():
            assert isinstance(pdef, ParamDef), f"{skill.intent}.{pname}: not a ParamDef"
            assert pdef.type in ("str", "int", "bool", "object", "array"), \
                f"{skill.intent}.{pname}: unknown type {pdef.type!r}"
    print("  PASS test_each_skill_has_param_schema")


def test_each_skill_has_examples():
    """Every skill must return at least one example."""
    for skill in registry.list_all():
        examples = skill.examples()
        assert isinstance(examples, list), f"{skill.intent}: examples() did not return list"
        assert len(examples) >= 1, f"{skill.intent}: expected >=1 examples, got {len(examples)}"
        for ex in examples:
            assert ex.query, f"{skill.intent}: example has empty query"
            assert isinstance(ex.output, dict), f"{skill.intent}: example output is not dict"
            assert "intent" in ex.output, f"{skill.intent}: example output missing 'intent'"
    print("  PASS test_each_skill_has_examples")


def test_analysis_skill_registered():
    """The analysis text-generation skill must be registered."""
    analysis = registry.get_analysis()
    assert analysis is not None, "No AnalysisSkill registered"
    assert isinstance(analysis, AnalysisSkill), f"Not an AnalysisSkill: {type(analysis).__name__}"
    # Verify it can build prompts for both languages.
    en_prompt = analysis.build_system_prompt("en")
    zh_prompt = analysis.build_system_prompt("zh")
    assert len(en_prompt) > 100, f"English prompt too short: {len(en_prompt)}"
    assert len(zh_prompt) > 100, f"Chinese prompt too short: {len(zh_prompt)}"
    assert "English" in en_prompt, "English prompt should mention 'English'"
    assert "Chinese" in zh_prompt, "Chinese prompt should mention 'Chinese'"
    print("  PASS test_analysis_skill_registered")


# ── Prompt assembly ──────────────────────────────────────────────────────────

def test_build_system_prompt_contains_all_intents():
    """The assembled prompt must reference every registered intent."""
    prompt = _build_system_prompt(["electronics", "beauty"])
    for intent in EXPECTED_INTENTS:
        assert intent in prompt.lower(), f"Intent '{intent}' not found in system prompt"
    print("  PASS test_build_system_prompt_contains_all_intents")


def test_valid_intents_from_registry():
    """VALID_INTENTS must match the registry."""
    assert set(VALID_INTENTS) == EXPECTED_INTENTS, \
        f"VALID_INTENTS mismatch: {set(VALID_INTENTS)} vs {EXPECTED_INTENTS}"
    print("  PASS test_valid_intents_from_registry")


# ── Response parsing ─────────────────────────────────────────────────────────

def test_parse_response_valid_json():
    """Valid JSON with correct intent/params must parse successfully."""
    # Recommendation
    result = _parse_response(
        '{"intent": "recommendation", "params": {"tier": "Tier 2", "count": 10}}'
    )
    assert result is not None, "Failed to parse valid recommendation JSON"
    assert result["intent"] == "recommendation"
    assert result["params"]["tier"] == "Tier 2"
    assert result["params"]["count"] == 10

    # Payment
    result = _parse_response(
        '{"intent": "payment", "params": {"merchantName": "Shokz"}}'
    )
    assert result is not None, "Failed to parse valid payment JSON"
    assert result["intent"] == "payment"
    assert result["params"]["merchantName"] == "Shokz"

    # ASIN
    result = _parse_response(
        '{"intent": "asin", "params": {"asin": "B0D2HKCMBP"}}'
    )
    assert result is not None, "Failed to parse valid ASIN JSON"
    assert result["intent"] == "asin"
    assert result["params"]["asin"] == "B0D2HKCMBP"

    # Analysis
    result = _parse_response(
        '{"intent": "analysis", "params": {"analysisType": "merchant", "analysisTarget": "Shokz"}}'
    )
    assert result is not None, "Failed to parse valid analysis JSON"
    assert result["intent"] == "analysis"
    assert result["params"]["analysisType"] == "merchant"

    print("  PASS test_parse_response_valid_json")


def test_parse_response_invalid_enum():
    """Invalid enum values must be filtered out by schema validation."""
    # paymentStatus with invalid value
    result = _parse_response(
        '{"intent": "payment", "params": {"paymentStatus": "completed"}}'
    )
    assert result is not None, "Failed to parse at all"
    assert "paymentStatus" not in result["params"], \
        f"'completed' is not a valid paymentStatus, should be filtered. Got: {result['params']}"

    # tier with invalid value
    result = _parse_response(
        '{"intent": "recommendation", "params": {"tier": "Tier 5"}}'
    )
    assert result is not None
    assert "tier" not in result["params"], \
        f"'Tier 5' is not a valid tier, should be filtered. Got: {result['params']}"

    print("  PASS test_parse_response_invalid_enum")


def test_parse_response_invalid_json():
    """Gibberish / non-JSON must return None."""
    assert _parse_response("not json at all") is None
    assert _parse_response("") is None
    assert _parse_response('{"intent": "nonexistent"}') is None
    print("  PASS test_parse_response_invalid_json")


def test_parse_response_markdown_fence():
    """Markdown-fenced JSON must be stripped and parsed."""
    result = _parse_response(
        '```json\n{"intent": "merchant", "params": {}}\n```'
    )
    assert result is not None
    assert result["intent"] == "merchant"
    print("  PASS test_parse_response_markdown_fence")


def test_parse_response_metric_filters():
    """Complex nested params (metricFilters) must validate correctly."""
    result = _parse_response(
        '{"intent": "recommendation", "params": {'
        '"metricFilters": [{"field": "aov", "operator": ">", "value": 100}],'
        '"category": "electronics", "count": 5}}'
    )
    assert result is not None
    assert len(result["params"]["metricFilters"]) == 1
    assert result["params"]["metricFilters"][0]["field"] == "aov"
    assert result["params"]["metricFilters"][0]["operator"] == ">"
    assert result["params"]["metricFilters"][0]["value"] == 100.0

    # Invalid metric field name
    result = _parse_response(
        '{"intent": "recommendation", "params": {'
        '"metricFilters": [{"field": "invalidMetric", "operator": ">", "value": 100}]}}'
    )
    assert result is not None
    assert "metricFilters" not in result["params"] or len(result["params"].get("metricFilters", [])) == 0, \
        f"Invalid metric field should be filtered. Got: {result['params']}"

    print("  PASS test_parse_response_metric_filters")


# ── ParamDef validation ──────────────────────────────────────────────────────

def test_validate_param_str():
    pdef = ParamDef(type="str")
    assert _validate_param_value("k", "hello", pdef) == "hello"
    assert _validate_param_value("k", "  trimmed  ", pdef) == "trimmed"
    assert _validate_param_value("k", "", pdef) is None
    print("  PASS test_validate_param_str")


def test_validate_param_str_enum():
    pdef = ParamDef(type="str", enum=["a", "b", "c"])
    assert _validate_param_value("k", "a", pdef) == "a"
    assert _validate_param_value("k", "d", pdef) is None  # not in enum
    print("  PASS test_validate_param_str_enum")


def test_validate_param_int():
    pdef = ParamDef(type="int")
    assert _validate_param_value("k", 10, pdef) == 10
    assert _validate_param_value("k", 5.0, pdef) == 5
    assert _validate_param_value("k", 0, pdef) is None  # must be positive
    assert _validate_param_value("k", -1, pdef) is None
    print("  PASS test_validate_param_int")


def test_validate_param_bool():
    pdef = ParamDef(type="bool")
    assert _validate_param_value("k", True, pdef) is True
    assert _validate_param_value("k", False, pdef) is False
    assert _validate_param_value("k", 0, pdef) is False
    print("  PASS test_validate_param_bool")


# ── Extensibility ────────────────────────────────────────────────────────────

def test_new_skill_registration():
    """Verify that adding a new skill programmatically works (AC2)."""
    class TestSkill(IntentSkill):
        @property
        def intent(self) -> str:
            return "test_skill"

        def prompt_intent_section(self) -> str:
            return "- test_skill: A test intent.\n"

        def prompt_params_section(self) -> str:
            return '- testParam (string): A test parameter.\n'

        def param_schema(self) -> dict:
            return {"testParam": ParamDef(type="str")}

        def examples(self) -> list:
            return [ExamplePair(query="test query", output={"intent": "test_skill", "params": {}})]

    test_skill = TestSkill()
    registry.register(test_skill)
    assert "test_skill" in registry.list_intents()
    assert registry.get("test_skill") is test_skill

    # Verify it appears in the prompt
    prompt = _build_system_prompt([])
    assert "test_skill" in prompt.lower()
    assert "testParam" in prompt

    # Cleanup — remove from registry so other tests aren't affected
    del registry._intent_skills["test_skill"]
    print("  PASS test_new_skill_registration")


# ── Two-stage mode ──────────────────────────────────────────────────────────

def test_router_prompt():
    """Stage 1 router prompt must contain all intent labels and be short."""
    router = _build_router_prompt()
    assert len(router) < 2000, f"Router prompt too long: {len(router)}"
    for intent in EXPECTED_INTENTS:
        assert intent in router.lower(), f"Intent '{intent}' not in router prompt"
    print("  PASS test_router_prompt")


def test_skill_prompt():
    """Stage 2 skill prompt must contain the skill's params and examples."""
    skill = registry.get("recommendation")
    assert skill is not None
    prompt = _build_skill_prompt(skill, ["electronics", "beauty"])
    assert "recommendation" in prompt.lower()
    assert "tier" in prompt
    assert "count" in prompt
    assert "Example" in prompt or "examples" in prompt.lower()
    print("  PASS test_skill_prompt")


def test_parse_intent_only():
    """Stage 1 parser extracts intent from simple JSON."""
    assert _parse_intent_only('{"intent": "recommendation"}') == "recommendation"
    assert _parse_intent_only('```json\n{"intent": "asin"}\n```') == "asin"
    assert _parse_intent_only("gibberish") is None
    assert _parse_intent_only('{"intent": "nonexistent"}') is None
    print("  PASS test_parse_intent_only")


def test_parse_params_only():
    """Stage 2 parser extracts params according to skill schema."""
    skill = registry.get("recommendation")
    params = _parse_params_only(
        '{"params": {"tier": "Tier 2", "count": 10}}', skill
    )
    assert params == {"tier": "Tier 2", "count": 10}, f"Got: {params}"

    # Verify invalid tier is filtered
    params = _parse_params_only(
        '{"tier": "Tier 5", "count": 5}', skill
    )
    assert "tier" not in params, f"Invalid tier should be filtered: {params}"
    assert params == {"count": 5}
    print("  PASS test_parse_params_only")


# ── Runner ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        test_registry_all_intents_present,
        test_each_skill_has_prompt_section,
        test_each_skill_has_param_schema,
        test_each_skill_has_examples,
        test_analysis_skill_registered,
        test_build_system_prompt_contains_all_intents,
        test_valid_intents_from_registry,
        test_parse_response_valid_json,
        test_parse_response_invalid_enum,
        test_parse_response_invalid_json,
        test_parse_response_markdown_fence,
        test_parse_response_metric_filters,
        test_validate_param_str,
        test_validate_param_str_enum,
        test_validate_param_int,
        test_validate_param_bool,
        test_new_skill_registration,
        test_router_prompt,
        test_skill_prompt,
        test_parse_intent_only,
        test_parse_params_only,
    ]

    passed = 0
    failed = 0
    for test_fn in tests:
        try:
            test_fn()
            passed += 1
        except Exception as e:
            failed += 1
            print(f"  FAIL {test_fn.__name__}: {e}")

    print(f"\n{passed} passed, {failed} failed, {len(tests)} total")
    sys.exit(0 if failed == 0 else 1)
