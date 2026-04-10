"""Deterministic WorkflowSpec → editor DSL JSON (docs/dsl-example.json shape)."""

from __future__ import annotations

from typing import Any

from workflow_agent.dsl.types import CompileWarning
from workflow_agent.spec.models import BranchArm, BranchNode, EndNode, SkillNode, WorkflowSpec

DSL_COMMENT_PREFIX = "workflow-agent; workflow-dsl/editor-v1"


def compile_workflow_spec(
    spec: WorkflowSpec,
    *,
    skill_emit_map: dict[str, str] | None = None,
) -> tuple[dict[str, Any], list[CompileWarning]]:
    """
    Map each spec node to ``States`` entries.

    Top-level keys mirror the editor export: ``Comment``, ``StartAt``, ``States`` (no legacy Version).
    ``BranchNode`` compiles to a chain of ``Condition`` states; ``SkillNode`` uses ``Label`` = node id.
    """
    warnings: list[CompileWarning] = []
    comment_parts = [DSL_COMMENT_PREFIX, f"entry={spec.start!r}"]
    if spec.version is not None:
        comment_parts.append(f"specVersion={spec.version}")
        warnings.append(
            CompileWarning(
                code="SPEC_VERSION_IN_COMMENT",
                message=f"Intermediate spec version {spec.version!r} appended to Comment.",
                path="/Comment",
            ),
        )

    states: dict[str, Any] = {}
    for nid in sorted(spec.nodes.keys()):
        node = spec.nodes[nid]
        if isinstance(node, SkillNode):
            emitted = skill_emit_map.get(node.skill, node.skill) if skill_emit_map else node.skill
            states[nid] = _emit_skill(nid, node, emitted_skill=emitted)
        elif isinstance(node, BranchNode):
            states.update(_emit_branch_condition_chain(nid, node, warnings))
        elif isinstance(node, EndNode):
            states[nid] = _emit_succeed(nid)
        else:
            msg = f"unsupported spec node type for {nid!r}"
            raise TypeError(msg)

    dsl: dict[str, Any] = {
        "Comment": "; ".join(comment_parts),
        "StartAt": spec.start,
        "States": states,
    }
    return dsl, warnings


def _emit_skill(nid: str, node: SkillNode, *, emitted_skill: str) -> dict[str, Any]:
    out: dict[str, Any] = {
        "Type": "Skill",
        "Skill": emitted_skill,
        "Parameters": dict(node.inputs),
        "Next": node.next,
        "Label": nid,
    }
    if node.retry is not None:
        rblock: dict[str, Any] = {
            "MaxAttempts": node.retry.max_attempts,
            "OnFailure": node.retry.on_failure,
        }
        if node.retry.goto_node:
            rblock["GotoState"] = node.retry.goto_node
        out["Retry"] = rblock
    return out


def _emit_succeed(nid: str) -> dict[str, Any]:
    return {"Type": "Succeed", "Label": nid}


def _branch_arm_predicate(
    arm: BranchArm,
    index: int,
    branch_id: str,
    warnings: list[CompileWarning],
) -> dict[str, Any]:
    if arm.label is not None and arm.label.strip():
        return {"Type": "Label", "Label": arm.label.strip()}
    warnings.append(
        CompileWarning(
            code="CONDITION_ARMINDEX_INFERRED",
            message=(
                f"Branch arm {index} on node {branch_id!r} had no label; If.Condition uses Type=ArmIndex Index={index}."
            ),
            path=f"/States/{branch_id}/If/Condition",
        ),
    )
    return {"Type": "ArmIndex", "Index": index}


def _emit_branch_condition_chain(
    bid: str,
    node: BranchNode,
    warnings: list[CompileWarning],
) -> dict[str, Any]:
    arms = node.branches
    default = node.default_next
    if not arms:
        msg = f"branch node {bid!r} has no arms"
        raise ValueError(msg)

    out: dict[str, Any] = {}
    n = len(arms)
    for i in range(n - 1):
        sid = bid if i == 0 else f"{bid}__arm{i}"
        next_cid = f"{bid}__arm{i + 1}"
        arm = arms[i]
        pred = _branch_arm_predicate(arm, i, bid, warnings)
        out[sid] = {
            "Type": "Condition",
            "If": {"Condition": pred, "Then": arm.next},
            "Else": next_cid,
            "Label": sid,
        }

    last_sid = bid if n == 1 else f"{bid}__arm{n - 1}"
    last_arm = arms[n - 1]
    pred = _branch_arm_predicate(last_arm, n - 1, bid, warnings)
    out[last_sid] = {
        "Type": "Condition",
        "If": {"Condition": pred, "Then": last_arm.next},
        "Else": default,
        "Label": last_sid,
    }
    return out
