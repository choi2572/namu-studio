export function Topbar() {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
          RW
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Robot Workflow Studio
          </p>
          <p className="text-xs text-slate-500">
            Authoring &amp; Monitoring
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          Demo Robot · Lab
        </span>
        <button className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600">
          Settings
        </button>
      </div>
    </header>
  );
}
