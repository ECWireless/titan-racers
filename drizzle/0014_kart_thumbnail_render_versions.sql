ALTER TABLE "kart_revision_thumbnails" DROP CONSTRAINT "kart_revision_thumbnails_pkey";--> statement-breakpoint
ALTER TABLE "kart_revision_thumbnails" ADD CONSTRAINT "kart_revision_thumbnails_revision_id_render_version_pk" PRIMARY KEY("revision_id","render_version");
