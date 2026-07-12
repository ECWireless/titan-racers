CREATE FUNCTION grant_default_player_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "user_roles" ("user_id", "role")
	VALUES (NEW."id", 'player')
	ON CONFLICT DO NOTHING;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER users_grant_default_player_role
AFTER INSERT ON "users"
FOR EACH ROW
EXECUTE FUNCTION grant_default_player_role();
