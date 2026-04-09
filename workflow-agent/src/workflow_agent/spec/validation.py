"""Parse (Pydantic) vs business-rule validation with a machine-readable report."""

from __future__ import annotations

from collections import deque
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from workflow_agent.spec.models import BranchNode, EndNode, SkillNode, WorkflowSpec

# --- Report types ----------------------------------------------------------------


class SpecParseError(BaseModel):
    """Schema / type error from ``WorkflowSpec.model_validate`` (or JSON shape)."""

    path: str
    message: str
    code: str


class BusinessValidationIssue(BaseModel):
    """Deterministic graph / registry rules (spec §6.1)."""

    path: str
    message: str
    code: str


class SpecValidationReport(BaseModel):
    """Single object for draft orchestration: parse vs business errors separated."""

    ok: bool
    spec: WorkflowSpec | None = None
    parse_errors: list[SpecParseError] = Field(default_factory=list)
    business_errors: list[BusinessValidationIssue] = Field(default_factory=list)


# --- Helpers ---------------------------------------------------------------------


def skill_names_from_registry_rows(raw_registry: list[dict[str, Any]]) -> set[str]:
    """``name`` fields from synced raw skill rows (spec §3.2)."""
    names: set[str] = set()
    for row in raw_registry:
        n = row.get("name")
        if isinstance(n, str) and n.strip():
            names.add(n.strip())
    return names


def _pydantic_loc_to_path(loc: tuple[Any, ...]) -> str:
    if not loc:
        return "/"
    parts: list[str] = []
    for p in loc:
        if isinstance(p, str):
            parts.append(p)
        else:
            parts.append(str(int(p)))
    return "/" + "/".join(parts)


def _parse_errors_from_validation_error(err: ValidationError) -> list[SpecParseError]:
    out: list[SpecParseError] = []
    for item in err.errors():
        loc = item.get("loc") or ()
        path = _pydantic_loc_to_path(tuple(loc))
        out.append(
            SpecParseError(
                path=path,
                message=item.get("msg", "validation error"),
                code=str(item.get("type", "validation_error")),
            ),
        )
    return out


def _collect_outgoing_refs(spec: WorkflowSpec) -> list[tuple[str, str, str]]:
    """
    (source_node_id, json_path, target_node_id) for every structural edge.

    Paths are JSON-pointer-like for clients (e.g. ``/nodes/pick/next``).
    """
    refs: list[tuple[str, str, str]] = []
    for nid, node in spec.nodes.items():
        if isinstance(node, SkillNode):
            refs.append((nid, f"/nodes/{nid}/next", node.next))
            if node.retry and node.retry.goto_node:
                refs.append((nid, f"/nodes/{nid}/retry/goto_node", node.retry.goto_node))
        elif isinstance(node, BranchNode):
            for i, arm in enumerate(node.branches):
                refs.append((nid, f"/nodes/{nid}/branches/{i}/next", arm.next))
            refs.append((nid, f"/nodes/{nid}/default_next", node.default_next))
        elif isinstance(node, EndNode):
            continue
    return refs


def _validate_business(spec: WorkflowSpec, known_skill_names: set[str]) -> list[BusinessValidationIssue]:
    issues: list[BusinessValidationIssue] = []
    node_ids = frozenset(spec.nodes.keys())

    if spec.start not in node_ids:
        issues.append(
            BusinessValidationIssue(
                path="/start",
                message=f"start node {spec.start!r} is not defined in nodes",
                code="START_UNKNOWN",
            ),
        )

    for src, path, tgt in _collect_outgoing_refs(spec):
        if tgt not in node_ids:
            issues.append(
                BusinessValidationIssue(
                    path=path,
                    message=f"unknown target node {tgt!r} referenced from {src!r}",
                    code="REF_UNKNOWN_NODE",
                ),
            )

    end_ids = [nid for nid, n in spec.nodes.items() if isinstance(n, EndNode)]
    if not end_ids:
        issues.append(
            BusinessValidationIssue(
                path="/nodes",
                message="workflow must contain at least one node of type 'end'",
                code="NO_END_NODE",
            ),
        )

    for nid, node in spec.nodes.items():
        if isinstance(node, SkillNode):
            if node.skill not in known_skill_names:
                issues.append(
                    BusinessValidationIssue(
                        path=f"/nodes/{nid}/skill",
                        message=f"unknown skill {node.skill!r} (not in skill registry)",
                        code="SKILL_NOT_IN_REGISTRY",
                    ),
                )

    # Reachability: start -> ... -> some end (BFS on outgoing refs only)
    if spec.start in node_ids and end_ids:

        def _outgoing_targets(nid: str) -> set[str]:
            n = spec.nodes[nid]
            if isinstance(n, SkillNode):
                out = {n.next}
                if n.retry and n.retry.goto_node:
                    out.add(n.retry.goto_node)
                return out
            if isinstance(n, BranchNode):
                out = {arm.next for arm in n.branches}
                out.add(n.default_next)
                return out
            return set()

        reachable: set[str] = {spec.start}
        q: deque[str] = deque([spec.start])
        while q:
            cur = q.popleft()
            if isinstance(spec.nodes[cur], EndNode):
                continue
            for t in _outgoing_targets(cur):
                if t in node_ids and t not in reachable:
                    reachable.add(t)
                    q.append(t)
        unreachable_ends = [e for e in end_ids if e not in reachable]
        if unreachable_ends:
            issues.append(
                BusinessValidationIssue(
                    path="/start",
                    message=f"no path from start to end node(s): {unreachable_ends!r}",
                    code="END_NOT_REACHABLE",
                ),
            )

    return issues


def parse_and_validate_workflow_spec(
    data: dict[str, Any],
    *,
    known_skill_names: set[str],
) -> SpecValidationReport:
    """
    1) Parse into ``WorkflowSpec`` (Pydantic).
    2) If parse succeeds, run deterministic business checks (graph + skills).

    ``known_skill_names`` typically comes from ``skill_names_from_registry_rows``.
    """
    try:
        spec = WorkflowSpec.model_validate(data)
    except ValidationError as exc:
        return SpecValidationReport(
            ok=False,
            spec=None,
            parse_errors=_parse_errors_from_validation_error(exc),
            business_errors=[],
        )

    business = _validate_business(spec, known_skill_names)
    if business:
        return SpecValidationReport(
            ok=False,
            spec=spec,
            parse_errors=[],
            business_errors=business,
        )

    return SpecValidationReport(
        ok=True,
        spec=spec,
        parse_errors=[],
        business_errors=[],
    )
