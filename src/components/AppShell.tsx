import { ReactNode } from "react";

import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
