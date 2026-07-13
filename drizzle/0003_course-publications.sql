CREATE TABLE "course_publications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "course_publications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"course_id" text NOT NULL,
	"revision" integer NOT NULL,
	"published_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_publications_revision_positive" CHECK ("course_publications"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "course_publications" ADD CONSTRAINT "course_publications_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_publications" ADD CONSTRAINT "course_publications_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_publications" ADD CONSTRAINT "course_publications_course_revision_fk" FOREIGN KEY ("course_id","revision") REFERENCES "public"."course_revisions"("course_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_publications_course_id_id_idx" ON "course_publications" USING btree ("course_id","id");--> statement-breakpoint
CREATE INDEX "course_publications_published_by_user_id_idx" ON "course_publications" USING btree ("published_by_user_id");--> statement-breakpoint
CREATE FUNCTION prevent_course_publication_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'course publications are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER course_publications_immutable
BEFORE UPDATE OR DELETE ON "course_publications"
FOR EACH ROW
EXECUTE FUNCTION prevent_course_publication_mutation();
