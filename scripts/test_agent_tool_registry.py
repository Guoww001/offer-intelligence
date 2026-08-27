import copy
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agent_tool_registry import (
    AGENT_RESULT_FIELDS,
    AGENT_TOOL_NAMES,
    get_agent_tool_definitions,
    validate_enabled_tools,
    validate_tool_arguments,
    validate_tool_result,
)


def test_registry_has_exactly_seven_tools():
    assert AGENT_TOOL_NAMES == (
        "merchant_analysis",
        "category_analysis",
        "merchant_comparison",
        "tier_analysis",
        "category_comparison",
        "payment_status",
        "trend",
    )
    assert set(AGENT_RESULT_FIELDS) == set(AGENT_TOOL_NAMES)


def test_enabled_tools_are_closed_and_ordered_by_registry():
    enabled, error = validate_enabled_tools(["trend", "merchant_analysis", "trend"])
    assert error is None
    assert enabled == ["merchant_analysis", "trend"]

    enabled, error = validate_enabled_tools(["merchant_analysis", "delete_data"])
    assert enabled is None
    assert error["errorCode"] == "unsupported_tool"

    enabled, error = validate_enabled_tools([])
    assert enabled is None
    assert error["errorCode"] == "invalid_agent_contract"


def test_client_cannot_mutate_registry_definitions():
    first = get_agent_tool_definitions("zh", ["merchant_analysis"])
    first[0]["description"] = "client description"
    first[0]["parameters"]["properties"]["merchant"]["type"] = "array"

    second = get_agent_tool_definitions("zh", ["merchant_analysis"])
    assert second[0]["description"] != "client description"
    assert second[0]["parameters"]["properties"]["merchant"]["type"] == "string"


def test_tool_definitions_are_language_specific():
    zh = get_agent_tool_definitions("zh", ["merchant_analysis"])
    en = get_agent_tool_definitions("en", ["merchant_analysis"])
    assert zh[0]["name"] == "merchant_analysis"
    assert zh[0]["description"] != en[0]["description"]
    assert zh[0]["parameters"]["required"] == ["merchant"]


def test_tool_arguments_are_closed_and_bounded():
    valid, error = validate_tool_arguments(
        "merchant_analysis", {"merchant": " Shokz "}
    )
    assert error is None
    assert valid == {"merchant": "Shokz"}

    invalid, error = validate_tool_arguments(
        "merchant_analysis", {"merchant": "Shokz", "rawPrompt": "secret"}
    )
    assert invalid is None
    assert error["errorCode"] == "invalid_arguments"

    valid, error = validate_tool_arguments(
        "merchant_comparison", {"merchants": ["A", "B"]}
    )
    assert error is None and valid["merchants"] == ["A", "B"]

    invalid, error = validate_tool_arguments(
        "merchant_comparison", {"merchants": ["A"]}
    )
    assert invalid is None and error["errorCode"] == "invalid_arguments"

    invalid, error = validate_tool_arguments(
        "tier_analysis", {"tier": "Tier 2", "limit": 101}
    )
    assert invalid is None and error["errorCode"] == "invalid_arguments"

    invalid, error = validate_tool_arguments(
        "payment_status", {"month": "2026-13"}
    )
    assert invalid is None and error["errorCode"] == "invalid_arguments"

    invalid, error = validate_tool_arguments(
        "trend", {"target": "Shokz", "months": 1}
    )
    assert invalid is None and error["errorCode"] == "invalid_arguments"


def test_payment_status_requires_a_filter():
    invalid, error = validate_tool_arguments("payment_status", {})
    assert invalid is None
    assert error["errorCode"] == "invalid_arguments"


def test_tool_results_allow_only_registered_fields_and_safe_source():
    valid, error = validate_tool_result(
        "merchant_analysis",
        {
            "ok": True,
            "data": {
                "merchant": "Shokz",
                "metrics": {"epc": 1.23},
                "headline": "查询完成",
            },
            "source": {
                "dataSource": "database",
                "dataAsOf": "2026-08-27T08:00:00Z",
                "estimated": False,
            },
        },
    )
    assert error is None
    assert valid["data"]["merchant"] == "Shokz"

    mixed, error = validate_tool_result(
        "merchant_analysis",
        {
            "ok": True,
            "data": {"merchant": "Shokz"},
            "source": {"dataSource": "mixed", "dataAsOf": "2026-08-27", "estimated": False},
        },
    )
    assert error is None and mixed["source"]["dataSource"] == "mixed"

    invalid, error = validate_tool_result(
        "merchant_analysis",
        {"ok": True, "data": {"merchant": "Shokz", "rawPrompt": "secret"}},
    )
    assert invalid is None
    assert error["errorCode"] == "invalid_tool_result"

    invalid, error = validate_tool_result(
        "merchant_analysis",
        {
            "ok": True,
            "data": {"merchant": "Shokz"},
            "source": {"dataSource": "client"},
        },
    )
    assert invalid is None
    assert error["errorCode"] == "invalid_tool_result"


def test_tool_results_reject_unsafe_nested_keys_and_oversized_text():
    invalid, error = validate_tool_result(
        "trend",
        {"ok": True, "data": {"__proto__": {"polluted": True}}},
    )
    assert invalid is None
    assert error["errorCode"] == "invalid_tool_result"

    invalid, error = validate_tool_result(
        "merchant_analysis",
        {"ok": True, "data": {"headline": "x" * 1001}},
    )
    assert invalid is None
    assert error["errorCode"] == "invalid_tool_result"


def test_tool_results_respect_per_tool_json_byte_limits():
    valid_data = {"headline": "x" * 500}
    valid, error = validate_tool_result(
        "merchant_analysis", {"ok": True, "data": valid_data}
    )
    assert error is None and valid["data"]["headline"] == valid_data["headline"]

    oversized = {"headline": "x" * 1000, "note": "y" * 1000}
    oversized["metrics"] = {"metric_%03d" % index: index for index in range(300)}
    invalid, error = validate_tool_result(
        "merchant_analysis", {"ok": True, "data": oversized}
    )
    assert invalid is None
    assert error["errorCode"] == "invalid_tool_result"


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print("PASS %s" % test.__name__)
    print("OK %d tests" % len(tests))


if __name__ == "__main__":
    main()
