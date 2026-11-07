-- Only adds a column the build before it leaves empty, so it keeps working
-- once this runs.
ALTER TABLE "race_results" ADD COLUMN "fastest_lap_microseconds" integer;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_fastest_lap" CHECK ("race_results"."fastest_lap_microseconds" is null or ("race_results"."status" = 'verified' and "race_results"."fastest_lap_microseconds" between 1 and "race_results"."time_microseconds"));--> statement-breakpoint
-- Each board best kept its run's recording, so that run's fastest lap is
-- read from it once, here. A recording's samples are 24 bytes after an
-- 8-byte header, each starting with its race time (u32, little-endian) and
-- flagging a gate crossing in bit 3 of byte 22. A race is two laps, so the
-- first lap ends at the middle crossing and the second at the last.
-- Results are otherwise never changed.
ALTER TABLE "race_results" DISABLE TRIGGER "race_results_immutable";--> statement-breakpoint
WITH "crossings" AS (
  SELECT
    "best"."result_id",
    row_number() OVER "run" AS "number",
    count(*) OVER "run" AS "total",
    get_byte("best"."ghost", "sample"."offset")::bigint
      | (get_byte("best"."ghost", "sample"."offset" + 1)::bigint << 8)
      | (get_byte("best"."ghost", "sample"."offset" + 2)::bigint << 16)
      | (get_byte("best"."ghost", "sample"."offset" + 3)::bigint << 24) AS "time"
  FROM "board_bests" "best"
  CROSS JOIN LATERAL (
    SELECT 8 + 24 * "index" AS "offset"
    FROM generate_series(0, (octet_length("best"."ghost") - 8) / 24 - 1) "index"
  ) "sample"
  WHERE get_byte("best"."ghost", "sample"."offset" + 22) & 8 <> 0
  WINDOW "run" AS (PARTITION BY "best"."result_id" ORDER BY "sample"."offset"
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
), "laps" AS (
  SELECT
    "result_id",
    max("time") FILTER (WHERE "number" = "total" / 2) AS "first",
    max("time") FILTER (WHERE "number" = "total") AS "finish"
  FROM "crossings"
  WHERE "total" % 2 = 0
  GROUP BY "result_id"
)
UPDATE "race_results"
SET "fastest_lap_microseconds" = least("laps"."first", "laps"."finish" - "laps"."first")
FROM "laps"
WHERE "race_results"."id" = "laps"."result_id"
  AND "laps"."first" > 0
  AND "laps"."finish" = "race_results"."time_microseconds";--> statement-breakpoint
ALTER TABLE "race_results" ENABLE TRIGGER "race_results_immutable";
