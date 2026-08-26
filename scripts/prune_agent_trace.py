#!/usr/bin/env python3
"""按保留期清理 Agent Trace；默认只输出数量，不输出敏感数据。"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from agent_trace import AGENT_RUNS_TABLE, AGENT_STEPS_TABLE
from offer_db import db_connection


DEFAULT_RETENTION_DAYS = 90


def retention_days(value: str | None) -> int:
    raw = value if value is not None else os.environ.get("OI_AGENT_TRACE_RETENTION_DAYS", str(DEFAULT_RETENTION_DAYS))
    try:
        days = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("retention days must be a positive integer") from exc
    if days < 1 or days > 3650:
        raise ValueError("retention days must be between 1 and 3650")
    return days


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prune Agent Trace rows")
    parser.add_argument("--days", type=str, default=None, help="retention days override")
    parser.add_argument("--dry-run", action="store_true", help="count rows without deleting")
    args = parser.parse_args(argv)
    days = retention_days(args.days)
    cutoff = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None) - dt.timedelta(days=days)

    with db_connection() as conn:
        with conn.cursor() as cursor:
            if args.dry_run:
                cursor.execute(
                    f"SELECT COUNT(*) AS count FROM {AGENT_STEPS_TABLE} WHERE COALESCE(completedAt, startedAt) < %s",
                    (cutoff,),
                )
                steps = int((cursor.fetchone() or {}).get("count", 0))
                cursor.execute(
                    f"SELECT COUNT(*) AS count FROM {AGENT_RUNS_TABLE} WHERE COALESCE(completedAt, startedAt, createdAt) < %s",
                    (cutoff,),
                )
                runs = int((cursor.fetchone() or {}).get("count", 0))
                print(f"dry-run agent_steps={steps} agent_runs={runs} retention_days={days}")
                return 0

            cursor.execute(
                f"DELETE FROM {AGENT_STEPS_TABLE} WHERE COALESCE(completedAt, startedAt) < %s",
                (cutoff,),
            )
            steps = int(cursor.rowcount or 0)
            cursor.execute(
                f"DELETE FROM {AGENT_RUNS_TABLE} WHERE COALESCE(completedAt, startedAt, createdAt) < %s",
                (cutoff,),
            )
            runs = int(cursor.rowcount or 0)
        conn.commit()
    print(f"deleted agent_steps={steps} agent_runs={runs} retention_days={days}")
    return 0


def cli(argv: list[str] | None = None) -> int:
    try:
        return main(argv)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception:
        print(
            "Agent Trace cleanup failed; database operation was not completed.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(cli())
