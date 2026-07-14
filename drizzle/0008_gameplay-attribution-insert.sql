CREATE OR REPLACE FUNCTION enforce_gameplay_run_initial_attribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    (NEW.attribution = 'guest' AND NEW.user_id IS NULL)
    OR (NEW.attribution = 'authenticated' AND NEW.user_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'gameplay run initial attribution is invalid';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER gameplay_runs_initial_attribution_valid
BEFORE INSERT ON gameplay_runs
FOR EACH ROW
EXECUTE FUNCTION enforce_gameplay_run_initial_attribution();
