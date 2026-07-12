import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  sessions,
  userRoles,
  users,
  verifications,
} from "@/db/schema";

export class UserNotFoundError extends Error {
  constructor() {
    super("No application user exists for that email.");
    this.name = "UserNotFoundError";
  }
}

export async function anonymizeUserByEmail(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();

  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (!user) {
      throw new UserNotFoundError();
    }

    await transaction.delete(sessions).where(eq(sessions.userId, user.id));
    await transaction.delete(accounts).where(eq(accounts.userId, user.id));
    await transaction
      .delete(verifications)
      .where(sql`lower(${verifications.identifier}) = ${email}`);
    await transaction
      .delete(userRoles)
      .where(and(eq(userRoles.userId, user.id), ne(userRoles.role, "player")));
    await transaction
      .update(users)
      .set({
        anonymizedAt: new Date(),
        email: `${user.id}@deleted.invalid`,
        emailVerified: false,
        image: null,
        name: "Deleted racer",
      })
      .where(eq(users.id, user.id));

    return { userId: user.id };
  });
}
