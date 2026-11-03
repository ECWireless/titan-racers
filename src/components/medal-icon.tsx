import { MEDAL_LABELS, type MedalTier } from "@/game/race/race-medals";

const MEDAL_COLORS: Record<MedalTier, string> = {
  bronze: "#c27a45",
  gold: "#e3b24f",
  silver: "#c3ccd4",
};

/**
 * A podium medal, its rank on the disc, named for screen readers ("1,
 * Gold") unless `decorative` (when its name is shown beside it).
 */
export function MedalIcon({
  decorative = false,
  rank,
  tier,
}: {
  decorative?: boolean;
  rank: number;
  tier: MedalTier;
}) {
  return (
    <svg
      {...(decorative
        ? { "aria-hidden": true }
        : { "aria-label": `${rank}, ${MEDAL_LABELS[tier]}`, role: "img" })}
      className="size-7 shrink-0"
      viewBox="0 0 28 28"
    >
      <path
        d="M8 2h4l3 8h-4zM20 2h-4l-3 8h4z"
        fill={MEDAL_COLORS[tier]}
        opacity={0.55}
      />
      <circle cx="14" cy="18" fill={MEDAL_COLORS[tier]} r="8.5" />
      <text
        fill="#070706"
        fontFamily="Courier New, Courier, monospace"
        fontSize="10"
        fontWeight="700"
        textAnchor="middle"
        x="14"
        y="21.5"
      >
        {rank}
      </text>
    </svg>
  );
}
