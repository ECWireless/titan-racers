export const SANDBOX_COURSE_ID = "rough-course";
export const FALLS_VIEW_PARK_COURSE_ID = "falls-view-park";

/** Courses with a bundled seed, which admins edit and runs may record. */
export const OFFICIAL_COURSE_IDS = [
  SANDBOX_COURSE_ID,
  FALLS_VIEW_PARK_COURSE_ID,
] as const;
export type OfficialCourseId = (typeof OFFICIAL_COURSE_IDS)[number];

export function isOfficialCourseId(id: unknown): id is OfficialCourseId {
  return OFFICIAL_COURSE_IDS.includes(id as OfficialCourseId);
}

/**
 * Courses telemetry accepts: the official courses plus the time trial's ID
 * before PR 4.3.4, which clients on an older build still send.
 */
export const TELEMETRY_COURSE_IDS = [
  ...OFFICIAL_COURSE_IDS,
  "agricultural-zone",
] as const;

// The solo time trial races Falls View Park. The sandbox stays the editor
// and physics course, and kart test drives use it.
export const CURRENT_GUEST_COURSE_ID = FALLS_VIEW_PARK_COURSE_ID;
