CREATE TABLE "wallet_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_addresses_user_id_idx" ON "wallet_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_addresses_address_uidx" ON "wallet_addresses" USING btree ("address");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_one_google_per_user_uidx" ON "accounts" USING btree ("user_id") WHERE "accounts"."provider_id" = 'google';--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_anonymized_racer_sign_in()
RETURNS trigger AS $$
DECLARE
  racer_anonymized_at timestamp with time zone;
BEGIN
  -- Waits for an anonymization in progress, which locks the user row first.
  SELECT anonymized_at INTO racer_anonymized_at
  FROM users WHERE id = NEW.user_id FOR SHARE;
  IF racer_anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'anonymized racer accounts cannot sign in or gain login methods';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER accounts_not_anonymized
BEFORE INSERT ON "accounts"
FOR EACH ROW
EXECUTE FUNCTION prevent_anonymized_racer_sign_in();--> statement-breakpoint
CREATE TRIGGER sessions_not_anonymized
BEFORE INSERT ON "sessions"
FOR EACH ROW
EXECUTE FUNCTION prevent_anonymized_racer_sign_in();--> statement-breakpoint
CREATE TRIGGER wallet_addresses_not_anonymized
BEFORE INSERT ON "wallet_addresses"
FOR EACH ROW
EXECUTE FUNCTION prevent_anonymized_racer_sign_in();
