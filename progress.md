# Progress

> Last updated: 2026-09-04. Active migration milestone, verification evidence, and next step.

## Active milestone

**M07 — legacy frontend removal**

Branch: `codex/m07-completion` (target: `FRONTEND-VUE-MIGRATION`)
Status: **implementation complete; full regression and commit in progress**

### Completed scope

- Standalone Vue Runtime owns authentication handoff, Shell, navigation, language, and all 12 pages.
- CopilotKit/AG-UI remains the default Agent transport with Python registry/proof as authority.
- The old page DOM, `public/app.js`, `public/styles.css`, auxiliary scripts, and `frontend/src/legacy/` are removed.
- Runtime legacy switches and old test globals are removed; rollback now uses the previous deploy.
- Source-string tests were replaced with Vue behavior, runtime/build, shared XLSX, and Python protocol tests.

### Verification

```bash
npm run test:copilotkit
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node scripts/test_frontend_migration_inventory.mjs
node scripts/test_frontend_build_contract.mjs
node scripts/test_m4_shell_frontend.mjs
node scripts/test_modern_page_cutover.mjs
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
node scripts/test_m6_modern_mount.mjs
node scripts/test_m7_modern_entry.mjs
python scripts/test_agent_agui.py
```

### Next step

Complete the full CI-equivalent regression, create the bilingual M07 removal commit, and push both M07 commits to `FRONTEND-VUE-MIGRATION` after confirming the remote head.
