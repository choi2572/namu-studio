import { MonitorPage } from "@/features/monitor/MonitorPage";

export default function Page({ params }: { params: { runId: string } }) {
  return <MonitorPage runId={params.runId} />;
}
