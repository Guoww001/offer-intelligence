from __future__ import annotations

import datetime as dt
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from offer_db import (
    db_connection,
    fetch_all,
    fetch_one,
    parse_tier_report_date,
    reporting_today,
    to_float,
    utc_now_iso,
)


DEFAULT_GOOGLE_ADS_API_VERSION = "v25"
DEFAULT_WORKBENCH_USER_ID = 19
DEFAULT_WORKBENCH_RANGE_DAYS = 60
MAX_WORKBENCH_RANGE_DAYS = 366
WORKBENCH_CACHE_TTL = 300

_workbench_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_workbench_cache_lock = threading.Lock()


class GoogleAdsConfigError(RuntimeError):
    pass


class GoogleAdsApiError(RuntimeError):
    pass


def _env_value(name: str) -> str:
    return str(os.environ.get(name) or "").strip()


def _require_google_ads_environment() -> dict[str, str]:
    values = {
        "client_id": _env_value("GOOGLE_ADS_CLIENT_ID"),
        "client_secret": _env_value("GOOGLE_ADS_CLIENT_SECRET"),
        "developer_token": _env_value("GOOGLE_ADS_DEVELOPER_TOKEN"),
    }
    missing = [name for name, value in values.items() if not value]
    if missing:
        labels = {
            "client_id": "GOOGLE_ADS_CLIENT_ID",
            "client_secret": "GOOGLE_ADS_CLIENT_SECRET",
            "developer_token": "GOOGLE_ADS_DEVELOPER_TOKEN",
        }
        raise GoogleAdsConfigError(
            "Missing Google Ads server environment variables: "
            + ", ".join(labels[name] for name in missing)
        )
    return values


def _google_ads_api_version() -> str:
    value = _env_value("GOOGLE_ADS_API_VERSION") or DEFAULT_GOOGLE_ADS_API_VERSION
    if not re.fullmatch(r"v\d+", value):
        raise GoogleAdsConfigError("GOOGLE_ADS_API_VERSION must use a value such as v25")
    return value


def _json_request(
    url: str,
    *,
    data: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 30,
) -> Any:
    request_headers = dict(headers or {})
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=body, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        message = f"Google Ads API returned HTTP {error.code}"
        try:
            payload = json.loads(error.read().decode("utf-8", errors="replace"))
            api_error = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(api_error, dict) and api_error.get("message"):
                message = str(api_error["message"])
        except (ValueError, TypeError, AttributeError):
            pass
        raise GoogleAdsApiError(message) from error
    except urllib.error.URLError as error:
        raise GoogleAdsApiError("Google Ads API is temporarily unavailable") from error


def _refresh_access_token(refresh_token: str, config: dict[str, str]) -> str:
    request = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=urllib.parse.urlencode(
            {
                "client_id": config["client_id"],
                "client_secret": config["client_secret"],
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            }
        ).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        raise GoogleAdsApiError("Google Ads OAuth refresh failed") from error
    except urllib.error.URLError as error:
        raise GoogleAdsApiError("Google Ads OAuth endpoint is unavailable") from error
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise GoogleAdsApiError("Google Ads OAuth refresh returned no access token")
    return access_token


def _customer_id(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _customer_ids(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    raw_values: list[Any]
    try:
        parsed = json.loads(text)
        raw_values = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        raw_values = re.split(r"[,;\s]+", text)
    output: list[str] = []
    for raw in raw_values:
        normalized = _customer_id(raw)
        if normalized and normalized not in output:
            output.append(normalized)
    return output


def _google_ads_headers(
    access_token: str,
    developer_token: str,
    login_customer_id: str | None = None,
) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "developer-token": developer_token,
    }
    normalized_login = _customer_id(login_customer_id)
    if normalized_login:
        headers["login-customer-id"] = normalized_login
    return headers


def _accessible_customer_ids(access_token: str, developer_token: str) -> list[str]:
    version = _google_ads_api_version()
    payload = _json_request(
        f"https://googleads.googleapis.com/{version}/customers:listAccessibleCustomers",
        headers=_google_ads_headers(access_token, developer_token),
        timeout=20,
    )
    output: list[str] = []
    for resource_name in payload.get("resourceNames", []) if isinstance(payload, dict) else []:
        normalized = _customer_id(resource_name)
        if normalized and normalized not in output:
            output.append(normalized)
    return output


def _search_stream(
    customer_id: str,
    query: str,
    access_token: str,
    developer_token: str,
    login_customer_id: str | None = None,
) -> list[dict[str, Any]]:
    version = _google_ads_api_version()
    payload = _json_request(
        f"https://googleads.googleapis.com/{version}/customers/{customer_id}/googleAds:searchStream",
        data={"query": query},
        headers=_google_ads_headers(access_token, developer_token, login_customer_id),
        timeout=45,
    )
    rows: list[dict[str, Any]] = []
    for chunk in payload if isinstance(payload, list) else []:
        if isinstance(chunk, dict):
            rows.extend(row for row in chunk.get("results", []) if isinstance(row, dict))
    return rows


def _customer_metadata(
    customer_id: str,
    access_token: str,
    developer_token: str,
    login_customer_id: str | None = None,
) -> dict[str, Any] | None:
    rows = _search_stream(
        customer_id,
        """
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.manager,
          customer.test_account,
          customer.currency_code,
          customer.time_zone
        FROM customer
        LIMIT 1
        """,
        access_token,
        developer_token,
        login_customer_id,
    )
    return rows[0].get("customer") if rows else None


def _resolve_google_ads_customer(
    access_token: str,
    developer_token: str,
    stored_customer_ids: Any,
) -> tuple[dict[str, Any], str | None, list[str]]:
    preferred = _customer_id(_env_value("GOOGLE_ADS_CUSTOMER_ID"))
    configured_login = _customer_id(_env_value("GOOGLE_ADS_LOGIN_CUSTOMER_ID")) or None
    accessible = _accessible_customer_ids(access_token, developer_token)
    candidates: list[str] = []
    for candidate in [preferred, *_customer_ids(stored_customer_ids), *accessible]:
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    if not candidates:
        raise GoogleAdsApiError("No accessible Google Ads customer account was found")

    accounts: list[dict[str, Any]] = []
    for candidate in candidates:
        metadata = None
        for login_id in [configured_login, None]:
            try:
                metadata = _customer_metadata(
                    candidate,
                    access_token,
                    developer_token,
                    login_id,
                )
                break
            except GoogleAdsApiError:
                continue
        if metadata:
            accounts.append(
                {
                    "customerId": _customer_id(metadata.get("id")) or candidate,
                    "descriptiveName": str(metadata.get("descriptiveName") or candidate),
                    "manager": bool(metadata.get("manager")),
                    "testAccount": bool(metadata.get("testAccount")),
                    "currencyCode": str(metadata.get("currencyCode") or "USD"),
                    "timeZone": str(metadata.get("timeZone") or ""),
                }
            )

    client_accounts = [account for account in accounts if not account["manager"]]
    if preferred:
        selected = next(
            (account for account in client_accounts if account["customerId"] == preferred),
            None,
        )
    else:
        selected = None
    if selected is None and client_accounts:
        selected = client_accounts[0]
    if selected is None:
        raise GoogleAdsApiError("No non-manager Google Ads customer account was found")

    manager_ids = [
        account["customerId"]
        for account in accounts
        if account["manager"] and account["customerId"] != selected["customerId"]
    ]
    return selected, configured_login, manager_ids


def _campaign_rows(
    account: dict[str, Any],
    range_start: dt.date,
    range_end: dt.date,
    access_token: str,
    developer_token: str,
    configured_login: str | None,
    manager_ids: list[str],
) -> tuple[list[dict[str, Any]], str | None]:
    query = f"""
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date BETWEEN '{range_start.isoformat()}' AND '{range_end.isoformat()}'
      AND campaign.status != 'REMOVED'
    ORDER BY segments.date, campaign.id
    """
    attempts: list[str | None] = []
    for login_id in [configured_login, None, *manager_ids]:
        if login_id not in attempts:
            attempts.append(login_id)
    last_error: Exception | None = None
    for login_id in attempts:
        try:
            return (
                _search_stream(
                    account["customerId"],
                    query,
                    access_token,
                    developer_token,
                    login_id,
                ),
                login_id,
            )
        except GoogleAdsApiError as error:
            last_error = error
    raise GoogleAdsApiError(str(last_error or "Unable to query Google Ads campaign metrics"))


def _normalize_campaign_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for row in rows:
        campaign = row.get("campaign") if isinstance(row.get("campaign"), dict) else {}
        metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
        segments = row.get("segments") if isinstance(row.get("segments"), dict) else {}
        campaign_id = _customer_id(campaign.get("id"))
        day = str(segments.get("date") or "").strip()
        if not campaign_id or not day:
            continue
        normalized.append(
            {
                "date": day,
                "campaignId": campaign_id,
                "campaignName": str(campaign.get("name") or campaign_id),
                "status": str(campaign.get("status") or "UNKNOWN"),
                "channelType": str(campaign.get("advertisingChannelType") or "UNKNOWN"),
                "impressions": int(to_float(metrics.get("impressions"))),
                "clicks": int(to_float(metrics.get("clicks"))),
                "cost": round(to_float(metrics.get("costMicros")) / 1_000_000, 6),
                "nativeConversions": round(to_float(metrics.get("conversions")), 6),
                "nativeConversionValue": round(to_float(metrics.get("conversionsValue")), 6),
            }
        )
    return normalized


def _date_range(start_date: str | None, end_date: str | None) -> tuple[dt.date, dt.date]:
    raw_start = str(start_date or "").strip()
    raw_end = str(end_date or "").strip()
    if bool(raw_start) != bool(raw_end):
        raise ValueError("startDate and endDate must be provided together")
    range_start = parse_tier_report_date(raw_start)
    range_end = parse_tier_report_date(raw_end)
    if raw_start and range_start is None:
        raise ValueError("startDate must use YYYY-MM-DD format")
    if raw_end and range_end is None:
        raise ValueError("endDate must use YYYY-MM-DD format")
    if range_start is None or range_end is None:
        range_end = reporting_today() - dt.timedelta(days=1)
        range_start = range_end - dt.timedelta(days=DEFAULT_WORKBENCH_RANGE_DAYS - 1)
    if range_start > range_end:
        raise ValueError("startDate cannot be after endDate")
    if (range_end - range_start).days + 1 > MAX_WORKBENCH_RANGE_DAYS:
        raise ValueError(f"date range cannot exceed {MAX_WORKBENCH_RANGE_DAYS} days")
    return range_start, range_end


def _backend_source(
    user_id: int,
    range_start: dt.date,
    range_end: dt.date,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    compact_start = int(range_start.strftime("%Y%m%d"))
    compact_end = int(range_end.strftime("%Y%m%d"))
    with db_connection() as connection:
        profile = fetch_one(
            connection,
            """
            SELECT
              u.user_id,
              u.user_name,
              COALESCE(ad.admin_name, 'Unknown') AS admin_name
            FROM v_maxai_cnpscy_user u
            LEFT JOIN cnpscy_admins ad
              ON CAST(u.admin_id_look AS CHAR) = CAST(ad.admin_code AS CHAR)
             AND ad.is_delete = 0
            WHERE u.user_id = %s
            LIMIT 1
            """,
            (user_id,),
        )
        if not profile:
            raise ValueError("userId was not found")
        google_ads = fetch_one(
            connection,
            """
            SELECT user_id, refresh_token, customer_ids, status, updated_at
            FROM cnpscy_user_google_ads
            WHERE user_id = %s
            LIMIT 1
            """,
            (user_id,),
        )
        if not google_ads or not str(google_ads.get("refresh_token") or "").strip():
            raise GoogleAdsConfigError("This media account has no Google Ads refresh token")
        if int(google_ads.get("status") or 0) != 1:
            raise GoogleAdsConfigError("This media account's Google Ads connection is disabled")

        order_rows = fetch_all(
            connection,
            """
            SELECT
              o.advert_id AS merchant_id,
              COALESCE(NULLIF(MAX(a.advert_name), ''), CAST(o.advert_id AS CHAR)) AS merchant_name,
              o.order_time_day AS metric_day,
              SUM(COALESCE(o.total_clicks, 0)) AS order_clicks,
              SUM(COALESCE(o.detail_page_views, 0)) AS detail_page_views,
              SUM(COALESCE(o.add_to_carts, 0)) AS add_to_carts,
              SUM(COALESCE(o.total_purchases, 0)) AS orders,
              SUM(COALESCE(o.amount, 0)) AS revenue,
              SUM(COALESCE(o.payout, 0)) AS all_commission,
              SUM(COALESCE(o.aff_payout, 0)) AS aff_commission,
              GROUP_CONCAT(DISTINCT NULLIF(TRIM(o.asin), '')) AS asins
            FROM cnpscy_amazon_order o
            LEFT JOIN cnpscy_advert a ON a.advert_id = o.advert_id
            WHERE o.user_id = %s
              AND o.advert_id IS NOT NULL
              AND o.advert_id > 0
              AND o.order_time_day BETWEEN %s AND %s
            GROUP BY o.advert_id, o.order_time_day
            ORDER BY o.order_time_day, o.advert_id
            """,
            (user_id, compact_start, compact_end),
        )
        click_rows = fetch_all(
            connection,
            """
            SELECT
              c.advert_id AS merchant_id,
              COALESCE(NULLIF(MAX(a.advert_name), ''), CAST(c.advert_id AS CHAR)) AS merchant_name,
              c.time_day AS metric_day,
              SUM(COALESCE(c.click, 0)) AS tracked_clicks,
              GROUP_CONCAT(DISTINCT NULLIF(TRIM(c.asin), '')) AS asins
            FROM cnpscy_amazon_click c
            LEFT JOIN cnpscy_advert a ON a.advert_id = c.advert_id
            WHERE c.user_id = %s
              AND c.advert_id IS NOT NULL
              AND c.advert_id > 0
              AND c.time_day BETWEEN %s AND %s
            GROUP BY c.advert_id, c.time_day
            ORDER BY c.time_day, c.advert_id
            """,
            (user_id, compact_start, compact_end),
        )

    records: dict[tuple[int, str], dict[str, Any]] = {}
    for row in order_rows:
        merchant_id = int(row.get("merchant_id") or 0)
        day = _compact_day(row.get("metric_day"))
        if merchant_id <= 0 or not day:
            continue
        order_clicks = int(to_float(row.get("order_clicks")))
        records[(merchant_id, day)] = {
            "date": day,
            "merchantId": merchant_id,
            "merchantName": str(row.get("merchant_name") or merchant_id).strip(),
            "clicks": order_clicks,
            "clickSource": "cnpscy_amazon_order.total_clicks" if order_clicks > 0 else "",
            "detailPageViews": int(to_float(row.get("detail_page_views"))),
            "addToCarts": int(to_float(row.get("add_to_carts"))),
            "orders": int(to_float(row.get("orders"))),
            "revenue": round(to_float(row.get("revenue")), 2),
            "allCommission": round(to_float(row.get("all_commission")), 2),
            "affCommission": round(to_float(row.get("aff_commission")), 2),
            "asins": _split_asins(row.get("asins")),
        }
    for row in click_rows:
        merchant_id = int(row.get("merchant_id") or 0)
        day = _compact_day(row.get("metric_day"))
        if merchant_id <= 0 or not day:
            continue
        record = records.setdefault(
            (merchant_id, day),
            {
                "date": day,
                "merchantId": merchant_id,
                "merchantName": str(row.get("merchant_name") or merchant_id).strip(),
                "clicks": 0,
                "clickSource": "",
                "detailPageViews": 0,
                "addToCarts": 0,
                "orders": 0,
                "revenue": 0.0,
                "allCommission": 0.0,
                "affCommission": 0.0,
                "asins": [],
            },
        )
        record["asins"] = sorted(set(record["asins"]) | set(_split_asins(row.get("asins"))))
        if not record["clickSource"]:
            record["clicks"] = int(to_float(row.get("tracked_clicks")))
            record["clickSource"] = "cnpscy_amazon_click.click"
    return profile, google_ads, list(records.values())


def _compact_day(value: Any) -> str:
    text = str(value or "").strip()
    if re.fullmatch(r"\d{8}", text):
        try:
            return dt.datetime.strptime(text, "%Y%m%d").date().isoformat()
        except ValueError:
            return ""
    try:
        return dt.date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return ""


def _split_asins(value: Any) -> list[str]:
    return sorted(
        {
            token.strip().upper()
            for token in str(value or "").split(",")
            if re.fullmatch(r"[A-Za-z0-9]{10}", token.strip())
        }
    )


def _normalized_name(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())


def _merchant_aliases(name: str) -> list[str]:
    generic = {"amazon", "official", "store", "shop", "brand", "inc", "llc", "the"}
    words = re.findall(r"[a-z0-9]+", name.casefold())
    filtered = [word for word in words if word not in generic and len(word) >= 3]
    aliases = {_normalized_name(name), "".join(filtered)}
    aliases.update(word for word in filtered if len(word) >= 5)
    return sorted((alias for alias in aliases if len(alias) >= 4), key=len, reverse=True)


def _manual_alias_map() -> dict[str, int]:
    raw = _env_value("GOOGLE_ADS_MERCHANT_ALIASES")
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise GoogleAdsConfigError("GOOGLE_ADS_MERCHANT_ALIASES must be valid JSON") from error
    if not isinstance(payload, dict):
        raise GoogleAdsConfigError("GOOGLE_ADS_MERCHANT_ALIASES must be a JSON object")
    output: dict[str, int] = {}
    for alias, merchant_id in payload.items():
        normalized = _normalized_name(alias)
        try:
            numeric_id = int(merchant_id)
        except (TypeError, ValueError):
            continue
        if normalized and numeric_id > 0:
            output[normalized] = numeric_id
    return output


def _campaign_match(
    campaign_name: str,
    merchants: dict[int, dict[str, Any]],
    manual_aliases: dict[str, int],
) -> tuple[int | None, str, str]:
    normalized_campaign = _normalized_name(campaign_name)
    for alias, merchant_id in sorted(manual_aliases.items(), key=lambda item: len(item[0]), reverse=True):
        if alias in normalized_campaign and merchant_id in merchants:
            return merchant_id, "manual_alias", "high"

    asin_matches = re.findall(r"\bB[A-Z0-9]{9}\b", str(campaign_name or "").upper())
    if asin_matches:
        matching_merchants = [
            merchant_id
            for merchant_id, merchant in merchants.items()
            if set(asin_matches) & set(merchant.get("asins") or [])
        ]
        if len(matching_merchants) == 1:
            return matching_merchants[0], "asin", "high"

    candidates: list[tuple[int, int]] = []
    for merchant_id, merchant in merchants.items():
        for alias in _merchant_aliases(str(merchant.get("merchantName") or "")):
            if alias in normalized_campaign:
                candidates.append((len(alias), merchant_id))
                break
    if not candidates:
        return None, "unmatched", "none"
    candidates.sort(reverse=True)
    longest = candidates[0][0]
    best_ids = {merchant_id for length, merchant_id in candidates if length == longest}
    if len(best_ids) != 1:
        return None, "ambiguous_name", "low"
    return next(iter(best_ids)), "merchant_name", "high"


def _metric_bucket() -> dict[str, Any]:
    return {
        "impressions": 0,
        "googleClicks": 0,
        "spend": 0.0,
        "nativeConversions": 0.0,
        "nativeConversionValue": 0.0,
        "backendClicks": 0,
        "detailPageViews": 0,
        "addToCarts": 0,
        "orders": 0,
        "revenue": 0.0,
        "allCommission": 0.0,
        "affCommission": 0.0,
    }


def _add_google_metrics(bucket: dict[str, Any], row: dict[str, Any]) -> None:
    bucket["impressions"] += int(row.get("impressions") or 0)
    bucket["googleClicks"] += int(row.get("clicks") or 0)
    bucket["spend"] += float(row.get("cost") or 0)
    bucket["nativeConversions"] += float(row.get("nativeConversions") or 0)
    bucket["nativeConversionValue"] += float(row.get("nativeConversionValue") or 0)


def _add_backend_metrics(bucket: dict[str, Any], row: dict[str, Any]) -> None:
    bucket["backendClicks"] += int(row.get("clicks") or 0)
    bucket["detailPageViews"] += int(row.get("detailPageViews") or 0)
    bucket["addToCarts"] += int(row.get("addToCarts") or 0)
    bucket["orders"] += int(row.get("orders") or 0)
    bucket["revenue"] += float(row.get("revenue") or 0)
    bucket["allCommission"] += float(row.get("allCommission") or 0)
    bucket["affCommission"] += float(row.get("affCommission") or 0)


def _finalize_bucket(bucket: dict[str, Any]) -> dict[str, Any]:
    spend = float(bucket.get("spend") or 0)
    orders = int(bucket.get("orders") or 0)
    google_clicks = int(bucket.get("googleClicks") or 0)
    revenue = float(bucket.get("revenue") or 0)
    return {
        **bucket,
        "spend": round(spend, 2),
        "nativeConversions": round(float(bucket.get("nativeConversions") or 0), 2),
        "nativeConversionValue": round(float(bucket.get("nativeConversionValue") or 0), 2),
        "revenue": round(revenue, 2),
        "allCommission": round(float(bucket.get("allCommission") or 0), 2),
        "affCommission": round(float(bucket.get("affCommission") or 0), 2),
        "merchantRoas": round(revenue / spend, 4) if spend > 0 else None,
        "costPerOrder": round(spend / orders, 2) if orders > 0 else None,
        "googleCtr": round(google_clicks / int(bucket.get("impressions") or 0), 6)
        if int(bucket.get("impressions") or 0) > 0
        else None,
    }


def merge_workbench_sources(
    campaign_rows: list[dict[str, Any]],
    backend_rows: list[dict[str, Any]],
    range_start: dt.date,
    range_end: dt.date,
) -> dict[str, Any]:
    merchants: dict[int, dict[str, Any]] = {}
    for row in backend_rows:
        merchant_id = int(row.get("merchantId") or 0)
        if merchant_id <= 0:
            continue
        merchant = merchants.setdefault(
            merchant_id,
            {
                "merchantId": merchant_id,
                "merchantName": str(row.get("merchantName") or merchant_id),
                "asins": set(),
                "campaigns": {},
                "matchMethods": set(),
                "metrics": _metric_bucket(),
            },
        )
        merchant["asins"].update(row.get("asins") or [])
        _add_backend_metrics(merchant["metrics"], row)

    merchant_match_by_campaign: dict[str, tuple[int | None, str, str]] = {}
    campaigns: dict[str, dict[str, Any]] = {}
    manual_aliases = _manual_alias_map()
    for row in campaign_rows:
        campaign_id = str(row.get("campaignId") or "")
        campaign = campaigns.setdefault(
            campaign_id,
            {
                "campaignId": campaign_id,
                "campaignName": str(row.get("campaignName") or campaign_id),
                "status": str(row.get("status") or "UNKNOWN"),
                "channelType": str(row.get("channelType") or "UNKNOWN"),
                "metrics": _metric_bucket(),
            },
        )
        _add_google_metrics(campaign["metrics"], row)
        if campaign_id not in merchant_match_by_campaign:
            merchant_match_by_campaign[campaign_id] = _campaign_match(
                campaign["campaignName"], merchants, manual_aliases
            )
        merchant_id, match_method, _ = merchant_match_by_campaign[campaign_id]
        if merchant_id is not None:
            merchant = merchants[merchant_id]
            merchant["campaigns"][campaign_id] = {
                "campaignId": campaign_id,
                "campaignName": campaign["campaignName"],
                "status": campaign["status"],
            }
            merchant["matchMethods"].add(match_method)
            _add_google_metrics(merchant["metrics"], row)

    merchant_rows: list[dict[str, Any]] = []
    matched_campaign_ids: set[str] = set()
    for merchant in merchants.values():
        campaign_values = sorted(
            merchant["campaigns"].values(),
            key=lambda row: row["campaignName"].casefold(),
        )
        matched_campaign_ids.update(row["campaignId"] for row in campaign_values)
        merchant_rows.append(
            {
                "merchantId": merchant["merchantId"],
                "merchantName": merchant["merchantName"],
                "matchMethod": "+".join(sorted(merchant["matchMethods"])) if campaign_values else "unmatched",
                "matchConfidence": "high" if campaign_values else "none",
                "campaignCount": len(campaign_values),
                "campaigns": campaign_values,
                **_finalize_bucket(merchant["metrics"]),
            }
        )
    merchant_rows.sort(
        key=lambda row: (
            -float(row.get("spend") or 0),
            -float(row.get("revenue") or 0),
            str(row.get("merchantName") or "").casefold(),
        )
    )

    campaign_output: list[dict[str, Any]] = []
    for campaign_id, campaign in campaigns.items():
        merchant_id, method, confidence = merchant_match_by_campaign[campaign_id]
        merchant = merchants.get(int(merchant_id or 0))
        campaign_output.append(
            {
                "campaignId": campaign_id,
                "campaignName": campaign["campaignName"],
                "status": campaign["status"],
                "channelType": campaign["channelType"],
                "merchantId": merchant_id,
                "merchantName": merchant.get("merchantName") if merchant else None,
                "matchMethod": method,
                "matchConfidence": confidence,
                **_finalize_bucket(campaign["metrics"]),
            }
        )
    campaign_output.sort(key=lambda row: (-float(row.get("spend") or 0), row["campaignName"].casefold()))
    unmatched_campaigns = [row for row in campaign_output if not row.get("merchantId")]

    daily: dict[str, dict[str, Any]] = {}
    cursor = range_start
    while cursor <= range_end:
        daily[cursor.isoformat()] = {
            "date": cursor.isoformat(),
            **_metric_bucket(),
            "matchedSpend": 0.0,
            "unmatchedSpend": 0.0,
            "matchedRevenue": 0.0,
            "matchedOrders": 0,
        }
        cursor += dt.timedelta(days=1)
    for row in campaign_rows:
        point = daily.get(str(row.get("date") or ""))
        if not point:
            continue
        _add_google_metrics(point, row)
        campaign_id = str(row.get("campaignId") or "")
        if campaign_id in matched_campaign_ids:
            point["matchedSpend"] += float(row.get("cost") or 0)
        else:
            point["unmatchedSpend"] += float(row.get("cost") or 0)
    matched_merchant_ids = {
        int(row["merchantId"])
        for row in merchant_rows
        if int(row.get("campaignCount") or 0) > 0
    }
    for row in backend_rows:
        point = daily.get(str(row.get("date") or ""))
        if not point:
            continue
        _add_backend_metrics(point, row)
        if int(row.get("merchantId") or 0) in matched_merchant_ids:
            point["matchedRevenue"] += float(row.get("revenue") or 0)
            point["matchedOrders"] += int(row.get("orders") or 0)
    daily_rows = []
    for point in daily.values():
        finalized = _finalize_bucket(point)
        finalized["matchedSpend"] = round(float(point["matchedSpend"]), 2)
        finalized["unmatchedSpend"] = round(float(point["unmatchedSpend"]), 2)
        finalized["matchedRevenue"] = round(float(point["matchedRevenue"]), 2)
        finalized["matchedOrders"] = int(point["matchedOrders"])
        daily_rows.append(finalized)

    total_google = _metric_bucket()
    for row in campaign_rows:
        _add_google_metrics(total_google, row)
    total_backend = _metric_bucket()
    for row in backend_rows:
        _add_backend_metrics(total_backend, row)
    matched_spend = sum(float(row.get("spend") or 0) for row in merchant_rows)
    matched_revenue = sum(
        float(row.get("revenue") or 0)
        for row in merchant_rows
        if int(row.get("campaignCount") or 0) > 0
    )
    summary = {
        **_finalize_bucket({**total_google, **{
            "backendClicks": total_backend["backendClicks"],
            "detailPageViews": total_backend["detailPageViews"],
            "addToCarts": total_backend["addToCarts"],
            "orders": total_backend["orders"],
            "revenue": total_backend["revenue"],
            "allCommission": total_backend["allCommission"],
            "affCommission": total_backend["affCommission"],
        }}),
        "campaignCount": len(campaign_output),
        "matchedCampaignCount": len(matched_campaign_ids),
        "unmatchedCampaignCount": len(unmatched_campaigns),
        "backendMerchantCount": len(merchant_rows),
        "matchedMerchantCount": len(matched_merchant_ids),
        "matchedSpend": round(matched_spend, 2),
        "unmatchedSpend": round(max(0.0, float(total_google["spend"]) - matched_spend), 2),
        "matchedRevenue": round(matched_revenue, 2),
        "matchCoverageBySpend": round(matched_spend / float(total_google["spend"]), 6)
        if float(total_google["spend"]) > 0
        else 0,
        "merchantLevelRoas": round(matched_revenue / matched_spend, 4) if matched_spend > 0 else None,
    }
    return {
        "summary": summary,
        "daily": daily_rows,
        "merchants": merchant_rows,
        "campaigns": campaign_output,
        "unmatchedCampaigns": unmatched_campaigns,
    }


def google_ads_workbench_payload(
    user_id: int = DEFAULT_WORKBENCH_USER_ID,
    start_date: str | None = None,
    end_date: str | None = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    try:
        normalized_user_id = int(user_id)
    except (TypeError, ValueError) as error:
        raise ValueError("userId must be a positive integer") from error
    if normalized_user_id <= 0:
        raise ValueError("userId must be a positive integer")
    range_start, range_end = _date_range(start_date, end_date)
    cache_key = f"{normalized_user_id}|{range_start.isoformat()}|{range_end.isoformat()}"
    now = time.time()
    with _workbench_cache_lock:
        cached = _workbench_cache.get(cache_key)
    if not force_refresh and cached and now - cached[0] < WORKBENCH_CACHE_TTL:
        return cached[1]

    profile, google_connection, backend_rows = _backend_source(
        normalized_user_id,
        range_start,
        range_end,
    )
    config = _require_google_ads_environment()
    refresh_token = str(google_connection.get("refresh_token") or "").strip()
    access_token = _refresh_access_token(refresh_token, config)
    account, configured_login, manager_ids = _resolve_google_ads_customer(
        access_token,
        config["developer_token"],
        google_connection.get("customer_ids"),
    )
    raw_campaign_rows, used_login = _campaign_rows(
        account,
        range_start,
        range_end,
        access_token,
        config["developer_token"],
        configured_login,
        manager_ids,
    )
    campaign_rows = _normalize_campaign_rows(raw_campaign_rows)
    merged = merge_workbench_sources(campaign_rows, backend_rows, range_start, range_end)
    result = {
        "ok": True,
        "generatedAt": utc_now_iso(),
        "dateRange": {
            "startDate": range_start.isoformat(),
            "endDate": range_end.isoformat(),
            "dayCount": (range_end - range_start).days + 1,
        },
        "publisher": {
            "userId": normalized_user_id,
            "userName": str(profile.get("user_name") or normalized_user_id),
            "adminName": str(profile.get("admin_name") or "Unknown"),
        },
        "googleAds": {
            "customerId": account["customerId"],
            "descriptiveName": account["descriptiveName"],
            "currencyCode": account["currencyCode"],
            "timeZone": account["timeZone"],
            "testAccount": account["testAccount"],
            "apiVersion": _google_ads_api_version(),
            "loginCustomerId": used_login,
        },
        "sources": {
            "googleAds": "GoogleAdsService.SearchStream campaign metrics",
            "backendOrders": "cnpscy_amazon_order",
            "backendClicks": "cnpscy_amazon_order.total_clicks with cnpscy_amazon_click.click fallback",
            "joinGrain": "merchant + date",
            "joinRule": "Manual alias, ASIN, then normalized merchant name",
            "attributionCaveat": (
                "Amazon backend rows do not contain a Google campaign ID or gclid. "
                "Revenue and orders are compared at merchant-day level and are not campaign-level causal attribution."
            ),
        },
        **merged,
    }
    with _workbench_cache_lock:
        _workbench_cache[cache_key] = (now, result)
    return result
