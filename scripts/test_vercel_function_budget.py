import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAX_HOBBY_FUNCTIONS = 12
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
    detected_functions = function_files(ROOT / "api")
    if len(detected_functions) > MAX_HOBBY_FUNCTIONS:
        raise AssertionError(
            f"Vercel Hobby allows at most {MAX_HOBBY_FUNCTIONS} functions; "
            f"found {len(detected_functions)}: {', '.join(detected_functions)}"
        )

    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    expected_routes = {
        "^/api/db/status/?$": "status",
        "^/api/db/merchant/?$": "merchant",
        "^/api/db/search/?$": "search",
    }
    configured_routes = config.get("routes", [])
    for source, route_name in expected_routes.items():
        matches = [item for item in configured_routes if item.get("src") == source]
        if len(matches) != 1:
            raise AssertionError(f"expected one trusted DB route for {source}, found {len(matches)}")
        route = matches[0]
        if route.get("dest") != "/api/db/index":
            raise AssertionError(f"DB route {source} must target /api/db/index")
        expected_transform = {
            "type": "request.headers",
            "op": "set",
            "target": {"key": "x-oi-db-route"},
            "args": route_name,
        }
        if route.get("transforms") != [expected_transform]:
            raise AssertionError(f"DB route {source} must set its trusted route header")

    if not (ROOT / "api" / "db" / "index.py").is_file():
        raise AssertionError("missing consolidated WSGI entrypoint api/db/index.py")

    synthetic_extensions = [Path(f"api/function-{index}.py") for index in range(12)]
    synthetic_extensions.append(Path("api/function-extra.rb"))
    synthetic_count = sum(path.suffix in FUNCTION_EXTENSIONS for path in synthetic_extensions)
    if synthetic_count != 13:
        raise AssertionError("non-Python Vercel Functions must count toward the deployment budget")

    print(
        f"Vercel function budget checks passed "
        f"({len(detected_functions)}/{MAX_HOBBY_FUNCTIONS})"
    )


if __name__ == "__main__":
    main()
