CREATE TYPE "public"."race_result_status" AS ENUM('verified', 'rejected');--> statement-breakpoint
CREATE TABLE "board_bests" (
	"leaderboard_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"result_id" uuid NOT NULL,
	"time_microseconds" integer NOT NULL,
	"ghost" "bytea" NOT NULL,
	"achieved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "board_bests_leaderboard_id_user_id_pk" PRIMARY KEY("leaderboard_id","user_id"),
	CONSTRAINT "board_bests_ghost_size" CHECK (octet_length("board_bests"."ghost") between 32 and 480008)
);
--> statement-breakpoint
CREATE TABLE "leaderboards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leaderboards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"course_id" text NOT NULL,
	"course_revision" integer NOT NULL,
	"physics_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboards_physics_version_length" CHECK (char_length("leaderboards"."physics_version") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "race_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"leaderboard_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"kart_id" text NOT NULL,
	"kart_revision" integer NOT NULL,
	"status" "race_result_status" NOT NULL,
	"rejection" text,
	"time_microseconds" integer,
	"ticket_issued_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "race_results_kart" CHECK (char_length("race_results"."kart_id") between 1 and 80 and "race_results"."kart_revision" > 0),
	CONSTRAINT "race_results_outcome" CHECK (("race_results"."status" = 'verified' and "race_results"."time_microseconds" is not null and "race_results"."time_microseconds" between 1 and 900000000 and "race_results"."rejection" is null)
        or ("race_results"."status" = 'rejected' and "race_results"."time_microseconds" is null and "race_results"."rejection" is not null and "race_results"."rejection" in ('off-start', 'too-fast', 'bad-reset', 'wrong-gate', 'after-finish', 'unfinished', 'too-long', 'bad-recording', 'too-early')))
);
--> statement-breakpoint
ALTER TABLE "board_bests" ADD CONSTRAINT "board_bests_leaderboard_id_leaderboards_id_fk" FOREIGN KEY ("leaderboard_id") REFERENCES "public"."leaderboards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_bests" ADD CONSTRAINT "board_bests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_bests" ADD CONSTRAINT "board_bests_result_id_race_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."race_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboards" ADD CONSTRAINT "leaderboards_course_revision_fk" FOREIGN KEY ("course_id","course_revision") REFERENCES "public"."course_revisions"("course_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_leaderboard_id_leaderboards_id_fk" FOREIGN KEY ("leaderboard_id") REFERENCES "public"."leaderboards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_results" ADD CONSTRAINT "race_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_bests_rank_idx" ON "board_bests" USING btree ("leaderboard_id","time_microseconds","achieved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboards_board_uidx" ON "leaderboards" USING btree ("course_id","course_revision","physics_version");--> statement-breakpoint
CREATE INDEX "race_results_leaderboard_user_idx" ON "race_results" USING btree ("leaderboard_id","user_id");--> statement-breakpoint
CREATE FUNCTION prevent_race_result_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'race results are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER race_results_immutable
BEFORE UPDATE OR DELETE ON "race_results"
FOR EACH ROW
EXECUTE FUNCTION prevent_race_result_mutation();--> statement-breakpoint
CREATE FUNCTION prevent_anonymized_racer_standing()
RETURNS trigger AS $$
DECLARE
  racer_anonymized_at timestamp with time zone;
BEGIN
  -- Waits for an anonymization in progress, which locks the user row first.
  SELECT anonymized_at INTO racer_anonymized_at
  FROM users WHERE id = NEW.user_id FOR SHARE;
  IF racer_anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'anonymized racer accounts cannot gain results or bests';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER race_results_not_anonymized
BEFORE INSERT ON "race_results"
FOR EACH ROW
EXECUTE FUNCTION prevent_anonymized_racer_standing();--> statement-breakpoint
CREATE TRIGGER board_bests_not_anonymized
BEFORE INSERT OR UPDATE ON "board_bests"
FOR EACH ROW
EXECUTE FUNCTION prevent_anonymized_racer_standing();
