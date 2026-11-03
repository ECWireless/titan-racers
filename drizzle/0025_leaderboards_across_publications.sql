-- Every earlier publication started its own board, so existing boards keep
-- exactly the revisions and runs they have. A build that predates the column
-- still starts one; the publisher always sets it.
ALTER TABLE "course_publications" ADD COLUMN "new_leaderboard" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leaderboards" ADD COLUMN "number" integer;--> statement-breakpoint
-- Existing boards are numbered per course in the order they were created.
UPDATE "leaderboards" SET "number" = numbered."number"
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "course_id" ORDER BY "id") AS "number"
	FROM "leaderboards"
) AS numbered
WHERE numbered."id" = "leaderboards"."id";--> statement-breakpoint
ALTER TABLE "leaderboards" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboards_number_uidx" ON "leaderboards" USING btree ("course_id","number");--> statement-breakpoint
ALTER TABLE "leaderboards" ADD CONSTRAINT "leaderboards_number_positive" CHECK ("leaderboards"."number" > 0);--> statement-breakpoint
-- A new board takes its course's next number. The lock, held until commit,
-- makes boards created at once take turns, and lets a build that names no
-- number still create boards.
CREATE FUNCTION number_leaderboard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM pg_advisory_xact_lock(hashtext('leaderboards:' || NEW.course_id));
	SELECT coalesce(max("number"), 0) + 1 INTO NEW."number"
	FROM "leaderboards" WHERE "course_id" = NEW.course_id;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER leaderboards_number
BEFORE INSERT ON "leaderboards"
FOR EACH ROW
EXECUTE FUNCTION number_leaderboard();
