CREATE OR REPLACE FUNCTION prevent_terminal_gameplay_run_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.outcome IS NOT NULL AND (
    NEW.course_id IS DISTINCT FROM OLD.course_id
    OR NEW.deployment_version IS DISTINCT FROM OLD.deployment_version
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.loaded_at IS DISTINCT FROM OLD.loaded_at
    OR NEW.runtime_load_time_ms IS DISTINCT FROM OLD.runtime_load_time_ms
    OR NEW.racing_started_at IS DISTINCT FROM OLD.racing_started_at
    OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
    OR NEW.outcome IS DISTINCT FROM OLD.outcome
    OR NEW.completed_race_time_ms IS DISTINCT FROM OLD.completed_race_time_ms
    OR NEW.input_families IS DISTINCT FROM OLD.input_families
    OR NEW.recovery_count IS DISTINCT FROM OLD.recovery_count
    OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
  ) THEN
    RAISE EXCEPTION 'terminal gameplay runs are immutable';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER gameplay_runs_terminal_immutable
BEFORE UPDATE ON gameplay_runs
FOR EACH ROW
EXECUTE FUNCTION prevent_terminal_gameplay_run_changes();
