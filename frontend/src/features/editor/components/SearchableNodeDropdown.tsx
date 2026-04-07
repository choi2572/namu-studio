"use client";

import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";

import type { EditorNode } from "../editorTypes";

type SearchableNodeDropdownProps = {
  nodes: EditorNode[];
  selectedId: string;
  placeholder?: string;
  onChange: (id: string) => void;
};

export function SearchableNodeDropdown({
  nodes,
  selectedId,
  placeholder,
  onChange
}: SearchableNodeDropdownProps) {
  const [query, setQuery] = useState(() => {
    const selected = nodes.find((n) => n.id === selectedId);
    return selected?.name ?? "";
  });
  const filtered = useMemo(
    () =>
      nodes.filter((n) => (n.name ?? "").toLowerCase().includes(query.toLowerCase())),
    [nodes, query]
  );
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const [open, setOpen] = useState(false);

  // selectedId가 외부에서 바뀐 경우 input 표시 값 동기화
  useEffect(() => {
    const next = nodes.find((n) => n.id === selectedId);
    if (next) {
      setQuery(next.name ?? "");
    }
  }, [nodes, selectedId]);

  return (
    <div className="relative space-y-1">
      <input
        data-no-drag
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? "Select node"}
        className="w-full rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 focus:border-slate-400 focus:outline-none"
      />
      {open && filtered.length > 0 && query.length > 0 && (
        <div
          className="absolute z-10 mt-1 max-h-40 w-full overflow-auto rounded-md border border-slate-200 bg-white text-[11px] text-slate-700 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.map((n) => (
            <button
              key={n.id}
              type="button"
              data-no-drag
              className={cn(
                "flex w-full cursor-pointer items-center px-2 py-1 text-left hover:bg-slate-100",
                n.id === selected?.id ? "bg-slate-100 font-semibold" : ""
              )}
              onClick={() => {
                setQuery(n.name ?? "");
                onChange(n.id);
                setOpen(false);
              }}
            >
              {n.name || n.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
