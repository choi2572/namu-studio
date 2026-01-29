import { describe, expect, it } from "vitest";

import {
  createRootContext,
  getAllowedNodeKinds,
  navigateToContextIndex,
  popContext,
  pushParallelBranchContext,
  pushRepeatContext
} from "@/features/editor/editorContext";
import type {
  NodeCategory,
  NodeKind,
  NodeTypeConfig
} from "@/features/editor/editorTypes";

const makeConfig = (category: NodeCategory): NodeTypeConfig => ({
  label: "Label",
  category,
  iconText: "IC",
  colorClass: "border-slate-200",
  paramFields: [],
  outputs: []
});

describe("editor context stack", () => {
  it("supports entering and exiting focus mode", () => {
    const root = createRootContext("Workflow Foo");
    const repeatStack = pushRepeatContext([root], "node-1", "R1");
    expect(repeatStack.map((item) => item.kind)).toEqual(["root", "repeat"]);

    const parallelStack = pushParallelBranchContext([root], "node-2", "P1", 0);
    expect(parallelStack.map((item) => item.kind)).toEqual([
      "root",
      "parallel",
      "branch"
    ]);

    const popped = popContext(parallelStack);
    expect(popped.map((item) => item.kind)).toEqual(["root", "parallel"]);
  });

  it("navigates breadcrumb segments by index", () => {
    const root = createRootContext("Workflow Foo");
    const stack = pushParallelBranchContext([root], "node-2", "P1", 1);
    const trimmed = navigateToContextIndex(stack, 1);
    expect(trimmed.map((item) => item.kind)).toEqual(["root", "parallel"]);
  });
});

describe("palette restrictions", () => {
  it("filters allowed kinds by context", () => {
    const root = createRootContext("Workflow Foo");
    const nodeTypes: NodeKind[] = [
      "skill.Foo",
      "flow_control.repeat",
      "event.webhook",
      "flow_control.wait" as NodeKind
    ];
    const nodeTypeConfig: Record<NodeKind, NodeTypeConfig> = {
      "skill.Foo": makeConfig("skill"),
      "flow_control.repeat": makeConfig("flow_control"),
      "event.webhook": makeConfig("event"),
      "flow_control.wait": makeConfig("flow_control")
    };

    const rootAllowed = getAllowedNodeKinds([root], nodeTypes, nodeTypeConfig);
    expect(rootAllowed).toEqual(nodeTypes);

    const repeatStack = pushRepeatContext([root], "node-1", "R1");
    const repeatAllowed = getAllowedNodeKinds(repeatStack, nodeTypes, nodeTypeConfig);
    expect(repeatAllowed).toEqual(["skill.Foo"]);

    const branchStack = pushParallelBranchContext([root], "node-2", "P1", 0);
    const branchAllowed = getAllowedNodeKinds(branchStack, nodeTypes, nodeTypeConfig);
    expect(branchAllowed).toEqual(["skill.Foo", "flow_control.wait"]);
  });
});
