import { EditorPage } from "@/features/editor/EditorPage";

export default function Page({ params }: { params: { workflowId: string } }) {
  return <EditorPage workflowId={params.workflowId} />;
}
