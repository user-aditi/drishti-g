"""Phase 8 — a sample of real civic photographs, for measuring the proof checks.

    python -m drishti_research.qr4change [--per-folder 250] [--refresh]

Layer 4 asks whether a photograph sent back from a job is proof of anything. Most
of what it can check is metadata, but one check is about the image itself: has
this picture been sent before? Byte-for-byte comparison answers that only until
someone re-saves the file. A perceptual hash survives re-encoding, resizing and
cropping — and its threshold is a real decision, because the same number decides
how often two different potholes are called the same photograph.

That number cannot be guessed. It is measured on real civic photographs, which
is what this module fetches:

    Urban Civic Issues Image Dataset: Potholes and Garbage (QR4Change), v2
    Maske, Jakate, Thakare and Lokhande, Vishwakarma Institute of Information
    Technology. doi:10.17632/zndzygc3p3.2, CC BY 4.0.

Why a sample, and what it costs
-------------------------------
The whole dataset is 4,937 photographs and about 6 GB; the garbage photographs
alone average 5 MB. 250 from each of the four folders is 1,000 photographs and
about 1.9 GB, which gives roughly half a million distinct pairs to measure false
matches on and 1,000 originals to transform and re-detect. The five videos are
skipped: a video is not what this check is about.

The sample is drawn with a fixed seed from the filenames the API lists, so a
second run selects the same photographs. Mendeley's listing endpoint returns at
most 1,000 files per folder, so for the two folders larger than that the sample
is drawn from the first 1,000 it lists rather than from all of them — recorded
in the manifest rather than papered over.

Like the NYC corpus, the images are downloaded and never vendored: the manifest
and the measurements are committed, the photographs are not.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
import urllib.error
import urllib.request
from pathlib import Path

DOI = "10.17632/zndzygc3p3.2"
DATASET = "zndzygc3p3"
VERSION = 2
LICENCE = "CC BY 4.0"
CITATION = (
    "Maske, Y., Jakate, S., Thakare, C., Lokhande, S. (2025). Urban Civic Issues Image "
    f"Dataset: Potholes and Garbage (QR4Change), v{VERSION}. Mendeley Data. doi:{DOI}. "
    f"Licensed {LICENCE}."
)

#: Mendeley's folder ids, read once from the public API and pinned so a run is
#: reproducible even if the dataset gains a version.
FOLDERS = {
    "pothole/yes": "7e90d513-bcc6-428c-a171-2c358628cf7c",
    "pothole/no": "a17c191d-f252-41d2-a956-c805411e3007",
    "garbage/yes": "47571a83-4207-432b-9a7b-ad8835c3f6fc",
    "garbage/no": "26ae5b0a-979f-4ce9-a1b1-6af1674dc718",
}

API = "https://data.mendeley.com/public-api/datasets"
DATA = Path(__file__).resolve().parents[2] / "research" / "data" / "qr4change"
MANIFEST = DATA / "manifest.json"

SEED = 20260912
PER_FOLDER = 250
SKIP_SUFFIXES = (".mp4", ".mov", ".avi")
RETRIES = 4
TIMEOUT = 300

#: A user agent, because the API answers 403 to urllib's default.
HEADERS = {"Accept": "application/json", "User-Agent": "drishti-g-research/1.0"}


def _get(url: str, headers: dict[str, str] = HEADERS) -> bytes:
    last: Exception | None = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=TIMEOUT) as r:
                return r.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as err:
            last = err
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{url} failed after {RETRIES} attempts: {last}")


def listing(folder_id: str) -> list[dict]:
    """The files Mendeley lists for one folder, photographs only."""
    raw = _get(f"{API}/{DATASET}/files?folder_id={folder_id}&version={VERSION}")
    files = json.loads(raw)
    return [f for f in files if not f["filename"].lower().endswith(SKIP_SUFFIXES)]


def sample(files: list[dict], per_folder: int) -> list[dict]:
    """A fixed-seed draw, ordered by filename so the population is deterministic."""
    ordered = sorted(files, key=lambda f: f["filename"])
    if len(ordered) <= per_folder:
        return ordered
    return sorted(random.Random(SEED).sample(ordered, per_folder), key=lambda f: f["filename"])


def fetch(folder: str, files: list[dict], refresh: bool, unreachable: list[dict]) -> list[dict]:
    """Fetch a folder's sample, and carry on past anything the source will not give.

    One timeout must not cost the whole pull. The first version raised out of the
    loop with 917 of 1,000 photographs already on disk, and since the manifest is
    written at the end, that left the sample sitting there with nothing describing
    it. A file that still fails after every retry is recorded in `unreachable` and
    named in the manifest, so the sample's gaps are stated rather than silent.
    """
    target = DATA / folder
    target.mkdir(parents=True, exist_ok=True)
    records = []
    downloaded = skipped = 0
    for i, entry in enumerate(files, 1):
        path = target / entry["filename"]
        if path.exists() and not refresh and path.stat().st_size == entry["size"]:
            skipped += 1
        else:
            url = (entry.get("content_details") or {}).get("download_url")
            if not url:
                raise RuntimeError(f"no download url for {folder}/{entry['filename']}")
            try:
                path.write_bytes(_get(url, {"User-Agent": HEADERS["User-Agent"]}))
                downloaded += 1
            except RuntimeError as err:
                unreachable.append(
                    {"file": f"{folder}/{entry['filename']}", "reason": str(err)[-160:]}
                )
                print(f"  ! {folder}/{entry['filename']} unreachable, skipped", flush=True)
                continue
        records.append(
            {
                "file": f"{folder}/{entry['filename']}",
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
        if i % 50 == 0 or i == len(files):
            print(f"  {folder:12} {i:4}/{len(files)}  ({downloaded} fetched, {skipped} already here)", flush=True)
    return records


def run(per_folder: int = PER_FOLDER, refresh: bool = False) -> dict:
    print(f"QR4Change sample — {per_folder} photographs per folder\n{CITATION}\n")
    folders = {}
    records: list[dict] = []
    unreachable: list[dict] = []
    for folder, folder_id in FOLDERS.items():
        listed = listing(folder_id)
        drawn = sample(listed, per_folder)
        folders[folder] = {
            "listed": len(listed),
            "sampled": len(drawn),
            # Mendeley lists at most 1,000 files, so for the larger folders the
            # draw is from a prefix of the folder rather than all of it.
            "listing_complete": len(listed) < 1000,
        }
        records.extend(fetch(folder, drawn, refresh, unreachable))

    total = sum(r["bytes"] for r in records)
    MANIFEST.write_text(
        json.dumps(
            {
                "dataset": "Urban Civic Issues Image Dataset: Potholes and Garbage (QR4Change)",
                "doi": DOI,
                "version": VERSION,
                "licence": LICENCE,
                "citation": CITATION,
                "source": f"https://data.mendeley.com/datasets/{DATASET}/{VERSION}",
                "pulled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "seed": SEED,
                "per_folder": per_folder,
                "videos": "skipped — this measurement is about photographs",
                "folders": folders,
                "photographs": len(records),
                "unreachable": unreachable,
                "bytes": total,
                "files": records,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"\n{len(records)} photographs, {total / 1e9:.2f} GB, under {DATA}")
    if unreachable:
        print(f"{len(unreachable)} file(s) the source would not hand over, named in the manifest")
    print(f"manifest: {MANIFEST}")
    return folders


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--per-folder", type=int, default=PER_FOLDER)
    parser.add_argument("--refresh", action="store_true", help="re-fetch photographs already on disk")
    args = parser.parse_args()
    run(per_folder=args.per_folder, refresh=args.refresh)
