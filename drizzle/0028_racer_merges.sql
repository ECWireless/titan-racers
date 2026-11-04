-- Only adds tables and new exceptions to existing triggers, so the build
-- before it keeps working once this runs.
CREATE TABLE "racer_former_usernames" (
	"username" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "racer_merges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"merged_racer_created_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "racer_former_usernames" ADD CONSTRAINT "racer_former_usernames_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "racer_merges" ADD CONSTRAINT "racer_merges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "racer_former_usernames_user_id_idx" ON "racer_former_usernames" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "racer_merges_user_id_idx" ON "racer_merges" USING btree ("user_id");--> statement-breakpoint
-- A username claim and a merge retiring the same name take turns on one
-- lock, so a retired name is never claimed while a merge is under way. A
-- merge calls this before deleting the racer it brought in.
CREATE FUNCTION lock_racer_username(racer_username text)
RETURNS void AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('racer-username:' || racer_username, 0)
  );
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE FUNCTION prevent_former_username_claim()
RETURNS trigger AS $$
BEGIN
  IF NEW.username IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.username IS DISTINCT FROM OLD.username) THEN
    PERFORM lock_racer_username(NEW.username);
    IF EXISTS (
      SELECT 1 FROM racer_former_usernames WHERE username = NEW.username
    ) THEN
      RAISE EXCEPTION 'that username belongs to another racer'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER users_username_not_former
BEFORE INSERT OR UPDATE OF username ON "users"
FOR EACH ROW
EXECUTE FUNCTION prevent_former_username_claim();--> statement-breakpoint
CREATE FUNCTION reserve_former_username()
RETURNS trigger AS $$
BEGIN
  PERFORM lock_racer_username(NEW.username);
  IF EXISTS (SELECT 1 FROM users WHERE username = NEW.username) THEN
    RAISE EXCEPTION 'a current username cannot also be a former one'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER racer_former_usernames_reserved
BEFORE INSERT OR UPDATE ON "racer_former_usernames"
FOR EACH ROW
EXECUTE FUNCTION reserve_former_username();--> statement-breakpoint
-- A merge moves a brought-in racer's results to the racer that keeps them.
-- It names both racers in titan.racer_merge for its own transaction;
-- nothing else about a result ever changes.
CREATE OR REPLACE FUNCTION prevent_race_result_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.user_id IS DISTINCT FROM OLD.user_id
    AND current_setting('titan.racer_merge', true) = OLD.user_id || ' ' || NEW.user_id
    AND to_jsonb(NEW) - 'user_id' = to_jsonb(OLD) - 'user_id'
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'race results are immutable';
END;
$$;--> statement-breakpoint
-- The same exception for a brought-in racer's run summaries.
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
      AND current_setting('titan.racer_merge', true)
        IS DISTINCT FROM OLD.user_id || ' ' || NEW.user_id
    )
  THEN
    RAISE EXCEPTION 'gameplay run attribution cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;
