"""The NYC 311 corpus: what we pull, and how Socrata makes us pull it.

    python -m drishti_research.nyc

Why this module exists
----------------------
Every earlier arm of this study ran on either a constructed panel or a public
process-mining log. Both are defensible and neither is a municipal complaint
desk. NYC publishes 40M+ real 311 service requests carrying intake time, agency
assignment, status lifecycle, geography and closure time — the exact columns
GRIE's five signals are defined over. This module is the single place that knows
how to get them.

Three Socrata behaviours drive the design, and all three were learned by being
bitten
------------------------------------------------------------------------------
**Null fields are omitted from the row entirely.** A request with no ``due_date``
comes back as a JSON object with no ``due_date`` key at all, not one whose value
is null. Code that reads ``row["due_date"]`` raises ``KeyError`` on exactly the
rows the coverage question is about, which is how F-10 stayed hidden. Every read
here goes through ``.get``, and :func:`frame` reindexes onto a declared column
list so a column absent from *every* row in a page still exists and is still
null.

**Full-table aggregates time out.** ``count(*)`` over 40M rows does not return,
and even a filtered ``$group`` over the Brooklyn slice runs for minutes. So
nothing here aggregates server-side: we filter to the slice, page it down, and
count in pandas. That is F-11's workaround, and it is also faster in wall-clock
terms because the pages stream.

**Paging without ``$order`` is not stable.** Socrata gives no ordering guarantee,
so ``$offset`` walks a shifting result set and pages silently overlap or skip.
Rows here are always ordered by ``:id``, the dataset's immutable internal row
identifier — ordering by ``unique_key`` would be stable too, but it is a string
sort over a numeric field and is measurably slower.

The slice, and why this one
---------------------------
Brooklyn only: 18 community boards is enough units for a panel without pulling
five boroughs. 2022-2025: four years, so roughly 48 monthly periods per unit.
Six complaint types: the ones that map onto our categories. That is a minority of
NYC's total volume — their largest type is noise, which we do not handle — and
F-15 records that as an accepted limitation rather than a surprise.
"""

from __future__ import annotations

import io
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pandas as pd

DATASET = "erm2-nwe9"
RESOURCE = f"https://data.cityofnewyork.us/resource/{DATASET}.json"
EXPORT = f"https://data.cityofnewyork.us/resource/{DATASET}.csv"
METADATA = f"https://data.cityofnewyork.us/api/views/{DATASET}.json"

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "research" / "data" / "nyc"

BOROUGH = "BROOKLYN"
PERIOD_START = "2022-01-01T00:00:00"
PERIOD_END = "2026-01-01T00:00:00"

#: The six NYC complaint types that map onto our categories. Public toilet and
#: encroachment have no usable NYC analogue (F-16); their absence is declared in
#: the plan rather than papered over with a near-miss type.
COMPLAINT_TYPES = (
    "Street Condition",
    "Street Light Condition",
    "Sewer",
    "Water System",
    "Missed Collection",
    "Dirty Condition",
)

#: Columns we ask for by name. Asking explicitly rather than taking the whole row
#: roughly halves transfer, and — because Socrata omits nulls — it is also the
#: only place that records which columns are *supposed* to exist.
COLUMNS = (
    "unique_key",
    "created_date",
    "closed_date",
    "due_date",
    "resolution_action_updated_date",
    "agency",
    "agency_name",
    "complaint_type",
    "descriptor",
    "status",
    "borough",
    "community_board",
    "council_district",
    "police_precinct",
    "incident_zip",
    "incident_address",
    "street_name",
    "latitude",
    "longitude",
    "open_data_channel_type",
    "resolution_description",
    "location_type",
)

#: 50,000 is Socrata's documented page ceiling for the JSON endpoint, and it is
#: the right size for a narrow select: the V1 coverage scan pulled 355k rows over
#: seven columns in 259 seconds at this page size.
#:
#: It is the wrong size — and the JSON endpoint is the wrong endpoint — for a
#: wide one. Selecting all twenty-two columns brought the JSON endpoint to a
#: crawl: two separate runs failed to deliver a single page in eight minutes at
#: 50,000 and then at 10,000 rows, and timing individual calls showed the cost
#: was server-side per-request work rather than payload size (3 columns × 1,000
#: rows took 32 seconds; 22 columns × 1,000 rows took 6). That is F-17.
#:
#: The CSV export endpoint is the documented path for bulk and does not have the
#: problem: the same twenty-two columns come back at 100,000 rows in 41 seconds.
#: :func:`fetch_csv` is what any bulk caller should use, and :data:`EXPORT_PAGE`
#: is a page size measured on that endpoint rather than guessed.
PAGE = 50_000
EXPORT_PAGE = 100_000

#: An app token is not required, but without one the shared anonymous pool is
#: throttled hard enough that a 300k-row pull becomes unreliable. Register one at
#: https://data.cityofnewyork.us/profile/edit/developer_settings and export it.
APP_TOKEN_ENV = "NYC_APP_TOKEN"

RETRIES = 4
BACKOFF_SECONDS = 5.0
TIMEOUT_SECONDS = 300


def _quote(value: str) -> str:
    """SoQL string literal. Single quotes double up, as in SQL."""
    return "'" + value.replace("'", "''") + "'"


def slice_where(
    borough: str = BOROUGH,
    start: str = PERIOD_START,
    end: str = PERIOD_END,
    complaint_types: tuple[str, ...] = COMPLAINT_TYPES,
) -> str:
    """The SoQL filter for our target slice.

    ``created_date`` is half-open on the right so a request filed at midnight on
    the boundary lands in exactly one period.
    """
    clauses = [
        f"borough = {_quote(borough)}",
        f"created_date >= {_quote(start)}",
        f"created_date < {_quote(end)}",
    ]
    if complaint_types:
        joined = ", ".join(_quote(t) for t in complaint_types)
        clauses.append(f"complaint_type in ({joined})")
    return " AND ".join(clauses)


def request(params: dict[str, str], url: str = RESOURCE) -> list[dict]:
    """One Socrata call, with backoff on the failures worth retrying.

    429 (throttled) and 5xx are transient and retried. 400 means a malformed
    query, and retrying that only burns the rate limit, so it is raised with the
    server's own explanation attached — Socrata's 400 bodies name the offending
    column, which is far more useful than the status line.
    """
    query = urllib.parse.urlencode(params)
    headers = {"Accept": "application/json"}
    token = os.environ.get(APP_TOKEN_ENV)
    if token:
        headers["X-App-Token"] = token

    last: Exception | None = None
    for attempt in range(RETRIES):
        req = urllib.request.Request(f"{url}?{query}", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:500]
            if error.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"Socrata {error.code} on {query}: {body}") from error
            last = RuntimeError(f"Socrata {error.code}: {body}")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = error
        time.sleep(BACKOFF_SECONDS * (attempt + 1))

    raise RuntimeError(f"Socrata failed after {RETRIES} attempts: {last}")


def pages(
    where: str,
    select: tuple[str, ...] = COLUMNS,
    page: int = PAGE,
    order: str = ":id",
) -> Iterator[list[dict]]:
    """Walk a filtered slice page by page.

    Ordered by ``:id`` so ``$offset`` addresses a fixed sequence. Stops on the
    first short page: a page smaller than the limit is the last one by
    definition, and detecting it that way is cheaper than a separate count call
    that would itself be an aggregate over the slice.
    """
    offset = 0
    while True:
        rows = request(
            {
                "$select": ", ".join(select),
                "$where": where,
                "$order": order,
                "$limit": str(page),
                "$offset": str(offset),
            }
        )
        if rows:
            yield rows
        if len(rows) < page:
            return
        offset += page


def frame(rows: list[dict], columns: tuple[str, ...] = COLUMNS) -> pd.DataFrame:
    """Rows to a DataFrame with every declared column present.

    The reindex is the whole point. Socrata drops null fields, so a page in which
    no row carries a ``due_date`` produces a frame with no such column, and
    concatenating it with a page that does have one puts NaN in the wrong places
    rather than raising. Declaring the columns makes absence explicit.
    """
    return pd.DataFrame(rows).reindex(columns=list(columns))


def fetch_csv(
    where: str,
    select: tuple[str, ...] = COLUMNS,
    page: int = EXPORT_PAGE,
    cache: Path | None = None,
    verbose: bool = True,
) -> pd.DataFrame:
    """The bulk path: the same SoQL query against the CSV export endpoint.

    Everything :func:`fetch` says about ordering and caching applies here. What
    differs is the wire format, and on a wide select that difference is the
    whole pull — see F-17 in the note on :data:`EXPORT_PAGE`.

    Rows are read as strings with only the empty string treated as null. Socrata
    writes a genuinely empty field for a null, and pandas' default missing-value
    list would additionally swallow literal ``NA`` and ``None`` if they ever
    appeared in an address or a resolution note. Typing happens downstream, where
    the caller knows what each column means.
    """
    collected: list[pd.DataFrame] = []
    total = 0
    started = time.time()
    if cache is not None:
        cache.mkdir(parents=True, exist_ok=True)

    headers = {"Accept": "text/csv"}
    token = os.environ.get(APP_TOKEN_ENV)
    if token:
        headers["X-App-Token"] = token

    offset = 0
    while True:
        part = cache / f"part-{offset:09d}.csv" if cache is not None else None
        if part is not None and part.exists():
            body = part.read_bytes()
            source = "cached"
        else:
            query = urllib.parse.urlencode(
                {
                    "$select": ", ".join(select),
                    "$where": where,
                    "$order": ":id",
                    "$limit": str(page),
                    "$offset": str(offset),
                }
            )
            body = _download(f"{EXPORT}?{query}", headers)
            if part is not None:
                part.write_bytes(body)
            source = "fetched"

        batch = pd.read_csv(
            io.BytesIO(body), dtype=str, keep_default_na=False, na_values=[""]
        ).reindex(columns=list(select))
        if len(batch):
            collected.append(batch)
        total += len(batch)
        if verbose:
            print(
                f"  {total:>9,} rows  ({time.time() - started:>6.1f}s, "
                f"{len(body) / 1e6:.1f} MB {source})",
                flush=True,
            )
        if len(batch) < page:
            break
        offset += page

    if not collected:
        return frame([], select)
    return pd.concat(collected, ignore_index=True)


def _download(url: str, headers: dict[str, str]) -> bytes:
    """One export call, with the same retry policy as :func:`request`."""
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", "replace")[:500]
            if error.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(f"Socrata {error.code} on export: {body}") from error
            last = RuntimeError(f"Socrata {error.code}: {body}")
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last = error
        time.sleep(BACKOFF_SECONDS * (attempt + 1))
    raise RuntimeError(f"Socrata export failed after {RETRIES} attempts: {last}")


def fetch(
    where: str,
    select: tuple[str, ...] = COLUMNS,
    page: int = PAGE,
    verbose: bool = True,
    cache: Path | None = None,
) -> pd.DataFrame:
    """The whole slice, concatenated. Prints progress, because this takes minutes.

    With ``cache`` set, each page is written to its own CSV under that directory
    as it arrives and re-read instead of re-fetched on a later run. A ten-minute
    pull that dies on its last page is otherwise a ten-minute pull that has to
    start again, and on a throttled connection the odds of that are not small —
    F-17. Page files are named by offset, so a resumed run picks up exactly where
    the previous one stopped.

    The cache is only safe because ``pages`` orders by ``:id``: page *n* is the
    same rows on every run, so a directory of parts reassembles into the same
    corpus. Change the filter and the parts are stale; that is what ``--refresh``
    clearing the directory is for.
    """
    collected: list[pd.DataFrame] = []
    total = 0
    started = time.time()
    if cache is not None:
        cache.mkdir(parents=True, exist_ok=True)

    offset = 0
    while True:
        part = cache / f"part-{offset:09d}.csv" if cache is not None else None
        if part is not None and part.exists():
            batch_frame = pd.read_csv(part, dtype=str, keep_default_na=False, na_values=[""])
            batch_frame = batch_frame.reindex(columns=list(select))
            source = "cached"
        else:
            rows = request(
                {
                    "$select": ", ".join(select),
                    "$where": where,
                    "$order": ":id",
                    "$limit": str(page),
                    "$offset": str(offset),
                }
            )
            batch_frame = frame(rows, select)
            if part is not None:
                batch_frame.to_csv(part, index=False)
            source = "fetched"

        if len(batch_frame):
            collected.append(batch_frame)
        total += len(batch_frame)
        if verbose:
            print(f"  {total:>9,} rows  ({time.time() - started:>6.1f}s, {source})", flush=True)
        if len(batch_frame) < page:
            break
        offset += page

    if not collected:
        return frame([], select)
    return pd.concat(collected, ignore_index=True)


def board_number(community_board: object) -> object:
    """``'03 BROOKLYN'`` to ``3``.

    Community board strings carry the borough name, and requests that could not
    be placed carry ``'0 Unspecified'`` or ``'Unspecified BROOKLYN'``. Both
    become null: a request whose board is unknown cannot be attributed to a unit,
    and quietly bucketing it into board 0 would invent a nineteenth unit whose
    signals are the borough's unplaceable residue.
    """
    if not isinstance(community_board, str):
        return pd.NA
    stripped = community_board.strip()
    head = stripped.split()[0] if stripped else ""
    if not head.isdigit():
        return pd.NA
    number = int(head)
    return number if 1 <= number <= 18 else pd.NA


if __name__ == "__main__":
    where = slice_where()
    print(f"slice: {where}\n")
    sample = frame(request({"$select": ", ".join(COLUMNS), "$where": where, "$limit": "5"}))
    print(sample.T.to_string())
    print()
    print(f"app token: {'set' if os.environ.get(APP_TOKEN_ENV) else 'not set (throttled pool)'}")
