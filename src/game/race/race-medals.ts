/** The board's top three: gold, silver, and bronze, by current rank. */
const MEDAL_TIERS = ["gold", "silver", "bronze"] as const;
export type MedalTier = (typeof MEDAL_TIERS)[number];

export const MEDAL_LABELS: Record<MedalTier, string> = {
  bronze: "Bronze",
  gold: "Gold",
  silver: "Silver",
};

export function medalForRank(rank: number): MedalTier | null {
  return MEDAL_TIERS[rank - 1] ?? null;
}
