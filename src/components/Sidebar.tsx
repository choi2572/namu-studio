"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/" },
  { label: "Workflow Editor", href: "/editor/new" },
  { label: "Run History", href: "/history" }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-slate-200 bg-white px-4 py-6">
      <nav className="space-y-2">
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
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        <p className="font-semibold text-slate-900">Mode</p>
        <p className="mt-1">Authoring and Monitoring are separated.</p>
      </div>
    </aside>
  );
}
