from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import agent_contract
from agent_promotion_contract import validate_promotion_arguments, validate_promotion_context, validate_promotion_result
from agent_tool_registry import validate_tool_arguments, validate_tool_result


WINDOW = {
    "launchDate": "2026-09-07",
    "startDate": "2026-09-07",
    "endDate": "2026-09-13",
    "beforeStart": "2026-08-31",
    "beforeEnd": "2026-09-06",
    "days": 7,
}
CONTEXT = {
    "attachmentId": "attachment-a",
    "fileName": "campaign.csv",
    "merchantCount": 1,
    "merchants": [{"merchantId": "101", "merchantName": "First merchant"}],
    "window": WINDOW,
}


def test_context_and_scope_are_bounded():
    normalized, error = validate_promotion_context(CONTEXT)
    assert error is None
    assert normalized["merchants"][0]["merchantId"] == "101"

    arguments, error = validate_promotion_arguments(
        {"attachmentId": "attachment-a", "view": "merchants", "merchantIds": ["101"]},
        normalized,
    )
    assert error is None
    assert arguments["window"] == WINDOW
    assert arguments["limit"] == 25

    later_window = {**WINDOW, "startDate": "2026-09-10", "endDate": "2026-09-16"}
    later_context, error = validate_promotion_context({**CONTEXT, "window": later_window})
    assert error is None
    arguments, error = validate_promotion_arguments({"attachmentId": "attachment-a", "view": "merchants"}, later_context)
    assert error is None
    assert arguments["window"] == later_window
    for bad_window in ({**later_window, "beforeEnd": "2026-09-09"}, {**later_window, "startDate": "2026-09-06", "endDate": "2026-09-12"}):
        _, error = validate_promotion_context({**CONTEXT, "window": bad_window})
        assert error is not None


def test_planning_rejects_promotion_tool_without_uploaded_context():
    request, error = agent_contract.validate_planning_request({
        "contractVersion": "v2",
        "question": "分析推广表现",
        "language": "zh",
        "enabledTools": ["promotion_analysis"],
    })
    assert request is None
    assert error["errorCode"] == "invalid_filter"
    assert error["field"] == "promotionContext"


def test_planning_keeps_uploaded_context_in_messages_and_normalizes_scope():
    request, error = agent_contract.validate_planning_request({
        "contractVersion": "v2",
        "question": "查看清单商家",
        "language": "zh",
        "enabledTools": ["promotion_analysis"],
        "promotionContext": CONTEXT,
    })
    assert error is None
    assert request["promotionContext"]["attachmentId"] == "attachment-a"
    assert "attachment-a" in agent_contract.build_planning_messages(request)[1]["content"]

    previous = os.environ.get("OI_SESSION_SECRET")
    os.environ["OI_SESSION_SECRET"] = "promotion-contract-secret"
    try:
        normalized, error = agent_contract.normalize_planning_result({
            "content": None,
            "tool_calls": [{
                "id": "provider-call",
                "name": "promotion_analysis",
                "arguments": {"attachmentId": "attachment-a", "view": "merchants"},
            }],
        }, request, "ar_promotion_contract_2", 1)
    finally:
        if previous is None:
            os.environ.pop("OI_SESSION_SECRET", None)
        else:
            os.environ["OI_SESSION_SECRET"] = previous
    assert error is None
    assert normalized["toolCalls"][0]["arguments"]["merchantIds"] == ["101"]
    assert normalized["toolCalls"][0]["arguments"]["window"] == WINDOW


def test_media_count_question_gets_a_bounded_merchant_media_plan():
    request, error = agent_contract.validate_planning_request({
        "contractVersion": "v2",
        "question": "哪些商家有更多媒体在推，挑出前10个",
        "language": "zh",
        "enabledTools": ["promotion_analysis"],
        "promotionContext": CONTEXT,
    })
    assert error is None
    previous = os.environ.get("OI_SESSION_SECRET")
    os.environ["OI_SESSION_SECRET"] = "promotion-contract-secret"
    try:
        normalized, error = agent_contract.normalize_planning_result({
            "content": "我来看看。",
            "tool_calls": [],
        }, request, "ar_media_count_contract_1", 1)
    finally:
        if previous is None:
            os.environ.pop("OI_SESSION_SECRET", None)
        else:
            os.environ["OI_SESSION_SECRET"] = previous
    assert error is None
    assert normalized["toolCalls"][0]["name"] == "promotion_analysis"
    assert normalized["toolCalls"][0]["arguments"]["view"] == "merchant_media"
    assert normalized["toolCalls"][0]["arguments"]["limit"] == 10


def test_scope_rejects_a_merchant_outside_the_uploaded_list():
    normalized, _ = validate_promotion_context(CONTEXT)
    arguments, error = validate_promotion_arguments(
        {"attachmentId": "attachment-a", "view": "file", "merchantIds": ["999"]},
        normalized,
    )
    assert arguments is None
    assert error["errorCode"] == "invalid_filter"


def test_context_rejects_an_inconsistent_date_window():
    invalid = {**CONTEXT, "window": {**WINDOW, "days": 8}}
    normalized, error = validate_promotion_context(invalid)
    assert normalized is None
    assert error["errorCode"] == "invalid_arguments"
    assert error["field"] == "promotionContext.window"


def test_registry_and_result_contract_register_promotion_tool():
    arguments, error = validate_tool_arguments(
        "promotion_analysis",
        {"attachmentId": "attachment-a", "view": "file", "merchantIds": ["101"]},
    )
    assert error is None
    assert arguments["metric"] == "revenue"

    result, error = validate_tool_result(
        "promotion_analysis",
        {
            "ok": True,
            "source": {"dataSource": "unknown", "dataAsOf": None, "estimated": False},
            "data": {
                "view": "file",
                "attachmentId": "attachment-a",
                "fileName": "campaign.csv",
                "merchantCount": 1,
                "evidenceOrigin": "file",
                "rows": [{"merchantId": "101", "merchantName": "First merchant", "asins": []}],
                "totalRows": 1,
                "offset": 0,
                "limit": 25,
                "returned": 1,
                "hasMore": False,
                "headline": "Uploaded merchant list",
                "note": "File facts",
            },
        },
    )
    assert error is None
    assert result["data"]["evidenceOrigin"] == "file"

    result, error = validate_tool_result(
        "promotion_analysis",
        {
            "ok": True,
            "source": {"dataSource": "database", "dataAsOf": "2026-09-20", "estimated": False},
            "data": {
                "view": "merchant_media",
                "attachmentId": "attachment-a",
                "fileName": "campaign.csv",
                "merchantCount": 1,
                "evidenceOrigin": "database",
                "rows": [{"merchantId": "101", "merchantName": "First merchant", "mediaCount": 3}],
                "totalRows": 1,
                "offset": 0,
                "limit": 25,
                "returned": 1,
                "hasMore": False,
            },
        },
    )
    assert error is None
    assert result["data"]["rows"][0]["mediaCount"] == 3


def test_result_byte_limit_is_specific_to_promotion_tool():
    data = {"headline": "x" * 900, "note": "y" * 900, "rows": [{"label": "z" * 900}] * 25}
    result, error = validate_promotion_result(data)
    assert result is None
    assert error["errorCode"] == "invalid_tool_result"


def test_proof_binds_normalized_promotion_arguments():
    previous = os.environ.get("OI_SESSION_SECRET")
    os.environ["OI_SESSION_SECRET"] = "promotion-contract-secret"
    try:
        calls = [{"id": "r1c1", "name": "promotion_analysis", "arguments": {"attachmentId": "attachment-a", "view": "file", "merchantIds": ["101"], "metric": "revenue", "sortBy": "after", "direction": "desc", "offset": 0, "limit": 25, "window": None}}]
        proof = agent_contract.issue_plan_proof("ar_promotion_contract_1", "查看清单", calls, int(time.time()) + 300)
        assert proof
        assert agent_contract.verify_plan_proof(proof, "ar_promotion_contract_1", "查看清单")
    finally:
        if previous is None:
            os.environ.pop("OI_SESSION_SECRET", None)
        else:
            os.environ["OI_SESSION_SECRET"] = previous


def main():
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"PASS {test.__name__}")
    print(f"OK {len(tests)} tests")


if __name__ == "__main__":
    main()
