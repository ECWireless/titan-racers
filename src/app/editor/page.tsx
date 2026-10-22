import { redirect } from "next/navigation";

// The course editor moved under /admin/courses beside the Kart Builder.
export default function LegacyCourseEditorPage() {
  redirect("/admin/courses");
}
