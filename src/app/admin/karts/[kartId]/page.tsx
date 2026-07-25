import { KartEditorAccess } from "@/components/kart-editor/kart-editor-access";

export default async function KartEditorPage({
  params,
}: {
  params: Promise<{ kartId: string }>;
}) {
  const { kartId } = await params;
  return <KartEditorAccess key={kartId} kartId={kartId} />;
}
