ALTER TABLE "gameplay_runs" DROP CONSTRAINT "gameplay_runs_known_course";--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD COLUMN "course_revision" integer;--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD COLUMN "kart_id" text;--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD COLUMN "kart_revision" integer;--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD COLUMN "race_again" boolean;--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD CONSTRAINT "gameplay_runs_race_identity" CHECK (("gameplay_runs"."course_revision" is null or "gameplay_runs"."course_revision" > 0)
        and ("gameplay_runs"."kart_revision" is null or ("gameplay_runs"."kart_revision" > 0 and "gameplay_runs"."kart_id" is not null))
        and ("gameplay_runs"."kart_id" is null or char_length("gameplay_runs"."kart_id") between 1 and 80)
        and (("gameplay_runs"."kart_id" is null) = ("gameplay_runs"."race_again" is null)));--> statement-breakpoint
CREATE FUNCTION prevent_gameplay_run_race_identity_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.course_id IS DISTINCT FROM OLD.course_id
    OR NEW.course_revision IS DISTINCT FROM OLD.course_revision
    OR NEW.kart_id IS DISTINCT FROM OLD.kart_id
    OR NEW.kart_revision IS DISTINCT FROM OLD.kart_revision
    OR NEW.race_again IS DISTINCT FROM OLD.race_again THEN
    RAISE EXCEPTION 'gameplay run race identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gameplay_runs_race_identity_immutable
BEFORE UPDATE ON gameplay_runs
FOR EACH ROW
EXECUTE FUNCTION prevent_gameplay_run_race_identity_changes();
