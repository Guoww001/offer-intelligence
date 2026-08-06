import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / ".vercel" / "output"
FUNCTIONS_ROOT = OUTPUT_ROOT / "functions"

EXPECTED_PROTECTED_FILES = {
    "api/auth/index.func": set(),
    "api/chat/actions.func": set(),
    "api/chat/stream.func": set(),
    "api/db/index.func": {
        "protected_data/db_keywords_cache.json",
        "protected_data/db_offers_cache.json",
        "protected_data/db_publishers_cache.json",
    },
    "api/levanta/payments.func": {"protected_data/db_offers_cache.json"},
    "api/tier_moves.func": set(),
}
NON_RUNTIME_PREFIXES = (".github/", "data/", "docs/", "output/", "public/", "scripts/")


def main():
    if not FUNCTIONS_ROOT.is_dir():
        raise AssertionError("missing .vercel/output; run `vercel build --prod` first")

    bundles = {
        path.relative_to(FUNCTIONS_ROOT).as_posix(): path
        for path in FUNCTIONS_ROOT.rglob("*.func")
        if path.is_dir()
    }
    if set(bundles) != set(EXPECTED_PROTECTED_FILES):
        raise AssertionError(
            "unexpected Vercel build functions: " + ", ".join(sorted(bundles))
        )

    total_source_bytes = 0
    for name, bundle in sorted(bundles.items()):
        config = json.loads((bundle / ".vc-config.json").read_text(encoding="utf-8"))
        if config.get("runtime") != "python3.12":
            raise AssertionError(f"{name} must use python3.12")

        paths = set(config.get("filePathMap", {}))
        protected = {path for path in paths if path.startswith("protected_data/")}
        if protected != EXPECTED_PROTECTED_FILES[name]:
            raise AssertionError(
                f"{name} protected files differ: {', '.join(sorted(protected)) or '(none)'}"
            )

        leaks = {
            path
            for path in paths
            if path == "server.py" or path.startswith(NON_RUNTIME_PREFIXES)
        }
        if leaks:
            raise AssertionError(f"{name} contains non-runtime files: {', '.join(sorted(leaks))}")

        for path in paths:
            if path.startswith("_vendor/"):
                continue
            local_path = ROOT / Path(path)
            if local_path.is_file():
                total_source_bytes += local_path.stat().st_size

    static_files = [path for path in (OUTPUT_ROOT / "static").rglob("*") if path.is_file()]
    if not static_files:
        raise AssertionError("Vercel build did not emit the public static site")

    print(
        "Vercel build output checks passed "
        f"({len(bundles)} functions; python3.12; "
        f"mapped_source={total_source_bytes / (1024 * 1024):.2f} MiB; "
        f"static_files={len(static_files)})"
    )


if __name__ == "__main__":
    main()
