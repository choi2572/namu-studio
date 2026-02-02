"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { cn } from "@/lib/cn";
import type { VariableSuggestion } from "@/lib/variableReferences";
import {
  filterVariableSuggestions,
  validateVariablePath
} from "@/lib/variableReferences";

const DEFAULT_PLACEHOLDER =
  "Enter value or type $ to reference a variable";

type VariableInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions: VariableSuggestion[];
  className?: string;
  "data-no-drag"?: boolean;
  disabled?: boolean;
};

export function VariableInput({
  value,
  onChange,
  placeholder = DEFAULT_PLACEHOLDER,
  suggestions,
  className,
  "data-no-drag": dataNoDrag,
  disabled = false
}: VariableInputProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const availablePaths = suggestions.map((s) => s.path);
  const validation = validateVariablePath(value, availablePaths);
  const isVariableRef = value.trim().startsWith("$");
  const hasError = !validation.valid;

  const filtered = filterVariableSuggestions(suggestions, filter);
  const showSuggestions = showDropdown && filtered.length > 0;

  const openDropdown = useCallback((afterDollar: string) => {
    setFilter(afterDollar);
    setShowDropdown(true);
    setHighlightIndex(0);
  }, []);

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
    setFilter("");
    setHighlightIndex(0);
  }, []);

  const insertSuggestion = useCallback(
    (path: string) => {
      const input = inputRef.current;
      if (!input) return;
      const start = input.selectionStart ?? 0;
      const before = value.slice(0, start);
      const lastDollar = before.lastIndexOf("$");
      const prefix = lastDollar >= 0 ? value.slice(0, lastDollar) : value;
      const suffix = value.slice(start);
      const next = prefix + path + suffix;
      onChange(next);
      requestAnimationFrame(() => {
        const newPos = prefix.length + path.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();
      });
    },
    [value, onChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      onChange(next);

      const cursorPos = e.target.selectionStart ?? 0;
      const textBeforeCursor = next.slice(0, cursorPos);
      const lastDollar = textBeforeCursor.lastIndexOf("$");
      if (lastDollar !== -1) {
        const afterDollar = textBeforeCursor.slice(lastDollar + 1);
        if (!afterDollar.includes(" ") && !afterDollar.includes("\n")) {
          openDropdown(afterDollar);
          return;
        }
      }
      closeDropdown();
    },
    [onChange, openDropdown, closeDropdown]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions) {
        if (e.key === "Escape") closeDropdown();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) =>
          i === 0 ? filtered.length - 1 : i - 1
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const selected = filtered[highlightIndex];
        if (selected) {
          e.preventDefault();
          insertSuggestion(selected.path);
          closeDropdown();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeDropdown();
      }
    },
    [
      showSuggestions,
      filtered,
      highlightIndex,
      closeDropdown,
      insertSuggestion
    ]
  );

  useEffect(() => {
    if (!showDropdown) return;
    const el = dropdownRef.current;
    if (!el) return;
    const highlighted = el.querySelector(
      `[data-index="${highlightIndex}"]`
    ) as HTMLElement | null;
    highlighted?.scrollIntoView({ block: "nearest" });
  }, [showDropdown, highlightIndex]);

  useEffect(() => {
    if (!showSuggestions) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        inputRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      closeDropdown();
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [showSuggestions, closeDropdown]);

  const resolvedSuggestion = value.trim().startsWith("$")
    ? suggestions.find((s) => s.path === value.trim())
    : undefined;
  const tooltipTitle = resolvedSuggestion?.type
    ? `Variable (${resolvedSuggestion.type})`
    : isVariableRef
      ? "Variable reference"
      : undefined;

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          const v = value;
          const lastDollar = v.lastIndexOf("$");
          if (lastDollar !== -1) {
            const after = v.slice(lastDollar + 1);
            if (!after.includes(" ") && !after.includes("\n")) {
              openDropdown(after);
            }
          }
        }}
        placeholder={placeholder}
        title={tooltipTitle}
        disabled={disabled}
        data-no-drag={dataNoDrag}
        className={cn(
          "w-full rounded-md border px-2 py-1 text-xs text-slate-700 focus:outline-none",
          hasError &&
            "border-red-400 focus:border-red-500",
          !hasError &&
            isVariableRef &&
            "border-amber-300 focus:border-amber-400",
          !hasError && !isVariableRef && "border-slate-200 focus:border-slate-400",
          disabled && "cursor-not-allowed bg-slate-50 text-slate-500"
        )}
      />
      {showSuggestions && (
        <div
          ref={dropdownRef}
          className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full min-w-[200px] overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          role="listbox"
        >
          {filtered.map((s, index) => (
            <button
              key={s.path}
              type="button"
              role="option"
              data-index={index}
              aria-selected={index === highlightIndex}
              className={cn(
                "w-full cursor-pointer px-2 py-1.5 text-left text-xs",
                index === highlightIndex
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-700 hover:bg-slate-50"
              )}
              onMouseEnter={() => setHighlightIndex(index)}
              onMouseDown={(e) => {
                e.preventDefault();
                insertSuggestion(s.path);
                closeDropdown();
              }}
            >
              <span className="font-mono text-slate-600">{s.path}</span>
              {s.type && (
                <span className="ml-2 text-slate-400">({s.type})</span>
              )}
            </button>
          ))}
        </div>
      )}
      {hasError && validation.error && (
        <p
          className="mt-0.5 text-[10px] text-red-600"
          role="alert"
        >
          {validation.error}
        </p>
      )}
    </div>
  );
}
