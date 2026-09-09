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

#: Subprocesses that mean the case came back after being settled.
#:
#: Two distinct routes to the same governance fact. `Objection` is the applicant
#: contesting a decision — the direct analogue of BPIC 2015's `01_BB` track. A
#: `revoke decision` event is the authority reversing its own completed
#: decision. Both say a case that had been dealt with was reopened, which is
#: what GRIE's recurrence factor measures once it was corrected to mean "the
#: repair did not hold" rather than "we have seen this category before".
RETURN_SUBPROCESSES = {"Objection"}
REVOKE_ACTIVITY = "revoke decision"

#: Subprocesses that mean desk processing was not enough.
#:
#: A case routed to physical or remote inspection has left the routine track and
#: pulled in a resource beyond the handling officer. That is the structural role
#: escalation plays in DRISHTI-G: the normal path was insufficient.
INSPECTION_SUBPROCESSES = {"On-Site", "Remote"}

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

#: A resource touching more than this share of all cases is a system account.
#:
#: The named-automata set above is not sufficient. `727350` is an opaque
#: six-digit identifier indistinguishable by name from a human, and it appears
#: on **78% of all cases** — 34,290 of 43,809, a hundred times the next busiest
#: resource — with 193,100 `calculate` events against 477 `insert document`.
#: That is a batch calculation engine. No individual case worker owns a fifth of
#: a federal agency's three-year caseload, so the threshold is set at 0.20 and
#: the exclusion is derived rather than hand-listed. Naming the ID directly
#: would work and would be the obvious question at review; this rule answers it.
#:
#: Cases the engine touched are *not* dropped. Ownership falls through to the
#: most frequent human on the case, which is what the panel wants: the engine
#: ran a calculation, a person still handled the application.
MAX_HUMAN_CASE_SHARE = 0.20


def resolve_owners(per_case: list[Counter[str]]) -> tuple[list[str | None], set[str]]:
    """Assign each case its owning human, excluding derived system accounts.

    Two things have to happen in this order: a resource's case share can only be
    known after every case is read, and ownership can only be assigned once the
    system accounts are known. So the pass collects counters and this resolves
    them afterwards, rather than committing to an owner mid-stream.
    """
    appearances: Counter[str] = Counter()
    for resources in per_case:
        for r in resources:
            appearances[r] += 1

    total = len(per_case)
    systems = {
        r
        for r, n in appearances.items()
        if r in AUTOMATA or " " in r or n / total > MAX_HUMAN_CASE_SHARE
    }

    owners: list[str | None] = []
    for resources in per_case:
        human = Counter({r: n for r, n in resources.items() if r not in systems})
        owners.append(human.most_common(1)[0][0] if human else None)
    return owners, systems


def parse() -> pd.DataFrame:
    """One row per case, from a single streaming pass over the compressed log."""
    rows: list[dict] = []
    case: dict = {}
    events = 0
    first_ts: str | None = None
    last_ts: str | None = None
    subprocesses: set[str] = set()
    resources: Counter[str] = Counter()
    revoked = False
    in_event = False

    def flush() -> None:
        nonlocal revoked
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
                # A case that was settled and then reopened, either way round.
                "returned": bool(subprocesses & RETURN_SUBPROCESSES) or revoked,
                "revoked": revoked,
                "objected": bool(subprocesses & RETURN_SUBPROCESSES),
                "inspected": bool(subprocesses & INSPECTION_SUBPROCESSES),
                "resources": len(resources),
                # Owner is resolved after the pass — see `resolve_owners`.
                "_resources": resources,
            }
        )

    with gzip.open(LOG, "rt", encoding="utf-8") as handle:
        for line in handle:
            s = line.strip()

            if s.startswith("<trace"):
                case, events, first_ts, last_ts = {}, 0, None, None
                subprocesses, resources, in_event = set(), Counter(), False
                revoked = False
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
                elif key == "concept:name" and value == REVOKE_ACTIVITY:
                    revoked = True
            else:
                case[key] = value

    frame = pd.DataFrame(rows)

    # Ownership needs the whole log: a resource's case share is what identifies
    # it as a system account, and that cannot be known one case at a time.
    owners, systems = resolve_owners([r["_resources"] for r in rows])
    frame["resource"] = owners
    frame = frame.drop(columns=["_resources"])
    frame.attrs["system_accounts"] = sorted(systems)
    print(f"  excluded {len(systems)} system accounts: {sorted(systems)}")

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
