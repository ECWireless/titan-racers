CREATE TYPE "public"."room_race_end_reason" AS ENUM('all_finished', 'after_first_finish', 'time_limit', 'everyone_left');--> statement-breakpoint
CREATE TABLE "room_race_entries" (
	"race_id" uuid NOT NULL,
	"place" integer NOT NULL,
	"kart_id" text NOT NULL,
	"kart_revision" integer NOT NULL,
	"time_microseconds" integer,
	"signed_in" boolean NOT NULL,
	CONSTRAINT "room_race_entries_race_id_place_pk" PRIMARY KEY("race_id","place"),
	CONSTRAINT "room_race_entries_place" CHECK ("room_race_entries"."place" between 1 and 4),
	CONSTRAINT "room_race_entries_kart" CHECK (char_length("room_race_entries"."kart_id") between 1 and 80 and "room_race_entries"."kart_revision" > 0),
	CONSTRAINT "room_race_entries_time" CHECK ("room_race_entries"."time_microseconds" is null or "room_race_entries"."time_microseconds" between 1 and 600000000)
);
--> statement-breakpoint
CREATE TABLE "room_races" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"course_id" text NOT NULL,
	"course_revision" integer NOT NULL,
	"physics_version" text NOT NULL,
	"racing_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"end_reason" "room_race_end_reason" NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_races_room_code" CHECK ("room_races"."room_code" ~ '^[a-z2-9]{10}$'),
	CONSTRAINT "room_races_physics_version" CHECK (char_length("room_races"."physics_version") between 1 and 80),
	CONSTRAINT "room_races_duration" CHECK ("room_races"."ended_at" >= "room_races"."racing_at")
);
--> statement-breakpoint
ALTER TABLE "room_race_entries" ADD CONSTRAINT "room_race_entries_race_id_room_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."room_races"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_races" ADD CONSTRAINT "room_races_course_revision_fk" FOREIGN KEY ("course_id","course_revision") REFERENCES "public"."course_revisions"("course_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_races_ended_at_idx" ON "room_races" USING btree ("ended_at");--> statement-breakpoint
CREATE FUNCTION prevent_room_race_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'room races are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER room_races_immutable
BEFORE UPDATE OR DELETE ON "room_races"
FOR EACH ROW
EXECUTE FUNCTION prevent_room_race_mutation();--> statement-breakpoint
CREATE TRIGGER room_race_entries_immutable
BEFORE UPDATE OR DELETE ON "room_race_entries"
FOR EACH ROW
EXECUTE FUNCTION prevent_room_race_mutation();
