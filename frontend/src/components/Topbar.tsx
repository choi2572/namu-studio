export function Topbar() {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center gap-2.5">
        <svg
          className="h-8 w-8 shrink-0 text-slate-800"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <rect x="4" y="6" width="10" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
          <path
            d="M18 10h6l4 8-4 8h-6l4-8-4-8z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-lg font-semibold text-slate-900">
          namu<span className="text-orange-500">Studio</span>
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-600">
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
          </svg>
        </div>
        <span className="font-medium text-slate-700">robot_name</span>
      </div>
    </header>
  );
}
