"use client";

import type { DragEvent } from "react";

import { cn } from "@/lib/cn";

import { NODE_CATEGORIES, NODE_CATEGORY_LABELS } from "../editorConstants";
import type { NodeCategory, NodeKind, NodeTypeConfig } from "../editorTypes";

export type EditorPaletteProps = {
  selectedCategory: NodeCategory;
  onSelectCategory: (category: NodeCategory) => void;
  nodeTypesByCategory: Record<NodeCategory, NodeKind[]>;
  nodeTypeConfig: Record<NodeKind, NodeTypeConfig>;
  onNodeKindDragStart: (event: DragEvent<HTMLButtonElement>, kind: NodeKind) => void;
  onNodeKindClick: (kind: NodeKind) => void;
};

export function EditorPalette({
  selectedCategory,
  onSelectCategory,
  nodeTypesByCategory,
  nodeTypeConfig,
  onNodeKindDragStart,
  onNodeKindClick
}: EditorPaletteProps) {
  return (
    <div className="absolute left-16 top-4 z-10 flex rounded-lg border border-slate-200 bg-white shadow-lg">
      <div className="w-32 border-r border-slate-200 p-3">
        <p className="text-[10px] font-semibold text-slate-500">Category</p>
        <div className="mt-2 space-y-1">
          {NODE_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => onSelectCategory(category.id)}
              className={cn(
                "cursor-pointer w-full rounded-md px-2 py-1 text-left text-xs",
                selectedCategory === category.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>
      <div className="w-72 p-3">
        <p className="text-xs font-semibold text-slate-700">
          {NODE_CATEGORY_LABELS[selectedCategory]}
        </p>
        <div className="mt-3 max-h-[23rem] space-y-2 overflow-y-auto overscroll-y-contain pr-1">
          {nodeTypesByCategory[selectedCategory].map((kind) => {
            const config = nodeTypeConfig[kind];
            return (
              <button
                key={kind}
                type="button"
                draggable
                onDragStart={(event) => onNodeKindDragStart(event, kind)}
                onClick={() => onNodeKindClick(kind)}
                className="cursor-pointer flex w-full items-center gap-3 rounded-md border border-slate-200 px-2 py-2 text-left text-xs text-slate-700 hover:border-slate-300"
              >
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border text-[10px] font-semibold",
                    config.colorClass
                  )}
                >
                  {config.iconText}
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold">{config.label}</p>
                  <p className="text-[10px] text-slate-500">
                    {kind.startsWith("skill.") ? kind.replace("skill.", "") : kind}
                  </p>
                </div>
                <span className="text-[10px] text-slate-400">Drag</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] text-slate-400">
          Drag onto the canvas or click to add at center.
        </p>
      </div>
    </div>
  );
}
