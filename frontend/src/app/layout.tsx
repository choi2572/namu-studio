import type { Metadata } from "next";

import "./globals.css";

import { AppShell } from "@/components/AppShell";
import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: "Robot Workflow Studio",
  description: "Workflow authoring and monitoring tool"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
