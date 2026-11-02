/** Medal tiers from lowest to highest; each is granted once per course. */
export const MEDAL_TIERS = ["finish", "bronze", "silver", "gold"] as const;
type MedalTier = (typeof MEDAL_TIERS)[number];

/** Bronze, silver, and gold: within 50%, 20%, and 6% of the developer time. */
const MEDAL_PERCENT_OF_DEVELOPER_TIME = {
  bronze: 150,
  gold: 106,
  silver: 120,
} as const;

/** Every tier a verified time earns; only a finish without a developer time. */
export function earnedMedalTiers(
  timeMicroseconds: number,
  developerMicroseconds: number | null,
): MedalTier[] {
  return MEDAL_TIERS.filter(
    (tier) =>
      tier === "finish" ||
      (developerMicroseconds !== null &&
        timeMicroseconds * 100 <=
          developerMicroseconds * MEDAL_PERCENT_OF_DEVELOPER_TIME[tier]),
  );
}
