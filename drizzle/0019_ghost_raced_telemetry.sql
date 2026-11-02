ALTER TABLE "gameplay_runs" ADD COLUMN "ghost" text;--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD CONSTRAINT "gameplay_runs_ghost" CHECK ("gameplay_runs"."ghost" is null or ("gameplay_runs"."kart_id" is not null and "gameplay_runs"."ghost" in ('none', 'own_best')));--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_gameplay_run_race_identity_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.course_id IS DISTINCT FROM OLD.course_id
    OR NEW.course_revision IS DISTINCT FROM OLD.course_revision
    OR NEW.kart_id IS DISTINCT FROM OLD.kart_id
    OR NEW.kart_revision IS DISTINCT FROM OLD.kart_revision
    OR NEW.race_again IS DISTINCT FROM OLD.race_again
    OR NEW.ghost IS DISTINCT FROM OLD.ghost THEN
    RAISE EXCEPTION 'gameplay run race identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
