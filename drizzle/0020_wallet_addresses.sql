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
CREATE UNIQUE INDEX "wallet_addresses_address_uidx" ON "wallet_addresses" USING btree ("address");