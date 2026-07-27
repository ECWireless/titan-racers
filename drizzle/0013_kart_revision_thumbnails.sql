CREATE TABLE "kart_revision_thumbnails" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"render_version" integer NOT NULL,
	"content_type" text NOT NULL,
	"image_data" "bytea" NOT NULL,
	"image_sha256" text NOT NULL,
	"generated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kart_revision_thumbnails_render_version_positive" CHECK ("kart_revision_thumbnails"."render_version" > 0),
	CONSTRAINT "kart_revision_thumbnails_content_type" CHECK ("kart_revision_thumbnails"."content_type" = 'image/png'),
	CONSTRAINT "kart_revision_thumbnails_image_size" CHECK (octet_length("kart_revision_thumbnails"."image_data") between 1 and 524288),
	CONSTRAINT "kart_revision_thumbnails_hash_format" CHECK ("kart_revision_thumbnails"."image_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "kart_revision_thumbnails" ADD CONSTRAINT "kart_revision_thumbnails_revision_id_kart_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."kart_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kart_revision_thumbnails" ADD CONSTRAINT "kart_revision_thumbnails_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kart_revision_thumbnails_generated_by_user_id_idx" ON "kart_revision_thumbnails" USING btree ("generated_by_user_id");--> statement-breakpoint
CREATE FUNCTION prevent_kart_revision_thumbnail_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'kart revision thumbnails are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER kart_revision_thumbnails_immutable
BEFORE UPDATE OR DELETE ON "kart_revision_thumbnails"
FOR EACH ROW
EXECUTE FUNCTION prevent_kart_revision_thumbnail_mutation();
