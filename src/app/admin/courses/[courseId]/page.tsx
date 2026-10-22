import { notFound } from "next/navigation";

import { CourseEditorAccess } from "@/components/course-editor/course-editor-access";
import { isOfficialCourseId } from "@/game/course/course-ids";

export default async function CourseEditorPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  if (!isOfficialCourseId(courseId)) notFound();
  return <CourseEditorAccess courseId={courseId} key={courseId} />;
}
