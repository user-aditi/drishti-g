"""V2 — pull the Brooklyn slice and keep it on disk.

    python -m drishti_research.nyc_pull [--refresh]

This is the only module that writes ``research/data/nyc/brooklyn.csv``, and
everything downstream — the panel, the study, the backend importer — reads that
file rather than the API. That indirection is deliberate. A study whose input
changes every time it runs cannot be replicated, and NYC 311 is updated daily:
re-pulling in March and re-pulling in April give different corpora and therefore
different numbers, with nothing in the results to say why. The CSV is the frozen
corpus, and ``brooklyn.meta.json`` records when it was taken and what filter
produced it, so the paper can state its vintage.

The pull is skipped when the file already exists. ``--refresh`` forces a new one,
which should be a deliberate act with a note in the fault register rather than
something that happens because a script was re-run.

On the row count
----------------
Gate 0 wants more than 150,000 rows and all 18 community boards. If the count
comes in short, the fix in the plan is to widen to all five boroughs rather than
to loosen the complaint-type filter — the six types are what map onto our
categories, and adding a seventh to make a number would be choosing data to fit
a threshold.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone

import pandas as pd

from .nyc import (
    BOROUGH,
    COMPLAINT_TYPES,
    DATA,
    DATASET,
    PERIOD_END,
    PERIOD_START,
    board_number,
    fetch_csv,
    slice_where,
)

CORPUS = DATA / "brooklyn.csv"
PARTS = DATA / "parts"
MANIFEST = DATA / "brooklyn.meta.json"

#: Gate 0's thresholds for this step.
MIN_ROWS = 150_000
EXPECTED_BOARDS = 18


def pull() -> pd.DataFrame:
    """The slice, in resumable pages.

    Over the CSV export endpoint, not the JSON one. On this column list the JSON
    endpoint failed to deliver a single page in eight minutes at either 50,000 or
    10,000 rows a page, twice; the export endpoint returns 100,000 rows in about
    forty seconds. That is F-17, and the note on ``nyc.EXPORT_PAGE`` carries the
    measurements. Parts land in ``parts/`` as they arrive, so a failure costs one
    page rather than the whole pull.
    """
    where = slice_where()
    print(f"V2 - pulling the Brooklyn slice\n{where}\n")
    started = time.time()
    frame = fetch_csv(where, cache=PARTS)
    print(f"\npulled {len(frame):,} requests in {time.time() - started:.1f}s")
    return frame


def annotate(frame: pd.DataFrame) -> pd.DataFrame:
    """Add the two derived columns every downstream consumer needs.

    ``board`` because ``community_board`` is a display string, and
    ``resolution_hours`` because the time-to-close is the one measurement that
    both the panel and the fidelity check in Gate 2 are defined over. Everything
    else stays exactly as Socrata gave it, so the CSV can still be diffed against
    the source.
    """
    frame = frame.copy()
    frame["board"] = frame["community_board"].map(board_number)
    created = pd.to_datetime(frame["created_date"], errors="coerce")
    closed = pd.to_datetime(frame["closed_date"], errors="coerce")
    hours = (closed - created).dt.total_seconds() / 3600.0
    frame["resolution_hours"] = hours.where(hours >= 0)
    return frame


def report(frame: pd.DataFrame) -> dict:
    """Print the Gate 0 checks and return them for the manifest."""
    boards = sorted(int(b) for b in frame["board"].dropna().unique())
    missing = sorted(set(range(1, EXPECTED_BOARDS + 1)) - set(boards))
    unplaced = int(frame["board"].isna().sum())

    print(f"\n{'complaint type':<26}{'requests':>10}{'agency':>10}{'closed':>9}")
    by_type = frame.groupby("complaint_type").agg(
        requests=("unique_key", "size"),
        agency=("agency", lambda s: s.mode().iat[0] if not s.mode().empty else "?"),
        closed=("closed_date", "count"),
    )
    for name, row in by_type.sort_values("requests", ascending=False).iterrows():
        print(
            f"{name:<26}{row['requests']:>10,}{row['agency']:>10}"
            f"{row['closed'] / row['requests']:>9.1%}"
        )

    print(f"\nboards present: {len(boards)} of {EXPECTED_BOARDS}")
    if missing:
        print(f"  missing: {missing}")
    print(f"unplaceable requests (no community board): {unplaced:,} ({unplaced / len(frame):.1%})")
    print(f"period: {frame['created_date'].min()} to {frame['created_date'].max()}")

    checks = {
        "rows": len(frame),
        "rows_pass": len(frame) >= MIN_ROWS,
        "boards": len(boards),
        "boards_pass": not missing,
        "unplaced": unplaced,
    }
    print(
        f"\nGate 0 - rows >= {MIN_ROWS:,}: {'PASS' if checks['rows_pass'] else 'FAIL'}"
        f"   all {EXPECTED_BOARDS} boards: {'PASS' if checks['boards_pass'] else 'FAIL'}"
    )
    if not checks["rows_pass"]:
        print("  short of the threshold - widen to all five boroughs, not to more complaint types")
    return checks


def run(refresh: bool = False) -> pd.DataFrame:
    if CORPUS.exists() and not refresh:
        print(f"{CORPUS.name} already exists - reading it. Pass --refresh to pull again.")
        frame = pd.read_csv(CORPUS, dtype={"unique_key": str, "incident_zip": str})
        report(frame)
        return frame

    if refresh and PARTS.exists():
        # Cached parts belong to the filter that produced them. A refresh is a
        # new corpus, so they are stale by definition rather than reusable.
        for part in PARTS.glob("part-*.csv"):
            part.unlink()

    frame = annotate(pull())
    DATA.mkdir(parents=True, exist_ok=True)
    frame.to_csv(CORPUS, index=False)
    checks = report(frame)

    MANIFEST.write_text(
        json.dumps(
            {
                "dataset": DATASET,
                "pulled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "borough": BOROUGH,
                "period": [PERIOD_START, PERIOD_END],
                "complaint_types": list(COMPLAINT_TYPES),
                "where": slice_where(),
                "checks": checks,
                "attribution": "NYC Open Data, 311 Service Requests (erm2-nwe9)",
            },
            indent=2,
        )
        + "\n"
    )
    print(f"\nwritten to {CORPUS} and {MANIFEST.name}")
    return frame


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="re-pull even though the corpus exists; changes every downstream number",
    )
    run(**vars(parser.parse_args()))
