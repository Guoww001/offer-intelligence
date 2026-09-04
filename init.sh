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
run_check "public/auth.js"                   node --check public/auth.js

echo ""
echo "=== Modern frontend checks ==="
run_check "CopilotKit runtime tests" npm run test:copilotkit
run_check "Vue typecheck" npm --prefix frontend run typecheck
run_check "Vue tests" npm --prefix frontend run test -- --run
run_check "Vue production build" npm --prefix frontend run build

echo ""
echo "=== Python compilation checks ==="
for f in auth.py server.py offer_db.py levanta_payments.py llm_classify.py llm_provider.py; do
  run_check "$f" python -m py_compile "$f"
done
for f in api/auth/index.py api/chat/actions.py api/chat/stream.py \
         api/db/index.py api/levanta/payments.py api/tier_moves.py; do
  run_check "$f" python -m py_compile "$f"
done

echo ""
echo "=== Unit / flow tests ==="
run_check "test_auth_helpers.py"            python scripts/test_auth_helpers.py
run_check "test_vercel_function_budget.py" python scripts/test_vercel_function_budget.py
run_check "test_vercel_db_wsgi.py"         python scripts/test_vercel_db_wsgi.py
run_check "test_vercel_auth_routes.py"      python scripts/test_vercel_auth_routes.py
run_check "test_vercel_chat_routes.py"      python scripts/test_vercel_chat_routes.py
run_check "test_vercel_payment_packaging.py" python scripts/test_vercel_payment_packaging.py
run_check "test_llm_stream_timeout.py"      python scripts/test_llm_stream_timeout.py
run_check "test_tier_visual_status_rules.py" python scripts/test_tier_visual_status_rules.py
run_check "test_merchant_aov_estimates.py" python scripts/test_merchant_aov_estimates.py
run_check "test_payment_placeholders.py"    python -m scripts.test_payment_placeholders
run_check "test_frontend_migration_inventory.mjs" node scripts/test_frontend_migration_inventory.mjs
run_check "test_frontend_build_contract.mjs" node scripts/test_frontend_build_contract.mjs
run_check "test_m4_shell_frontend.mjs" node scripts/test_m4_shell_frontend.mjs
run_check "test_modern_page_cutover.mjs" node scripts/test_modern_page_cutover.mjs
run_check "test_m6_chatbot_agent_behavior_parity.mjs" node scripts/test_m6_chatbot_agent_behavior_parity.mjs
run_check "test_m6_modern_mount.mjs" node scripts/test_m6_modern_mount.mjs
run_check "test_m7_modern_entry.mjs" node scripts/test_m7_modern_entry.mjs
run_check "test_sheet_categories.mjs"       node scripts/test_sheet_categories.mjs

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
