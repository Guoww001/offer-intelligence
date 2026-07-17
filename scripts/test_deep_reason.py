"""Tests for deep_reason module — parse_query, data execution, report generation."""
import json
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from deep_reason import parse_query, SUPPORTED_METRICS, ANALYSIS_TYPES, ENTITY_TYPES


def test_parse_query_valid_output():
    """parse_query() should return a dict with all required fields.

    NOTE: Without LLM API key, this test checks that parse_query
    either succeeds (all fields present) or gracefully returns an error.
    """
    result = parse_query("对比 Anker 和 Shokz 的 EPC")
    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    # When LLM is available, we expect a full plan; otherwise an error response
    if "error" in result:
        # Graceful degradation when LLM is unavailable
        assert len(result["error"]) > 0, "Error message should not be empty"
        return
    assert "analysisType" in result, f"Missing analysisType in {result}"
    assert "entityType" in result, f"Missing entityType in {result}"
    assert "entities" in result, f"Missing entities in {result}"
    assert isinstance(result["entities"], list), f"entities must be list"
    assert len(result["entities"]) > 0, f"entities must not be empty"
    assert result["entityType"] in ENTITY_TYPES, f"Invalid entityType: {result['entityType']}"
    assert result["analysisType"] in ANALYSIS_TYPES, f"Invalid analysisType: {result['analysisType']}"
    assert all(m in SUPPORTED_METRICS for m in result.get("metrics", [])), f"Unsupported metrics in {result}"


def test_parse_query_short_prompt():
    """Very short prompts should return an error dict."""
    result = parse_query("hi")
    assert "error" in result, f"Short prompt should error: {result}"


def test_parse_query_max_entities():
    """parse_query should cap entities at 10."""
    result = parse_query("对比 A, B, C, D, E, F, G, H, I, J, K 的数据")
    assert len(result.get("entities", [])) <= 10, f"Too many entities: {result}"


def test_execute_from_cache_merchant():
    """execute_query_plan should return summary for known merchants."""
    from deep_reason import execute_query_plan
    result = execute_query_plan({
        "analysisType": "comparison",
        "entityType": "merchant",
        "entities": ["anker"],
        "metrics": ["epc", "aov"],
        "timeRange": {"months": 2},
        "comparisonType": None,
        "filters": {},
        "analysisGoal": "测试"
    })
    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    assert "entityType" in result
    assert "totalOffers" in result
    # Should be able to run without DB
    assert "warning" not in result or result["warning"] is None, f"Unexpected warning: {result.get('warning')}"


def test_execute_from_cache_category():
    """execute_query_plan should aggregate by category."""
    from deep_reason import execute_query_plan
    result = execute_query_plan({
        "analysisType": "ranking",
        "entityType": "category",
        "entities": ["Beauty"],
        "metrics": ["epc", "orders"],
        "timeRange": {"months": 2},
        "comparisonType": None,
        "filters": {},
        "analysisGoal": "测试"
    })
    assert isinstance(result, dict)
    assert result.get("totalOffers", 0) >= 0


def test_execute_from_cache_tier():
    """execute_query_plan should filter by tier."""
    from deep_reason import execute_query_plan
    result = execute_query_plan({
        "analysisType": "overview",
        "entityType": "tier",
        "entities": ["tier 2"],
        "metrics": ["epc", "aov", "orders"],
        "timeRange": {"months": 2},
        "comparisonType": None,
        "filters": {},
        "analysisGoal": "测试"
    })
    assert isinstance(result, dict)
    assert "totalOffers" in result
    assert result["entityType"] == "tier"


def test_data_only_report_fallback():
    """_data_only_report should produce valid structure without LLM."""
    from deep_reason import _data_only_report
    data = {
        "averages": {"epc": 1.5, "aov": 80.0},
        "totals": {"orders": 150, "salesAmount": 12000.0},
        "offers": [
            {"brand": "Anker", "tier": "Tier 1", "epc": 2.0, "aov": 100.0,
             "orders": 100, "clicks": 500, "salesAmount": 10000.0,
             "conversionRate": 0.2},
            {"brand": "Shokz", "tier": "Tier 2", "epc": 1.0, "aov": 60.0,
             "orders": 50, "clicks": 300, "salesAmount": 2000.0,
             "conversionRate": 0.17},
        ],
        "entityType": "merchant",
        "entities": ["anker", "shokz"],
        "totalOffers": 2,
        "entityCount": 2,
    }
    plan = {
        "entities": ["anker", "shokz"],
        "analysisType": "comparison",
        "entityType": "merchant",
    }
    report = _data_only_report(data, plan, "zh")
    assert "title" in report, f"Missing title: {report}"
    assert "sections" in report, f"Missing sections: {report}"
    assert len(report["sections"]) > 0, "No sections in report"
    assert len(report["sections"][0]["findings"]) > 0, "No findings in first section"


def test_full_pipeline():
    """Full pipeline should produce a valid report structure without LLM."""
    from deep_reason import run_deep_reasoning
    result = run_deep_reasoning("显示 Beauty 品类中 EPC 最高的 3 个商户", "zh")
    assert "title" in result, f"Missing title in {result}"
    assert "sections" in result, f"Missing sections in {result}"
    assert isinstance(result["sections"], list), f"Sections not a list"
    assert result["sections"][0]["findings"], f"No findings in first section"
    # Should gracefully handle LLM being unavailable (fallback to data-only)
    assert result.get("stages", {}).get("report") in ("ok", "fallback")
