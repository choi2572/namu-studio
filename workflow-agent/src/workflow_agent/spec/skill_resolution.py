"""Skill id strings: registry rows ↔ intermediate spec ↔ editor DSL ``Skill`` field."""

from __future__ import annotations

from collections import Counter
from typing import Any


def canonical_dsl_skill_id(row: dict[str, Any]) -> str:
    """
    Namu editor / ``docs/dsl-example.json`` ``Skill`` value: ``namespace.name`` when namespace is set.

    Matches ``getSkillDisplayType`` / DSL examples (e.g. ``analysis.DetectObjects``).
    """
    raw_name = row.get("name")
    if not isinstance(raw_name, str) or not raw_name.strip():
        return ""
    name = raw_name.strip()
    ns = ""
    if isinstance(row.get("namespace"), str):
        ns = row["namespace"].strip()

    if ns:
        if name.startswith(f"{ns}."):
            return name
        return f"{ns}.{name}"
    return name


def _row_match_aliases(row: dict[str, Any]) -> set[str]:
    """Tokens that may appear in intermediate ``skill`` nodes for this catalog row."""
    canon = canonical_dsl_skill_id(row)
    if not canon:
        return set()

    raw_name = row.get("name")
    name = raw_name.strip() if isinstance(raw_name, str) else ""
    ns = row["namespace"].strip() if isinstance(row.get("namespace"), str) else ""

    out: set[str] = {canon}
    if name:
        out.add(name)
    if ns and name.startswith(f"{ns}."):
        short = name[len(ns) + 1 :]
        if short:
            out.add(short)
    if "." in canon:
        out.add(canon.rsplit(".", 1)[-1])
    return {x for x in out if x}


def skill_names_from_registry_rows(raw_registry: list[dict[str, Any]]) -> set[str]:
    """
    Acceptable ``skill`` strings for spec validation (superset of catalog tokens).

    Includes short names and ``namespace.name`` forms so LLM output matches either.
    Unambiguous last-segment aliases only when a single catalog row owns that suffix.
    """
    per_row = [_row_match_aliases(row) for row in raw_registry]
    names: set[str] = set()
    for s in per_row:
        names |= s

    suffix_count: Counter[str] = Counter()
    for row in raw_registry:
        c = canonical_dsl_skill_id(row)
        if c and "." in c:
            suffix_count[c.rsplit(".", 1)[-1]] += 1

    ambiguous_suffixes = {s for s, n in suffix_count.items() if n > 1}
    names -= ambiguous_suffixes
    return names


def skill_emit_map_from_registry(raw_registry: list[dict[str, Any]]) -> dict[str, str]:
    """
    Map intermediate-spec / LLM ``skill`` string → canonical DSL ``Skill`` string.

    Conflicting aliases (same token → two different canonical ids) are omitted.
    """
    tentative: dict[str, str] = {}
    conflicts: set[str] = set()
    for row in raw_registry:
        canon = canonical_dsl_skill_id(row)
        if not canon:
            continue
        for alias in _row_match_aliases(row):
            prev = tentative.get(alias)
            if prev is None:
                tentative[alias] = canon
            elif prev != canon:
                conflicts.add(alias)
    return {a: c for a, c in tentative.items() if a not in conflicts}
