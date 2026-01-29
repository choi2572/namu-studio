"use client";

type SubflowBannerProps = {
  label: string;
  onBack: () => void;
};

export function SubflowBanner({ label, onBack }: SubflowBannerProps) {
  return (
    <div className="sticky top-14 z-20 mb-3 mx-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/95 px-4 py-3 text-base font-semibold text-slate-900 shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={onBack}
        className="cursor-pointer inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:text-slate-900"
      >
        <span aria-hidden>←</span>
        Back
      </button>
      <span className="text-base font-semibold">Editing: {label}</span>
    </div>
  );
}
