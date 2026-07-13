#!/usr/bin/env bash
# init.sh — single-command verification for offer-intelligence-main
# Run before claiming work is done. Exits 0 only when all checks pass.
set -euo pipefail

PASS=0
FAIL=0
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

say() { echo -e "${2:-}" "$1${NC}"; }
pass() { say "  ✅ $1" "$GREEN"; PASS=$((PASS + 1)); }
fail() { say "  ❌ $1" "$RED"; FAIL=$((FAIL + 1)); }

run_check() {
  local label="$1"; shift
  if "$@" > /dev/null 2>&1; then
    pass "$label"
  else
    fail "$label — run manually: $*"
  fi
}

echo "=== JS syntax checks ==="
run_check "public/app.js"                    node --check public/app.js
run_check "public/auth.js"                   node --check public/auth.js
run_check "public/chatbot_i18n.js"           node --check public/chatbot_i18n.js
run_check "public/tier2_recommendation_rules.js" node --check public/tier2_recommendation_rules.js

echo ""
echo "=== Python compilation checks ==="
for f in auth.py browser_payloads.py protected_payloads.py server.py offer_db.py \
         llm_classify.py llm_provider.py; do
  run_check "$f" python -m py_compile "$f"
done
for f in api/auth/login.py api/auth/session.py api/auth/logout.py api/auth/data.py \
         api/db/index.py \
         api/ui/db/merchant.py api/ui/db/search.py api/ui/db/status.py \
         api/levanta/payments.py api/tier_moves.py; do
  run_check "$f" python -m py_compile "$f"
done

echo ""
echo "=== Unit / flow tests ==="
run_check "test_auth_helpers.py"            python scripts/test_auth_helpers.py
run_check "test_vercel_function_budget.py" python scripts/test_vercel_function_budget.py
run_check "test_vercel_db_wsgi.py"         python scripts/test_vercel_db_wsgi.py
run_check "test_tier_visual_status_rules.py" python scripts/test_tier_visual_status_rules.py
run_check "test_payment_placeholders.py"    python -m scripts.test_payment_placeholders
run_check "test_chatbot_intent_flow.mjs"    node scripts/test_chatbot_intent_flow.mjs
run_check "test_zh_chatbot.mjs"             node scripts/test_zh_chatbot.mjs
run_check "test_tier2_recommendation_rules.mjs" node scripts/test_tier2_recommendation_rules.mjs
run_check "test_sheet_categories.mjs"       node scripts/test_sheet_categories.mjs
run_check "test_tier_visual_status.mjs"     node scripts/test_tier_visual_status.mjs
run_check "test_db_status_view_model.mjs"   node scripts/test_db_status_view_model.mjs
run_check "test_target_month_selection.mjs" node scripts/test_target_month_selection.mjs

echo ""
echo "========================================"
if [ "$FAIL" -eq 0 ]; then
  say "All $PASS checks passed." "$GREEN"
  echo "Ready to commit."
  exit 0
else
  say "$PASS passed, $FAIL FAILED." "$RED"
  exit 1
fi
