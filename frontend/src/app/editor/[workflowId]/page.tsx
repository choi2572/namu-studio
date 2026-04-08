import { EditorPage } from "@/features/editor/EditorPage";

export default async function Page({ params }: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await params;
  return <EditorPage workflowId={workflowId} />;
}
