"""Deterministic conversion from normalized skill dicts to prompt-friendly text (spec §3.2)."""

from __future__ import annotations

from typing import Any


def _constraints_suffix(spec: dict[str, Any]) -> str:
    bits: list[str] = []
    r = spec.get("range")
    if isinstance(r, dict):
        lo, hi = r.get("min"), r.get("max")
        if lo is not None and hi is not None:
            bits.append(f"range {lo}..{hi}")
        elif lo is not None:
            bits.append(f"min {lo}")
        elif hi is not None:
            bits.append(f"max {hi}")
    c = spec.get("candidates")
    if isinstance(c, list) and c:
        bits.append("allowed: " + ", ".join(str(x) for x in c if x != ""))
    if not bits:
        return ""
    return " [" + "; ".join(bits) + "]"


def _format_input_line(key: str, spec: Any) -> str:
    if not isinstance(spec, dict):
        return f"    - {key}: (invalid parameter spec)"
    t = str(spec.get("type", "?")).strip() or "?"
    d = str(spec.get("description", "")).strip() or "(no description)"
    extra = _constraints_suffix(spec)
    return f"    - {key} ({t}): {d}{extra}"


def _format_output_line(key: str, spec: Any) -> str:
    if not isinstance(spec, dict):
        return f"    - {key}: (invalid output spec)"
    t = str(spec.get("type", "?")).strip() or "?"
    d = str(spec.get("description", "")).strip() or "(no description)"
    return f"    - {key} ({t}): {d}"


def _format_one_skill(skill: dict[str, Any]) -> list[str]:
    name = skill["name"]
    desc = skill["description"]
    ns = skill.get("namespace")
    header = f"- {name} [{ns}]" if isinstance(ns, str) and ns.strip() else f"- {name}"
    lines: list[str] = [header, f"  description: {desc}"]
    ver = skill.get("version")
    if isinstance(ver, str) and ver.strip():
        lines.append(f"  version: {ver.strip()}")
    inputs = skill.get("inputs") or {}
    if inputs:
        lines.append("  required_inputs:")
        for k in sorted(inputs):
            lines.append(_format_input_line(k, inputs[k]))
    outputs = skill.get("outputs") or {}
    if outputs:
        lines.append("  outputs:")
        for k in sorted(outputs):
            lines.append(_format_output_line(k, outputs[k]))
    return lines


def build_prompt_skill_context(normalized_skills: list[dict[str, Any]]) -> str:
    """
    Build a stable, human-readable skill block for later prompt assembly.

    ``normalized_skills`` must already be canonical (sorted by ``name``, inputs sorted by key).
    """
    if not normalized_skills:
        return "(none)"

    paragraphs: list[str] = []
    for skill in normalized_skills:
        paragraphs.append("\n".join(_format_one_skill(skill)))
    return "\n\n".join(paragraphs)
