"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/cn";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/" },
  { label: "Workflow Editor", href: "/editor/new" },
  { label: "Run History", href: "/history" }
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
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
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
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
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
            // 에디터 페이지에서 나갈 때, 편집 중인 내용이 있으면 확인 다이얼로그 표시
            if (typeof window !== "undefined") {
              const hasUnsaved =
                (window as unknown as { __editorHasUnsavedChanges?: boolean })
                  .__editorHasUnsavedChanges ?? false;

              const isOnEditor = pathname.startsWith("/editor");
              const isNavigatingToDifferentPage = item.href !== pathname;

              if (isOnEditor && isNavigatingToDifferentPage && hasUnsaved) {
                const confirmed = window.confirm(
                  "편집 중인 내용이 있습니다. 나가시겠습니까?"
                );
                if (!confirmed) {
                  event.preventDefault();
                  return;
                }
              }
            }

            // Link 기본 동작 그대로 두되, 서버 사이드에서는 router로 보완 가능
            if (event.defaultPrevented) {
              return;
            }
            // next/link가 자체적으로 push를 처리하므로 여기서 별도 router.push는 필요 없음
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
