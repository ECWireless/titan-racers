ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
UPDATE "users"
SET "name" = coalesce(
      substring(btrim("name") from '^[^[:space:]]+'),
      'racer'
    ),
    "image" = null
WHERE "anonymized_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uidx" ON "users" USING btree ("username");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_format" CHECK ("users"."username" is null or ("users"."username" ~ '^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$' and "users"."username" !~ '__'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_reserved" CHECK ("users"."username" is null or (replace("users"."username", '_', '') not in ('admin', 'administrator', 'deleted', 'moderator', 'official', 'racer', 'root', 'staff', 'support', 'system', 'titanracers') and replace("users"."username", '_', '') not like '%titanracers%' and "users"."username" !~ '(^|_)(admin|administrator|moderator|official|root|staff|support|system|titan)($|_)'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_racer_username_change()
RETURNS trigger AS $$
BEGIN
  IF OLD.anonymized_at IS NOT NULL
    AND NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at THEN
    RAISE EXCEPTION 'anonymized racer accounts cannot be reactivated';
  END IF;
  IF OLD.username IS NULL
    AND NEW.username IS NOT NULL
    AND OLD.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'anonymized racer accounts cannot claim usernames';
  END IF;
  IF NEW.anonymized_at IS NOT NULL AND NEW.username IS NOT NULL THEN
    RAISE EXCEPTION 'anonymized racer accounts cannot have usernames';
  END IF;
  IF OLD.username IS NOT NULL
    AND NEW.username IS DISTINCT FROM OLD.username
    AND NOT (
      NEW.username IS NULL
      AND OLD.anonymized_at IS NULL
      AND NEW.anonymized_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'racer username is immutable after account creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER users_username_immutable
BEFORE UPDATE OF username, anonymized_at ON "users"
FOR EACH ROW
EXECUTE FUNCTION prevent_racer_username_change();
