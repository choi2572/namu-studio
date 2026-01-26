import { MonitorPage } from "@/features/monitor/MonitorPage";

export default async function Page({
  params
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <MonitorPage runId={runId} />;
}
