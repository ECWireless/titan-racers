export const SANDBOX_COURSE_ID = "rough-course";
export const AGRICULTURAL_ZONE_COURSE_ID = "agricultural-zone";

/** Courses with a bundled seed, which admins edit and runs may record. */
export const OFFICIAL_COURSE_IDS = [
  SANDBOX_COURSE_ID,
  AGRICULTURAL_ZONE_COURSE_ID,
] as const;
export type OfficialCourseId = (typeof OFFICIAL_COURSE_IDS)[number];

export function isOfficialCourseId(id: unknown): id is OfficialCourseId {
  return OFFICIAL_COURSE_IDS.includes(id as OfficialCourseId);
}

// The solo time trial races the Agricultural Zone. The sandbox stays the
// editor and physics course, and kart test drives use it.
export const CURRENT_GUEST_COURSE_ID = AGRICULTURAL_ZONE_COURSE_ID;
