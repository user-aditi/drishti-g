"""BPI Challenge 2018 as a second governance panel.

    python -m drishti_research.bpic2018

Why a second log at all
-----------------------
Every number in the interpretability study's real-data arm comes from BPI
Challenge 2015 — five Dutch municipalities that share one code scheme, one
regulator and one process design. A reviewer will point out that a finding
holding across five instances of the same system is one finding, not five, and
they will be right. This is the answer to that.

BPIC 2018 is a different country, agency, domain and decade of software: EU
direct-payment applications from German farmers, handled by federal and local
departments through the *profil c/s* system, 43,809 cases and 2.5 million events
across three years. If the interpretability result holds here too, it stops
being a fact about Dutch building permits.

Why it fits without forcing
---------------------------
The shape a governance panel needs is an organisational unit processing
citizen-initiated cases under a statutory clock, with an outcome worth
forecasting. This has all four natively, which matters — the BPIC 2015 arm had
to *construct* its label, and every construction is a decision a reviewer can
argue with.

``department``  the org unit, given as a case attribute
``org:resource``  the case worker, on every event
``rejected``  a real outcome, recorded rather than derived
``penalty_*``  around a dozen penalty flags, which are the process's own
              judgement that something went wrong

The extraction is one streaming pass producing one row per case. Parsing 2.5
million events takes a couple of minutes and the result is 44,000 rows, so it is
cached: the study reruns in seconds afterwards.
"""

from __future__ import annotations

import gzip
import re
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
LOG = ROOT / "research" / "data" / "bpic2018" / "BPI_Challenge_2018.xes.gz"
CACHE = ROOT / "research" / "data" / "bpic2018" / "cases.csv"

#: Case attributes worth keeping. The penalty flags are collapsed into a count
#: rather than kept individually — a dozen near-empty boolean columns would add
#: width without adding signal, and "how many things went wrong with this
#: application" is the quantity the analogue actually wants.
CASE_KEEP = {
    "department",
    "year",
    "rejected",
    "risk_factor",
    "selected_random",
    "small farmer",
    "young farmer",
    "cross_compliance",
    "greening",
    "applicant",
    "application",
}

ATTR = re.compile(r'<(\w+) key="([^"]+)" value="([^"]*)"')

#: Most of the busiest `org:resource` values are software, not people.
#:
#: "Processing automaton" alone accounts for 165,000 events — more than any
#: human — and treating it as a case worker would build a panel whose largest
#: unit is a batch job. Humans in this log are opaque six-character
#: identifiers; the named, space-containing values are systems.
AUTOMATA = {
    "Processing automaton",
    "Document processing automaton",
    "Reference alignment processor",
    "Remote inspection export",
    "DP-Z",
    "0;n/a",
}


def owner(resources: Counter[str]) -> str | None:
    """The human who touched this case most, or None if only software did.

    Picking a resource arbitrarily — the first, or the alphabetically last —
    silently mixes people and batch jobs, and the resulting panel measures
    neither. Cases handled entirely by automation have no owner and are dropped
    from the panel rather than attributed to a machine.
    """
    human = Counter({r: n for r, n in resources.items() if r not in AUTOMATA and " " not in r})
    return human.most_common(1)[0][0] if human else None


def parse() -> pd.DataFrame:
    """One row per case, from a single streaming pass over the compressed log."""
    rows: list[dict] = []
    case: dict = {}
    events = 0
    first_ts: str | None = None
    last_ts: str | None = None
    subprocesses: set[str] = set()
    resources: Counter[str] = Counter()
    in_event = False

    def flush() -> None:
        if not case:
            return
        rows.append(
            {
                **{k: case.get(k) for k in CASE_KEEP},
                "penalties": sum(
                    1 for k, v in case.items() if k.startswith("penalty_") and v == "true"
                ),
                "events": events,
                "started": first_ts,
                "finished": last_ts,
                "subprocesses": len(subprocesses),
                "resources": len(resources),
                # The person who touched the case most is the closest thing to
                # an owner, and ownership is what a panel is built on.
                "resource": owner(resources),
            }
        )

    with gzip.open(LOG, "rt", encoding="utf-8") as handle:
        for line in handle:
            s = line.strip()

            if s.startswith("<trace"):
                case, events, first_ts, last_ts = {}, 0, None, None
                subprocesses, resources, in_event = set(), Counter(), False
                continue
            if s.startswith("</trace"):
                flush()
                case = {}
                continue
            if s.startswith("<event"):
                in_event = True
                events += 1
                continue

            m = ATTR.match(s)
            if not m:
                continue
            key, value = m.group(2), m.group(3)

            if in_event:
                if key == "time:timestamp":
                    if first_ts is None:
                        first_ts = value
                    last_ts = value
                elif key == "subprocess":
                    subprocesses.add(value)
                elif key == "org:resource":
                    resources[value] += 1
            else:
                case[key] = value

    frame = pd.DataFrame(rows)
    frame["started"] = pd.to_datetime(frame["started"], utc=True, format="ISO8601")
    frame["finished"] = pd.to_datetime(frame["finished"], utc=True, format="ISO8601")
    frame["days"] = (frame["finished"] - frame["started"]).dt.total_seconds() / 86400
    frame["rejected"] = frame["rejected"].astype(str).str.lower().eq("true")
    return frame


def load(refresh: bool = False) -> pd.DataFrame:
    """Cached case table. Parse once, study many times."""
    if CACHE.exists() and not refresh:
        frame = pd.read_csv(CACHE, parse_dates=["started", "finished"])
        return frame

    if not LOG.exists():
        raise SystemExit(
            f"No log at {LOG}.\n"
            "Download BPI Challenge 2018 from 4TU.ResearchData "
            "(DOI 10.4121/uuid:3301445f-95e8-4ff0-98a4-901f1f204972)."
        )

    frame = parse()
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(CACHE, index=False)
    return frame


def main() -> None:
    frame = load(refresh=True)

    print(f"--- BPI Challenge 2018 --- {len(frame):,} cases")
    print(f"    {frame['events'].sum():,} events")
    print(f"    {frame['started'].min().date()} to {frame['finished'].max().date()}")
    print()
    print(f"  departments   {frame['department'].nunique()}")
    print(f"  case workers  {frame['resource'].nunique()}")
    print(f"  years         {sorted(frame['year'].dropna().unique())}")
    print(f"  rejected      {frame['rejected'].mean():.1%}")
    print(f"  any penalty   {(frame['penalties'] > 0).mean():.1%}")
    print()
    print("  throughput days:")
    print(frame["days"].describe()[["mean", "50%", "75%", "max"]].to_string())
    print()
    print("  cases per department:")
    print(frame["department"].value_counts().head(10).to_string())
    print(f"\n  cached to {CACHE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
