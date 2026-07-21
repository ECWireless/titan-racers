CREATE TYPE "public"."kart_publication_action" AS ENUM('publish', 'unpublish');--> statement-breakpoint
CREATE TABLE "kart_publication_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "kart_publication_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kart_id" text NOT NULL,
	"action" "kart_publication_action" NOT NULL,
	"revision" integer,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kart_publication_events_action_revision" CHECK (("kart_publication_events"."action" = 'publish' and "kart_publication_events"."revision" is not null and "kart_publication_events"."revision" > 0) or ("kart_publication_events"."action" = 'unpublish' and "kart_publication_events"."revision" is null))
);
--> statement-breakpoint
CREATE TABLE "kart_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kart_id" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"derivation_version" integer NOT NULL,
	"document" jsonb NOT NULL,
	"resolved_snapshot" jsonb NOT NULL,
	"resolved_snapshot_hash" text NOT NULL,
	"author_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kart_revisions_revision_positive" CHECK ("kart_revisions"."revision" > 0),
	CONSTRAINT "kart_revisions_schema_version_positive" CHECK ("kart_revisions"."schema_version" > 0),
	CONSTRAINT "kart_revisions_derivation_version_positive" CHECK ("kart_revisions"."derivation_version" > 0),
	CONSTRAINT "kart_revisions_snapshot_hash_format" CHECK ("kart_revisions"."resolved_snapshot_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "karts" (
	"id" text PRIMARY KEY NOT NULL,
	"current_revision" integer NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "karts_current_revision_positive" CHECK ("karts"."current_revision" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "kart_revisions_kart_revision_uidx" ON "kart_revisions" USING btree ("kart_id","revision");--> statement-breakpoint
ALTER TABLE "kart_publication_events" ADD CONSTRAINT "kart_publication_events_kart_id_karts_id_fk" FOREIGN KEY ("kart_id") REFERENCES "public"."karts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kart_publication_events" ADD CONSTRAINT "kart_publication_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kart_publication_events" ADD CONSTRAINT "kart_publication_events_kart_revision_fk" FOREIGN KEY ("kart_id","revision") REFERENCES "public"."kart_revisions"("kart_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kart_revisions" ADD CONSTRAINT "kart_revisions_kart_id_karts_id_fk" FOREIGN KEY ("kart_id") REFERENCES "public"."karts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kart_revisions" ADD CONSTRAINT "kart_revisions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "karts" ADD CONSTRAINT "karts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "karts" ADD CONSTRAINT "karts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kart_publication_events_kart_id_id_idx" ON "kart_publication_events" USING btree ("kart_id","id");--> statement-breakpoint
CREATE INDEX "kart_publication_events_actor_user_id_idx" ON "kart_publication_events" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "kart_revisions_author_user_id_idx" ON "kart_revisions" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "karts_owner_user_id_idx" ON "karts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE FUNCTION prevent_kart_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'kart revisions are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER kart_revisions_immutable
BEFORE UPDATE OR DELETE ON "kart_revisions"
FOR EACH ROW
EXECUTE FUNCTION prevent_kart_revision_mutation();--> statement-breakpoint
CREATE FUNCTION prevent_kart_publication_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'kart publication events are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER kart_publication_events_immutable
BEFORE UPDATE OR DELETE ON "kart_publication_events"
FOR EACH ROW
EXECUTE FUNCTION prevent_kart_publication_event_mutation();
