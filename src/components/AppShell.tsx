import { ReactNode } from "react";

import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Topbar />
      <div className="flex min-h-[calc(100vh-73px)]">
        <Sidebar />
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
