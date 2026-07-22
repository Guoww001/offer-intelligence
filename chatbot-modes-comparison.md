# Quick Mode vs Deep Reasoning Mode

## Quick Mode (快速模式)

**Workflow** (primarily frontend-based):

```
User Input → LLM Intent Classification (or regex fallback) → answerPrompt() routing → Rendered from browser memory instantly
                                                                                   └→ Optional: async LLM analysis text
```

- After user input, calls `/api/chat/classify` for LLM intent classification (7 intents) + parameter extraction (entity, filters, sort, etc.)
- If LLM is unavailable, automatically degrades to frontend regex matching via `detectQueryIntent()`
- Once intent is determined, **all data computation happens in browser memory** (`window.CHATBOT_DATA.offers[]`), with millisecond response times
- Only the `analysis` intent makes an additional async call to `/api/chat/analyze` for narrative text generation (with template fallback on failure)

**Supported features:**
- Merchant lookup (`"Shokz EPC"`)
- Category browsing (`"What's in Electronics"`)
- Tier overview (`"Tier 2 merchants"`)
- Payment tracking (`"Unpaid April payments"`)
- Recommendation ranking (`"Top 10 Tier 1 by AOV"`)
- Keyword search (`"Find Bluetooth headset merchants"`)
- ASIN lookup (`"B0D2HKCMBP"`)
- Basic analysis (`"Analyze Shokz"`, `"Which Tier 2 merchants should be upgraded to Tier 1"`)

**Use cases:**
- Everyday quick Q&A and data browsing
- Queries for known merchants, categories, or tiers
- Interactive conversations requiring instant responses
- Fully functional even with unstable network or unavailable LLM API (regex fallback)

---

## Deep Reasoning Mode (深度推理模式)

**Workflow** (3-stage pipeline, fully server-side):

```
Stage 1 (LLM)         Stage 2 (Python)                Stage 3 (LLM)
User Question  →  Parse into        →  Execute query     →  Generate report   →  Frontend renders
                  structured query      from cache/DB       (narrative +          floating panel
                  plan (JSON)           (≤2mo JSON cache     tables + insights)
                                        (>2mo MySQL)
```

- **Stage 1 `parse_query()`**: LLM converts user question into a structured JSON query plan, containing `analysisType` (comparison/trend/ranking/overview/anomaly/distribution), `entityType` (merchant/category/tier), entity list, metrics, time range, comparison type, etc.
- **Stage 2 `execute_query_plan()`**: Executes the data query based on the plan. Uses `db_offers_cache.json` for ≤2 months, MySQL for historical data (>2 months). Supports tier/category filtering, grouping, aggregation, and peer comparison.
- **Stage 3 `generate_report()`**: LLM generates a natural language report from the structured data (title, summary, analysis narrative, key findings, recommendations, data tables).
- Frontend has a dedicated floating panel UI with 3-step skeleton loading indicators, minimize/expand/close controls, and historical summary cards.

**Supported features:**
- Cross-entity comparison (`"Compare EPC of Shokz and Anker in Tier 1"`)
- Trend analysis (`"AOV trend of Beauty category over the past 3 months"`)
- Distribution analysis (`"Category distribution across Tiers 1-3"`)
- Ranking analysis (`"Tier 2 merchants ranked by sales"`)
- Anomaly detection (`"Which merchants have abnormal conversion rates this month"`)
- Multi-dimensional cross-analysis (`"AOV trend of beauty merchants in Tier 2"`)

**Use cases:**
- Complex questions requiring comparative analysis
- Cross-dimensional analysis (category × Tier × time)
- Exploratory trend and distribution analysis
- Deep analysis requiring a complete narrative report
- Scenarios demanding high data accuracy and analytical depth

---

## Key Differences

| Dimension | Quick Mode | Deep Reasoning Mode |
|-----------|-----------|-------------------|
| **Data processing** | Browser memory (milliseconds) | Server-side Python (network-dependent) |
| **LLM calls** | 1 call (intent classification, skippable) | 2 calls (parsing + report generation) |
| **Data source** | `window.CHATBOT_DATA` (in-memory) | `db_offers_cache.json` / MySQL |
| **Data freshness** | Snapshot at page load time | Historical trends available (>2 months via DB) |
| **Response format** | Structured UI (stat cards + tables) | Natural language narrative + data tables + insights |
| **Interaction UI** | Chat message stream | Floating panel (minimizable/expandable) |
| **Fallback capability** | LLM failure → full regex fallback (still functional) | LLM failure → error message |
| **Suitable questions** | "Top 5 merchants by EPC" | "Compare AOV and conversion rate differences between Beauty in Tier 2 and Tier 3" |

---

In short: **Quick Mode is for everyday conversational data queries** — lightweight, instant, and reliable. **Deep Reasoning Mode is a professional data analysis assistant** — capable of handling more complex cross-dimensional analysis but slower and dependent on LLM availability. They complement each other; switch between modes in the UI based on question complexity.
