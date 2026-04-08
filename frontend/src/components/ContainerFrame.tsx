import type { PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/lib/cn";

export type ResizeHandle = "e" | "s" | "se";

export type ContainerFrameRegion = {
  index: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  isEmpty?: boolean;
};

type ContainerFrameProps = {
  id: string;
  label: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  headerHeight: number;
  regions: ContainerFrameRegion[];
  highlight?: boolean;
  /** Read-only mode (e.g. Monitor): no resize handles, no drag. */
  readOnly?: boolean;
  /** Optional badge in header (e.g. "Branch 1: running", "Repeat: 2/5"). */
  badgeLabel?: string | null;
  onResizeStart?: (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export function ContainerFrame({
  id,
  label,
  position,
  size,
  headerHeight,
  regions,
  highlight,
  readOnly = false,
  badgeLabel,
  onResizeStart
}: ContainerFrameProps) {
  const verticalDividerPositions = Array.from(
    new Set(
      regions
        .slice(1)
        .map((region) => region.bounds.x - position.x)
        .filter((value) => value > 0)
    )
  ).sort((a, b) => a - b);

  // Parallel 세로 스택 레이아웃일 때 브랜치 사이를 가르는 가로 구분선
  const hasVerticalStack =
    regions.length > 1 && regions.every((region) => region.bounds.x === regions[0].bounds.x);

  const horizontalDividerPositions = hasVerticalStack
    ? Array.from(
        new Set(
          regions
            .slice(1)
            .map((region) => region.bounds.y - position.y)
            .filter((value) => value > 0)
        )
      ).sort((a, b) => a - b)
    : [];

  return (
    <div
      data-container-frame={id}
      className={cn(
        "absolute rounded-lg border-2 bg-slate-100/80 shadow-inner",
        highlight ? "border-amber-400" : "border-slate-300"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height
      }}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 flex items-center justify-between rounded-t-lg border-b px-3 text-xs font-semibold text-slate-700",
          highlight ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white/70"
        )}
        style={{ height: headerHeight }}
      >
        <span>{label}</span>
        {readOnly && badgeLabel && (
          <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            {badgeLabel}
          </span>
        )}
        {!readOnly && highlight && (
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            Needs content
          </span>
        )}
      </div>

      {verticalDividerPositions.map((offset) => (
        <div
          key={`v-divider-${offset}`}
          className="absolute top-0 bottom-0 w-[2px] bg-slate-400/70"
          style={{ left: offset, top: headerHeight }}
        />
      ))}

      {horizontalDividerPositions.map((offset) => (
        <div
          key={`h-divider-${offset}`}
          className="absolute left-0 right-0 h-[2px] bg-slate-400/70"
          style={{ top: offset }}
        />
      ))}

      {regions.map((region) => {
        const left = region.bounds.x - position.x;
        const top = region.bounds.y - position.y;
        return (
          <div
            key={`${id}-region-${region.index}`}
            className="absolute text-[10px] font-semibold text-slate-500"
            style={{ left: left + 6, top: top + 6 }}
          >
            <div className="flex items-center gap-2">
              <span>{region.label}</span>
              {!readOnly && region.isEmpty && (
                <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-700">
                  Empty
                </span>
              )}
            </div>
          </div>
        );
      })}

      {!readOnly && (
        <>
          <button
            type="button"
            data-no-drag
            className="absolute right-0 top-1/2 h-6 w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-slate-300/80 hover:bg-slate-400"
            onPointerDown={(event) => {
              event.stopPropagation();
              onResizeStart?.("e", event);
            }}
          />
          <button
            type="button"
            data-no-drag
            className="absolute bottom-0 left-1/2 h-2 w-6 -translate-x-1/2 cursor-ns-resize rounded-full bg-slate-300/80 hover:bg-slate-400"
            onPointerDown={(event) => {
              event.stopPropagation();
              onResizeStart?.("s", event);
            }}
          />
          <button
            type="button"
            data-no-drag
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize rounded-full bg-slate-400/80 hover:bg-slate-500"
            onPointerDown={(event) => {
              event.stopPropagation();
              onResizeStart?.("se", event);
            }}
          />
        </>
      )}
    </div>
  );
}
