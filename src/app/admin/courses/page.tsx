import {
  OfficialCourseRosterAccess,
  type OfficialCourseRosterCard,
} from "@/components/course-editor/official-course-roster-access";
import { BUNDLED_COURSE_DOCUMENTS } from "@/game/course/course-document";
import { OFFICIAL_COURSE_IDS } from "@/game/course/course-ids";

const COURSE_PURPOSES = {
  "agricultural-zone": "The solo time trial course inside Island Three.",
  "rough-course":
    "The editor and physics sandbox, and the Kart Builder's test-drive course.",
} as const;

const officialCourses = OFFICIAL_COURSE_IDS.map((courseId) => ({
  courseId,
  name: BUNDLED_COURSE_DOCUMENTS[courseId].name,
  purpose: COURSE_PURPOSES[courseId],
})) satisfies OfficialCourseRosterCard[];

export default function OfficialCourseRosterPage() {
  return <OfficialCourseRosterAccess officialCourses={officialCourses} />;
}
