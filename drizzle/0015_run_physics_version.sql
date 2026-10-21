ALTER TABLE "gameplay_runs" ADD COLUMN "physics_version" text;--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD CONSTRAINT "gameplay_runs_physics_version_length" CHECK ("gameplay_runs"."physics_version" is null or char_length("gameplay_runs"."physics_version") between 1 and 80);
--> statement-breakpoint
CREATE FUNCTION prevent_gameplay_run_physics_version_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.physics_version IS DISTINCT FROM OLD.physics_version THEN
    RAISE EXCEPTION 'gameplay run physics version cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gameplay_runs_physics_version_immutable
BEFORE UPDATE ON gameplay_runs
FOR EACH ROW
EXECUTE FUNCTION prevent_gameplay_run_physics_version_changes();
