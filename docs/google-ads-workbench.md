# Google Ads workbench

The workbench connects Google Ads campaign delivery with YeahPromos Amazon
backend returns for one media account. The initial UI is pinned to
`v_maxai_cnpscy_user.user_id = 19` (`asdf260821`).

## Server configuration

Set these values only in the local process or deployment environment. Do not
place them in `public/`, Git-tracked `.env` files, screenshots, or browser
storage.

```text
GOOGLE_ADS_CLIENT_ID
GOOGLE_ADS_CLIENT_SECRET
GOOGLE_ADS_DEVELOPER_TOKEN
```

Optional values:

```text
GOOGLE_ADS_API_VERSION=v25
GOOGLE_ADS_CUSTOMER_ID=1234567890
GOOGLE_ADS_LOGIN_CUSTOMER_ID=1234567890
GOOGLE_ADS_MERCHANT_ALIASES={"campaign-brand-token":385281}
```

The OAuth refresh token remains in `cnpscy_user_google_ads.refresh_token`,
keyed by `user_id`. The browser-safe API never returns the refresh token,
client secret, developer token, or access token.

## Data contract

- Google source: daily campaign impressions, clicks, cost, and native
  conversions from `GoogleAdsService.SearchStream`.
- Backend order source: `cnpscy_amazon_order`, grouped by `user_id + advert_id
  + order_time_day`.
- Backend click source: positive `cnpscy_amazon_order.total_clicks`; otherwise
  `cnpscy_amazon_click.click` is used as the fallback.
- Join rule: manual alias, unique ASIN, then normalized merchant/brand name.
- Join grain: merchant + date.

The Amazon backend rows do not contain a Google campaign ID or `gclid`.
Therefore the workbench groups all matched Google campaigns under the merchant
and counts the backend result once. It does not claim campaign-level causal
attribution. Unmatched campaign spend remains visible and is included in total
Google spend.

## Endpoint

```text
GET /api/ui/db/google-ads-workbench
  ?userId=19
  &startDate=2026-07-01
  &endDate=2026-08-26
  &refresh=1
```

The route uses the existing authenticated `/api/ui/db/*` boundary. Responses
are cached in-process for five minutes unless `refresh=1` is supplied.

## Basic Access and Standard Access

| Access level | Production accounts | Daily operations | Review target |
| --- | --- | ---: | --- |
| Basic Access | Yes | 15,000 per rolling 24 hours | Most internal tools and moderate reporting workloads |
| Standard Access | Yes | Unlimited for most operations | Large tools or tools serving many users |

Both levels are free and still subject to service-specific and system rate
limits. Standard Access is reviewed more strictly; tools used by external users
must be prepared to satisfy the applicable Required Minimum Functionality
(RMF). Basic and Standard developer tokens also have a separate "permissible
use" classification, such as reporting-only or ad management.

The token's current access level is not exposed by the Google Ads API itself.
Check it in the manager account's **Admin / API Center**.
