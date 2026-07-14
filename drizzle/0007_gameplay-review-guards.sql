CREATE TYPE "public"."gameplay_run_attribution" AS ENUM('guest', 'authenticated');--> statement-breakpoint
DROP INDEX IF EXISTS "gameplay_runs_user_id_idx";--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD COLUMN "attribution" "gameplay_run_attribution" DEFAULT 'guest' NOT NULL;--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD CONSTRAINT "gameplay_runs_guest_has_no_user" CHECK ("gameplay_runs"."attribution" <> 'guest' or "gameplay_runs"."user_id" is null);--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD CONSTRAINT "gameplay_runs_known_course" CHECK ("gameplay_runs"."course_id" = 'rough-course');--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD CONSTRAINT "gameplay_runs_milestone_order" CHECK (
        ("gameplay_runs"."loaded_at" is null or "gameplay_runs"."loaded_at" >= "gameplay_runs"."started_at")
        and ("gameplay_runs"."racing_started_at" is null or ("gameplay_runs"."loaded_at" is not null and "gameplay_runs"."racing_started_at" >= "gameplay_runs"."loaded_at"))
        and ("gameplay_runs"."ended_at" is null or "gameplay_runs"."ended_at" >= "gameplay_runs"."started_at")
      );--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD CONSTRAINT "gameplay_runs_terminal_stage" CHECK (
        "gameplay_runs"."outcome" is null
        or "gameplay_runs"."outcome" = 'exited'
        or ("gameplay_runs"."outcome" = 'completed' and "gameplay_runs"."racing_started_at" is not null and "gameplay_runs"."ended_at" >= "gameplay_runs"."racing_started_at")
        or ("gameplay_runs"."outcome" = 'load_failed' and "gameplay_runs"."loaded_at" is null and "gameplay_runs"."racing_started_at" is null)
        or ("gameplay_runs"."outcome" = 'runtime_failed' and "gameplay_runs"."loaded_at" is not null and "gameplay_runs"."ended_at" >= "gameplay_runs"."loaded_at")
      );--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_gameplay_run_attribution_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.attribution IS DISTINCT FROM OLD.attribution
    OR (OLD.user_id IS NULL AND NEW.user_id IS NOT NULL)
    OR (
      OLD.user_id IS NOT NULL
      AND NEW.user_id IS NOT NULL
      AND NEW.user_id IS DISTINCT FROM OLD.user_id
    )
  THEN
    RAISE EXCEPTION 'gameplay run attribution cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER gameplay_runs_attribution_immutable
BEFORE UPDATE ON gameplay_runs
FOR EACH ROW
EXECUTE FUNCTION prevent_gameplay_run_attribution_changes();
