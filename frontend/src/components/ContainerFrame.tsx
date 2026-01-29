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
  onResizeStart?: (
    handle: ResizeHandle,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void;
};

export function ContainerFrame({
  id,
  label,
  position,
  size,
  headerHeight,
  regions,
  highlight,
  onResizeStart
}: ContainerFrameProps) {
  const dividerPositions = Array.from(
    new Set(
      regions
        .slice(1)
        .map((region) => region.bounds.x - position.x)
        .filter((value) => value > 0)
    )
  ).sort((a, b) => a - b);

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
        {highlight && (
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            Needs content
          </span>
        )}
      </div>

      {dividerPositions.map((offset) => (
        <div
          key={`divider-${offset}`}
          className="absolute top-0 bottom-0 w-[2px] bg-slate-400/70"
          style={{ left: offset, top: headerHeight }}
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
              {region.isEmpty && (
                <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-700">
                  Empty
                </span>
              )}
            </div>
          </div>
        );
      })}

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
    </div>
  );
}
