"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type MouseEvent } from "react";

import { cn } from "@/lib/cn";

type NavItem = { label: string; href: string; exactMatch?: boolean };

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Workflow Editor", href: "/editor/new" },
  { label: "Run History", href: "/history" },
  { label: "Monitor", href: "/monitor", exactMatch: true }
];

export function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-slate-200 bg-white transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex items-center px-4 py-4">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "rounded-md p-1.5 text-slate-600 hover:bg-slate-100",
            isCollapsed && "mx-auto"
          )}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
        </button>
      </div>
      <nav className="flex-1 space-y-2 px-4">
        {NAV_ITEMS.map((item) => {
          const isActive = item.exactMatch
            ? pathname === item.href || pathname === `${item.href}/`
            : item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
            // When leaving editor via sidebar, always warn that edits may be lost
            if (typeof window !== "undefined") {
              const isOnEditor = pathname.startsWith("/editor");
              // Any navigation from /editor... to a different menu item should trigger confirm
              const isNavigatingToDifferentPage = item.href !== pathname;

              if (isOnEditor && isNavigatingToDifferentPage) {
                const confirmed = window.confirm(
                  "You may have unsaved changes in the editor. Leave this page?"
                );
                if (!confirmed) {
                  event.preventDefault();
                  return;
                }
              }
            }
          };

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={handleClick}
              className={cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                isCollapsed && "justify-center"
              )}
              title={isCollapsed ? item.label : undefined}
            >
              {isCollapsed ? <span className="text-lg">{item.label.charAt(0)}</span> : item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
