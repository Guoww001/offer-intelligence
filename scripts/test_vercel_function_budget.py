import json
from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]
MAX_HOBBY_FUNCTIONS = 12
TARGET_FUNCTIONS = 6
FUNCTION_EXTENSIONS = {
    ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts",
    ".py", ".go", ".rs", ".rb", ".wasm",
}


def function_files(api_root):
    return sorted(
        path.relative_to(ROOT).as_posix()
        for path in api_root.rglob("*")
        if path.is_file() and path.suffix.lower() in FUNCTION_EXTENSIONS
    )


def main():
    python_version = (ROOT / ".python-version").read_text(encoding="utf-8").strip()
    if python_version != "3.12":
        raise AssertionError(f"Vercel Python runtime must be 3.12, found {python_version!r}")
    project_config = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    requires_python = project_config.get("project", {}).get("requires-python")
    if requires_python != "~=3.12.0":
        raise AssertionError(
            "pyproject.toml must target Python ~=3.12.0 for the current Vercel runtime"
        )
    lock_config = tomllib.loads((ROOT / "uv.lock").read_text(encoding="utf-8"))
    if lock_config.get("requires-python") != "==3.12.*":
        raise AssertionError("uv.lock must be regenerated for Python 3.12")

    detected_functions = function_files(ROOT / "api")
    if len(detected_functions) > MAX_HOBBY_FUNCTIONS:
        raise AssertionError(
            f"Vercel Hobby allows at most {MAX_HOBBY_FUNCTIONS} functions; "
            f"found {len(detected_functions)}: {', '.join(detected_functions)}"
        )

    expected_functions = {
        "api/auth/index.py",
        "api/chat/actions.py",
        "api/chat/stream.py",
        "api/db/index.py",
        "api/levanta/payments.py",
        "api/tier_moves.py",
    }
    if set(detected_functions) != expected_functions:
        raise AssertionError(
            f"expected the optimized {TARGET_FUNCTIONS}-function layout; "
            f"found {len(detected_functions)}: {', '.join(detected_functions)}"
        )

    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    expected_routes = {
        "^/api/db/status/?$": ("/api/db/index", "x-oi-db-route", "status"),
        "^/api/db/merchant/?$": ("/api/db/index", "x-oi-db-route", "merchant"),
        "^/api/db/search/?$": ("/api/db/index", "x-oi-db-route", "search"),
        "^/api/ui/db/status/?$": ("/api/db/index", "x-oi-db-route", "ui-status"),
        "^/api/ui/db/merchant/?$": ("/api/db/index", "x-oi-db-route", "ui-merchant"),
        "^/api/ui/db/search/?$": ("/api/db/index", "x-oi-db-route", "ui-search"),
        "^/api/ui/db/keywords/?$": ("/api/db/index", "x-oi-db-route", "ui-keywords"),
        "^/api/ui/db/offers/?$": ("/api/db/index", "x-oi-db-route", "ui-offers"),
        "^/api/ui/db/tier_sheet/?$": ("/api/db/index", "x-oi-db-route", "ui-tier-sheet"),
        "^/api/ui/db/tier-summary/?$": ("/api/db/index", "x-oi-db-route", "ui-tier-summary"),
        "^/api/ui/db/tier1-merchants/?$": ("/api/db/index", "x-oi-db-route", "ui-tier1-merchants"),
        "^/api/ui/db/monthly-new-merchants/?$": (
            "/api/db/index",
            "x-oi-db-route",
            "ui-monthly-new-merchants",
        ),
        "^/api/ui/db/publishers/?$": ("/api/db/index", "x-oi-db-route", "ui-publishers"),
        "^/api/ui/db/google-ads-workbench/?$": (
            "/api/db/index",
            "x-oi-db-route",
            "ui-google-ads-workbench",
        ),
        "^/api/auth/login/?$": ("/api/auth/index", "x-oi-auth-route", "login"),
        "^/api/auth/logout/?$": ("/api/auth/index", "x-oi-auth-route", "logout"),
        "^/api/auth/session/?$": ("/api/auth/index", "x-oi-auth-route", "session"),
        "^/api/chat/classify/?$": ("/api/chat/actions", "x-oi-chat-route", "classify"),
        "^/api/chat/analyze/?$": ("/api/chat/actions", "x-oi-chat-route", "analyze"),
    }
    configured_routes = config.get("routes", [])
    for source, (destination, header_name, route_name) in expected_routes.items():
        matches = [item for item in configured_routes if item.get("src") == source]
        if len(matches) != 1:
            raise AssertionError(f"expected one trusted DB route for {source}, found {len(matches)}")
        route = matches[0]
        if route.get("dest") != destination:
            raise AssertionError(f"route {source} must target {destination}")
        expected_transform = {
            "type": "request.headers",
            "op": "set",
            "target": {"key": header_name},
            "args": route_name,
        }
        if route.get("transforms") != [expected_transform]:
            raise AssertionError(f"route {source} must set its trusted route header")

    if not (ROOT / "api" / "db" / "index.py").is_file():
        raise AssertionError("missing consolidated WSGI entrypoint api/db/index.py")

    common_excludes = (
        "{.git/**,.github/**,data/**,docs/**,output/**,public/**,scripts/**,"
        "*.md,*.txt,*.yml,init.sh,server.py}"
    )
    no_protected_excludes = (
        "{.git/**,.github/**,data/**,docs/**,output/**,public/**,scripts/**,"
        "protected_data/**,*.md,*.txt,*.yml,init.sh,server.py}"
    )
    levanta_excludes = (
        "{.git/**,.github/**,data/**,docs/**,output/**,public/**,scripts/**,"
        "protected_data/db_keywords_cache.json,protected_data/db_publishers_cache.json,"
        "*.md,*.txt,*.yml,init.sh,server.py}"
    )
    common_config = {
        "excludeFiles": no_protected_excludes,
        "maxDuration": 60,
    }
    expected_function_config = {
        "api/auth/index.py": dict(common_config),
        "api/chat/actions.py": dict(common_config),
        "api/chat/stream.py": dict(common_config),
        "api/db/index.py": {
            "excludeFiles": common_excludes,
            "maxDuration": 60,
            "includeFiles": "protected_data/**",
        },
        "api/levanta/payments.py": {
            "excludeFiles": levanta_excludes,
            "maxDuration": 60,
            "includeFiles": "protected_data/db_offers_cache.json",
        },
        "api/tier_moves.py": dict(common_config),
    }
    if config.get("functions") != expected_function_config:
        raise AssertionError(
            "Vercel function packaging must attach protected data only to the "
            "DB and Levanta payment functions"
        )

    synthetic_extensions = [Path(f"api/function-{index}.py") for index in range(12)]
    synthetic_extensions.append(Path("api/function-extra.rb"))
    synthetic_count = sum(path.suffix in FUNCTION_EXTENSIONS for path in synthetic_extensions)
    if synthetic_count != 13:
        raise AssertionError("non-Python Vercel Functions must count toward the deployment budget")

    print(
        f"Vercel function budget checks passed "
        f"({len(detected_functions)}/{MAX_HOBBY_FUNCTIONS}; "
        f"target={TARGET_FUNCTIONS})"
    )


if __name__ == "__main__":
    main()
