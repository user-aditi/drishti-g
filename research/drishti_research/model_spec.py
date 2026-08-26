"""Loads GRIE's model definition, exported from the running backend.

The interpretable model is not re-implemented here. It is *read* from
``data/model-spec.json``, which ``backend/scripts/export-model-spec.ts`` writes
straight out of the code that scores complaints in production.

That indirection is the point. The paper's claim is about the model DRISHTI-G
actually runs; a Python re-implementation could drift from it by a weight or a
cap and nothing would catch the difference, quietly invalidating every number in
the results table.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np

SPEC_PATH = Path(__file__).resolve().parent.parent / "data" / "model-spec.json"

CurveKind = Literal["linear", "proportion", "boolean", "identity"]


@dataclass(frozen=True)
class Curve:
    kind: CurveKind
    cap: float | None = None

    def apply(self, raw: np.ndarray) -> np.ndarray:
        """Map raw signal values onto 0-100. Vectorised over a column."""
        raw = np.asarray(raw, dtype=float)
        if self.kind == "linear":
            assert self.cap is not None, "a linear curve needs a cap"
            return np.clip(np.where(raw <= 0, 0.0, raw / self.cap * 100.0), 0.0, 100.0)
        if self.kind == "proportion":
            return np.clip(raw * 100.0, 0.0, 100.0)
        if self.kind == "boolean":
            return np.where(raw != 0, 100.0, 0.0)
        return np.clip(raw, 0.0, 100.0)


@dataclass(frozen=True)
class Factor:
    key: str
    label: str
    weight: float
    curve: Curve


@dataclass(frozen=True)
class ModelSpec:
    model_version: str
    review_threshold: float
    bands: list[tuple[str, float]]
    factor_sets: dict[str, list[Factor]]

    def factors(self, entity_type: str) -> list[Factor]:
        if entity_type not in self.factor_sets:
            raise KeyError(
                f"{entity_type!r} is not in the exported spec. "
                f"Available: {sorted(self.factor_sets)}"
            )
        return self.factor_sets[entity_type]

    def feature_keys(self, entity_type: str) -> list[str]:
        return [f.key for f in self.factors(entity_type)]

    def weights(self, entity_type: str) -> dict[str, float]:
        return {f.key: f.weight for f in self.factors(entity_type)}

    def band_for(self, score: float) -> str:
        for band, minimum in self.bands:
            if score >= minimum:
                return band
        return self.bands[-1][0]


def _parse_curve(raw: dict[str, Any]) -> Curve:
    return Curve(kind=raw["kind"], cap=raw.get("cap"))


def load_spec(path: Path | None = None) -> ModelSpec:
    """Read the exported spec, failing loudly if it is missing or malformed."""
    target = path or SPEC_PATH
    if not target.exists():
        raise FileNotFoundError(
            f"{target} not found. Export it from the backend first:\n"
            f"    cd backend && npm run export:model"
        )

    raw = json.loads(target.read_text(encoding="utf-8"))

    factor_sets = {
        entity_type: [
            Factor(
                key=f["key"],
                label=f["label"],
                weight=float(f["weight"]),
                curve=_parse_curve(f["curve"]),
            )
            for f in factors
        ]
        for entity_type, factors in raw["factorSets"].items()
    }

    # Descending, so band_for can return the first match.
    bands = sorted(
        ((b["band"], float(b["min"])) for b in raw["bands"]),
        key=lambda pair: pair[1],
        reverse=True,
    )

    spec = ModelSpec(
        model_version=raw["modelVersion"],
        review_threshold=float(raw["reviewThreshold"]),
        bands=bands,
        factor_sets=factor_sets,
    )

    # A weight set that does not sum to 1.0 means a maximum-risk entity stops
    # scoring 100 and the bands stop meaning what they claim. Catch it here
    # rather than in a results table.
    for entity_type, factors in spec.factor_sets.items():
        total = sum(f.weight for f in factors)
        if abs(total - 1.0) > 1e-6:
            raise ValueError(
                f"weights for {entity_type} sum to {total:.4f}, not 1.0 — "
                "the exported model is inconsistent"
            )

    return spec
