"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/" },
  { label: "Workflow Editor", href: "/editor/new" },
  { label: "Run History", href: "/history" }
];

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-slate-200 bg-white transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex items-center justify-between px-4 py-4">
        {!isCollapsed && (
          <h2 className="text-sm font-semibold text-slate-900">Navigation</h2>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "ml-auto rounded-md p-1.5 text-slate-600 hover:bg-slate-100",
            isCollapsed && "mx-auto"
          )}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            className={cn("h-5 w-5 transition-transform", isCollapsed && "rotate-180")}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      </div>
      <nav className="flex-1 space-y-2 px-4">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                isCollapsed && "justify-center"
              )}
              title={isCollapsed ? item.label : undefined}
            >
              {isCollapsed ? (
                <span className="text-lg">{item.label.charAt(0)}</span>
              ) : (
                item.label
              )}
            </Link>
          );
        })}
      </nav>
      {!isCollapsed && (
        <div className="mt-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-semibold text-slate-900">Mode</p>
          <p className="mt-1">Authoring and Monitoring are separated.</p>
        </div>
      )}
    </aside>
  );
}
