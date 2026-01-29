"use client";

type SubflowBannerProps = {
  label: string;
  onBack: () => void;
};

export function SubflowBanner({ label, onBack }: SubflowBannerProps) {
  return (
    <div className="sticky top-0 z-20 mb-3 ml-16 mr-4 flex items-center gap-3 rounded-xl border border-slate-900/80 bg-slate-900/90 px-4 py-3 text-base font-semibold text-white shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={onBack}
        className="cursor-pointer inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:bg-white/20"
      >
        <span aria-hidden>←</span>
        Back
      </button>
      <span className="text-base font-semibold">Editing: {label}</span>
    </div>
  );
}
