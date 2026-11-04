-- Only adds, so the build before it keeps working once this runs.
CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkeys_user_id_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_id_uidx" ON "passkeys" USING btree ("credential_id");--> statement-breakpoint
-- An anonymized racer can't gain a passkey, like any other login method.
CREATE TRIGGER passkeys_not_anonymized
BEFORE INSERT ON "passkeys"
FOR EACH ROW
EXECUTE FUNCTION prevent_anonymized_racer_sign_in();
