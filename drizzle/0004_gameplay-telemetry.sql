CREATE TYPE "public"."gameplay_input_family" AS ENUM('keyboard', 'touch', 'gamepad');--> statement-breakpoint
CREATE TYPE "public"."gameplay_run_outcome" AS ENUM('completed', 'exited', 'load_failed', 'runtime_failed');--> statement-breakpoint
CREATE TABLE "gameplay_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text,
	"course_id" text NOT NULL,
	"deployment_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"loaded_at" timestamp with time zone,
	"racing_started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"outcome" "gameplay_run_outcome",
	"completed_race_time_ms" integer,
	"input_families" "gameplay_input_family"[] NOT NULL,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gameplay_runs_course_id_length" CHECK (char_length("gameplay_runs"."course_id") between 1 and 80),
	CONSTRAINT "gameplay_runs_deployment_version_length" CHECK (char_length("gameplay_runs"."deployment_version") between 1 and 120),
	CONSTRAINT "gameplay_runs_recovery_count_nonnegative" CHECK ("gameplay_runs"."recovery_count" >= 0),
	CONSTRAINT "gameplay_runs_completed_race_time_nonnegative" CHECK ("gameplay_runs"."completed_race_time_ms" is null or "gameplay_runs"."completed_race_time_ms" >= 0),
	CONSTRAINT "gameplay_runs_failure_code_length" CHECK ("gameplay_runs"."failure_code" is null or char_length("gameplay_runs"."failure_code") between 1 and 64),
	CONSTRAINT "gameplay_runs_terminal_pair" CHECK (("gameplay_runs"."ended_at" is null and "gameplay_runs"."outcome" is null) or ("gameplay_runs"."ended_at" is not null and "gameplay_runs"."outcome" is not null)),
	CONSTRAINT "gameplay_runs_outcome_payload" CHECK (
        ("gameplay_runs"."outcome" is null and "gameplay_runs"."completed_race_time_ms" is null and "gameplay_runs"."failure_code" is null)
        or ("gameplay_runs"."outcome" = 'completed' and "gameplay_runs"."completed_race_time_ms" is not null and "gameplay_runs"."failure_code" is null)
        or ("gameplay_runs"."outcome" = 'exited' and "gameplay_runs"."completed_race_time_ms" is null and "gameplay_runs"."failure_code" is null)
        or ("gameplay_runs"."outcome" in ('load_failed', 'runtime_failed') and "gameplay_runs"."completed_race_time_ms" is null and "gameplay_runs"."failure_code" is not null)
      )
);
--> statement-breakpoint
ALTER TABLE "gameplay_runs" ADD CONSTRAINT "gameplay_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gameplay_runs_started_at_idx" ON "gameplay_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "gameplay_runs_user_id_idx" ON "gameplay_runs" USING btree ("user_id");