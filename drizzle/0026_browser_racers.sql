-- The new column and table only add, and clearing session metadata changes
-- nothing the build before them reads, so it keeps working once this runs.
-- Better Auth's rate limiter counts requests in rate_limits instead of in
-- each server instance's memory.
CREATE TABLE "rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Sessions no longer keep where or on what they started; this clears the
-- ones already stored, and renewal clears any the earlier build writes later.
UPDATE "sessions" SET "ip_address" = NULL, "user_agent" = NULL;
