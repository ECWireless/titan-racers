import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * A run ticket names what a leaderboard run races and who races it, signed
 * by this server when the run starts. Its ID becomes the result's, so it is
 * used once. Nothing is stored until the run is submitted.
 */
const RUN_TICKET_LIFETIME_MS = 2 * 60 * 60 * 1_000;

const runTicketSchema = z.strictObject({
  courseId: z.string().min(1).max(80),
  courseRevision: z.number().int().positive(),
  id: z.uuid(),
  issuedAt: z.number().int().positive(),
  kartId: z.string().min(1).max(80),
  kartRevision: z.number().int().positive(),
  physicsVersion: z.string().min(1).max(80),
  userId: z.string().min(1).max(200),
  version: z.literal(1),
});
export type RunTicket = z.infer<typeof runTicketSchema>;

// A key of its own, derived from the auth secret, so tickets need no new one.
function signature(payload: string) {
  const secret = process.env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  const key = createHmac("sha256", secret)
    .update("titan-racers run ticket v1")
    .digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function issueRunTicket(
  fields: Omit<RunTicket, "id" | "issuedAt" | "version">,
  now = Date.now(),
) {
  const ticket: RunTicket = {
    ...fields,
    id: randomUUID(),
    issuedAt: now,
    version: 1,
  };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

/** A ticket this server signed that has not expired, or null. */
export function readRunTicket(token: string, now = Date.now()) {
  const [payload, signed, extra] = token.split(".");
  if (!payload || !signed || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(signed);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  let parsed;
  try {
    parsed = runTicketSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  return now - parsed.data.issuedAt > RUN_TICKET_LIFETIME_MS
    ? null
    : parsed.data;
}
