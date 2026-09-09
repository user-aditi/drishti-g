"""BPI Challenge 2015 — loading, the code scheme, and the feasible-action function.

Why this module exists
----------------------
Every number that goes into either paper has to come from data we did not make
up. BPIC 2015 is the one public log that fits: building permit applications from
five Dutch municipalities over roughly four years, citizen-facing, with an
explicit objections-and-complaints subprocess. It is the real-data arm for the
GRIE interpretability study and the primary evaluation for the autonomy gate.

The part that matters for the gate is `feasible_actions`. Most predictive process
monitoring work that uses constraints *mines* them from transition frequencies —
and then evaluates on the same log. The constraint set is fitted to the thing it
is meant to constrain, so a reviewer is right to call the result circular. This
module does not do that. The feasible set here is authored from the **documented
activity-code scheme** and nothing else:

    01_HOOFD_030_1
    ^^ ^^^^^ ^^^ ^
    |  |     |   variant
    |  |     ordinal position within the subprocess
    |  subprocess block  (HOOFD = main process, BB = objections and complaints)
    two-digit subprocess prefix

van Dongen's dataset description states the first two digits and the characters
identify the subprocess. The three-digit group is the position within that
subprocess's numbered procedure — 010, 015, 020, 030, ... 600. Those two facts,
plus the alphabet of codes, are the whole input to the constraint. No transition
counts are consulted. See `feasible_actions` for the three rules that follow.

Loading XES is slow (40 MB of XML per municipality), so `load_log` caches a
flat event table next to the source as gzipped CSV and reads that on subsequent
runs. Delete `data/bpic2015/cache/` to force a re-parse.
"""

from __future__ import annotations

import gzip
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "bpic2015"
CACHE_DIR = DATA_DIR / "cache"

MUNICIPALITIES = (1, 2, 3, 4, 5)

#: Subprocess blocks whose meaning we rely on by name rather than by number.
MAIN_PROCESS = "01_HOOFD"
OBJECTIONS_SUBPROCESS = "01_BB"


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------


def _xes_path(municipality: int) -> Path:
    return DATA_DIR / f"BPIC15_{municipality}.xes"


def _cache_path(municipality: int) -> Path:
    return CACHE_DIR / f"BPIC15_{municipality}.events.csv.gz"


def _parse_xes(path: Path) -> pd.DataFrame:
    """Read one XES file into a flat event table via pm4py.

    pm4py prints a licence banner on import, so it is imported lazily here —
    a cached run should be silent.
    """
    import pm4py  # noqa: PLC0415  (deliberate: keeps the banner off cached runs)

    log = pm4py.read_xes(str(path), return_legacy_log_object=False)
    frame = pd.DataFrame(log)

    keep = {
        "case:concept:name": "case_id",
        "concept:name": "activity",
        "time:timestamp": "timestamp",
        "org:resource": "resource",
        "case:parts": "parts",
        "case:responsible": "responsible",
        "case:caseProcedure": "procedure",
        "case:SUMleges": "fees",
        "monitoringResource": "monitoring_resource",
        "question": "question",
    }
    present = {src: dst for src, dst in keep.items() if src in frame.columns}
    frame = frame[list(present)].rename(columns=present)
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True, format="mixed")
    return frame.sort_values(["case_id", "timestamp"], kind="stable").reset_index(drop=True)


def load_log(municipality: int, *, refresh: bool = False) -> pd.DataFrame:
    """Return one municipality's event table, using the on-disk cache when present.

    Columns always include `case_id`, `activity`, `timestamp`; the rest depend on
    what that municipality recorded.
    """
    if municipality not in MUNICIPALITIES:
        raise ValueError(f"municipality must be one of {MUNICIPALITIES}, got {municipality}")

    cache = _cache_path(municipality)
    if cache.exists() and not refresh:
        frame = pd.read_csv(cache, compression="gzip", dtype={"case_id": str, "activity": str})
        frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True, format="mixed")
        return frame

    source = _xes_path(municipality)
    if not source.exists():
        raise FileNotFoundError(
            f"{source} is missing. Download the five BPIC 2015 logs from "
            "https://data.4tu.nl/collections/BPI_Challenge_2015/5065424 into "
            f"{DATA_DIR}."
        )

    frame = _parse_xes(source)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with gzip.open(cache, "wt", encoding="utf-8", newline="") as handle:
        frame.to_csv(handle, index=False)
    return frame


def traces(frame: pd.DataFrame) -> dict[str, list[str]]:
    """Collapse an event table into `{case_id: [activity, ...]}` in time order."""
    grouped = frame.groupby("case_id", sort=False)["activity"].apply(list)
    return grouped.to_dict()


# --------------------------------------------------------------------------
# The documented code scheme
# --------------------------------------------------------------------------


#: A position token: three digits, optionally with a lettered variant (`101b`).
_ORDINAL = re.compile(r"^(\d{3})([a-z]?)$")


@dataclass(frozen=True)
class ActivityCode:
    """One activity code, decomposed according to the published scheme."""

    raw: str
    subprocess: str
    ordinal: int | None
    variant: str

    @property
    def is_main(self) -> bool:
        return self.subprocess == MAIN_PROCESS


@lru_cache(maxsize=4096)
def parse_code(code: str) -> ActivityCode:
    """Decompose an activity code into subprocess, ordinal position and variant.

    `01_HOOFD_030_1` -> subprocess `01_HOOFD`, ordinal 30, variant `1`.
    `12_AP_UOV_020`  -> subprocess `12_AP_UOV`, ordinal 20, variant ``.
    `01_HOOFD_101b`  -> subprocess `01_HOOFD`, ordinal 101, variant `b`.
    `99_NOCODE`      -> subprocess `99_NOCODE`, ordinal None.

    A code with no three-digit group carries no position, so the ordering rule
    below cannot apply to it and it is treated as always reachable.
    """
    tokens = code.split("_")
    ordinal_at = None
    matched = None
    for index in range(len(tokens) - 1, 0, -1):
        matched = _ORDINAL.match(tokens[index])
        if matched:
            ordinal_at = index
            break

    if ordinal_at is None or matched is None:
        return ActivityCode(raw=code, subprocess=code, ordinal=None, variant="")

    variant_parts = [matched.group(2), *tokens[ordinal_at + 1 :]]
    return ActivityCode(
        raw=code,
        subprocess="_".join(tokens[:ordinal_at]),
        ordinal=int(matched.group(1)),
        variant="_".join(part for part in variant_parts if part),
    )


# --------------------------------------------------------------------------
# The feasible-action function
# --------------------------------------------------------------------------


class FeasibilityModel:
    """Which activities may legally follow a given prefix.

    Built from an alphabet of activity codes only. The alphabet is taken from the
    training split — that is a vocabulary, not a transition statistic, and the
    distinction is the whole point of this class. Nothing here counts how often
    one activity followed another.

    Three rules, each a direct reading of the code scheme:

    1. **Advance or repeat inside the current subprocess.** The three-digit group
       is a position in a numbered procedure, so a step whose number is at or
       ahead of where the case stands is in order; a lower number is going
       backwards through a procedure that is already past that point.
    2. **Resume a subprocess the case has already opened**, at or after the
       furthest point it reached there. Permit handling interleaves subprocesses;
       leaving one and coming back to it is normal, restarting it is not.
    3. **Open a subprocess the case has not touched yet, at its entry step** —
       the lowest-numbered code that subprocess has in the alphabet.

    `strict=False` drops rule 1's and rule 2's ordering component, leaving only
    subprocess membership. That ablation exists so the experiment can report how
    much of any effect comes from the ordering rule rather than from the much
    weaker "stay in a sensible subprocess" constraint.
    """

    def __init__(self, alphabet: set[str], *, strict: bool = True) -> None:
        self.alphabet = frozenset(alphabet)
        self.strict = strict
        self._codes = {code: parse_code(code) for code in self.alphabet}

        self._by_subprocess: dict[str, list[str]] = {}
        for code, parsed in self._codes.items():
            self._by_subprocess.setdefault(parsed.subprocess, []).append(code)

        #: Rule 3's entry points: the lowest-ordinal code(s) of each subprocess.
        self._entry_points: dict[str, set[str]] = {}
        for subprocess, codes in self._by_subprocess.items():
            ordinals = [self._codes[c].ordinal for c in codes if self._codes[c].ordinal is not None]
            if not ordinals:
                self._entry_points[subprocess] = set(codes)
                continue
            lowest = min(ordinals)
            self._entry_points[subprocess] = {
                c for c in codes if self._codes[c].ordinal in (None, lowest)
            }

    def state(self, prefix: list[str]) -> dict[str, int | None]:
        """Furthest ordinal reached in each subprocess the prefix has opened."""
        reached: dict[str, int | None] = {}
        for activity in prefix:
            parsed = self._codes.get(activity) or parse_code(activity)
            current = reached.get(parsed.subprocess, None)
            if parsed.ordinal is None:
                reached.setdefault(parsed.subprocess, None)
            elif current is None:
                reached[parsed.subprocess] = parsed.ordinal
            else:
                reached[parsed.subprocess] = max(current, parsed.ordinal)
        return reached

    def feasible_actions(self, prefix: list[str]) -> set[str]:
        """The set of activities policy permits after `prefix`.

        An empty prefix may only open a subprocess at its entry step.
        """
        opened = self.state(prefix)
        permitted: set[str] = set()

        for subprocess, codes in self._by_subprocess.items():
            if subprocess in opened:
                reached = opened[subprocess]
                if not self.strict or reached is None:
                    permitted.update(codes)
                else:
                    permitted.update(
                        c
                        for c in codes
                        if self._codes[c].ordinal is None or self._codes[c].ordinal >= reached
                    )
            else:
                permitted.update(self._entry_points[subprocess])

        return permitted


def build_feasibility(train_traces: dict[str, list[str]], *, strict: bool = True) -> FeasibilityModel:
    """Feasibility model over the alphabet appearing in the training traces."""
    alphabet = {activity for trace in train_traces.values() for activity in trace}
    return FeasibilityModel(alphabet, strict=strict)


# --------------------------------------------------------------------------
# Splitting
# --------------------------------------------------------------------------


def split_by_case(
    frame: pd.DataFrame, *, test_fraction: float = 0.3, temporal: bool = True
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Split into train and test **by case**, never by prefix.

    A prefix-level random split leaks: prefixes of the same case land on both
    sides and the predictor is scored on continuations of traces it has already
    seen. `temporal` orders cases by first event so the test set is the future,
    which is the honest setting for an autonomy gate that will run forward in
    time.
    """
    order = frame.groupby("case_id", sort=False)["timestamp"].min().sort_values()
    case_ids = list(order.index) if temporal else sorted(order.index)
    cut = int(len(case_ids) * (1 - test_fraction))

    all_traces = traces(frame)
    train = {c: all_traces[c] for c in case_ids[:cut]}
    test = {c: all_traces[c] for c in case_ids[cut:]}
    return train, test


if __name__ == "__main__":  # a quick structural sanity check, not a test suite
    for m in MUNICIPALITIES:
        if not _xes_path(m).exists():
            print(f"municipality {m}: log not downloaded")
            continue
        events = load_log(m)
        trace_map = traces(events)
        alphabet = {a for t in trace_map.values() for a in t}
        subprocesses = {parse_code(a).subprocess for a in alphabet}
        unparsed = sorted(a for a in alphabet if parse_code(a).ordinal is None)
        print(
            f"municipality {m}: {len(trace_map):>5} cases  {len(events):>6} events  "
            f"{len(alphabet):>3} activities  {len(subprocesses):>2} subprocesses  "
            f"{len(unparsed)} without an ordinal {unparsed[:5]}"
        )
        print(f"    {events['timestamp'].min().date()} to {events['timestamp'].max().date()}")
