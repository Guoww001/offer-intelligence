# Vercel Function Budget

The production project uses six Python Function entrypoints, leaving six slots
under the Vercel Hobby limit of twelve:

- `api/auth/index.py` serves login, logout, and session routes.
- `api/chat/actions.py` serves classify and analyze; streaming stays isolated in
  `api/chat/stream.py`.
- `api/db/index.py` serves internal token-protected DB routes and session-protected
  UI DB routes without mixing their authorization models.
- `api/levanta/payments.py` imports the lightweight `levanta_payments.py` module.
- `api/tier_moves.py` stays isolated.

`vercel.json` maps the existing public URLs to consolidated entrypoints and sets
a trusted per-group route header. Direct calls to a consolidated entrypoint with
an unknown or missing route header return `404`.

## Packaging boundaries

- `api/db/index.py` includes `protected_data/**` because it owns the DB cache
  fallback.
- `api/levanta/payments.py` includes only
  `protected_data/db_offers_cache.json` for merchant enrichment.
- Auth, Chat, and tier-move functions do not include protected cache files.
- Function bundles also exclude local-only sources such as `docs/`, `data/`,
  `output/`, `public/`, test scripts, workflow files, and `server.py`; static
  assets in `public/` are still emitted separately by `outputDirectory`.

Run `python scripts/test_vercel_function_budget.py` to enforce the exact six-file
layout, route transforms, packaging boundaries, and the Python 3.12 runtime
required by the current Vercel Python builder.

After `vercel build --prod`, run
`python scripts/test_vercel_build_output.py` to inspect the generated
`.vc-config.json` maps and verify the runtime, cache boundaries, excluded
directories, and separately emitted static site.
