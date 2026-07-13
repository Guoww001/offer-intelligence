from sync_oi_tables import _determine_color_from_sheet


def assert_status(sheet, row, expected, label):
    actual = _determine_color_from_sheet(sheet, row)
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")


def main():
    assert_status(
        "Tier 1",
        {"Original Rank": "40"},
        ("green", "tier1_online", "Original Rank=40", "rule"),
        "Tier 1 rank rule",
    )
    assert_status(
        "Tier 1",
        {"Original Rank": "39"},
        ("yellow", "tier1_not_ready", "Original Rank=39", "rule"),
        "Tier 1 not-ready rule",
    )
    assert_status(
        "Tier 2",
        {"Phase": "Stable"},
        ("yellow", "tier2_stable", "Phase=Stable", "rule"),
        "Tier 2 phase rule",
    )
    assert_status(
        "Tier 3",
        {"Tier Reason": "Moved from Tier 2 after declining performance"},
        ("red", "tier3_demoted_or_declining", "Moved from Tier 2 after declining performance", "rule"),
        "Tier 3 reason rule",
    )
    assert_status(
        "Tier 4",
        {"Tier Reason": "New June raw offer"},
        ("green", "tier4_new_offer", "New June raw offer", "rule"),
        "Tier 4 reason rule",
    )
    assert_status(
        "Tier 2",
        {"Phase": "Stable", "Visual Status Color": "red", "Visual Status Reason": "Manual review"},
        ("red", "explicit", "Manual review", "manual"),
        "explicit color override",
    )
    assert_status(
        "Tier 4",
        {"Tier Reason": "0 orders", "Visual Status Color": "none"},
        ("none", "explicit_none", "Explicit color=none", "manual"),
        "explicit none override",
    )
    assert_status(
        "BLACK TIER",
        {"Tier Reason": "Blocked"},
        ("none", "no_rule_match", "Blocked", "rule"),
        "unmatched rule",
    )
    print("Tier visual status database-rule checks passed")


if __name__ == "__main__":
    main()
