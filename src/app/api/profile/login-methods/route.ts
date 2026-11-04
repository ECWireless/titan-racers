import { z } from "zod";

import { protectedJsonMutationError } from "@/server/request-guards";
import {
  LastLoginMethodError,
  linkWallet,
  listLoginMethods,
  LoginMethodNotFoundError,
  unlinkLoginMethod,
  WalletLinkedElsewhereError,
  WalletNotVerifiedError,
} from "@/server/login-methods";
import { sessionUserIdOrResponse } from "@/server/session-user";

const linkWalletSchema = z.strictObject({
  message: z.string().min(1).max(2_000),
  signature: z.string().min(1).max(1_000),
});
const unlinkSchema = z.strictObject({ id: z.string().min(1).max(200) });

function errorResponse(status: number, code: string, error: string) {
  return Response.json({ code, error }, { status });
}

async function parseBody<T>(request: Request, schema: z.ZodType<T>) {
  try {
    return schema.parse(await request.json());
  } catch {
    return null;
  }
}

// Links a wallet to the signed-in racer.
export async function POST(request: Request) {
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  const userId = await sessionUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const body = await parseBody(request, linkWalletSchema);
  if (!body) return errorResponse(400, "INVALID_REQUEST", "Invalid request.");
  try {
    await linkWallet(userId, body);
  } catch (error) {
    if (error instanceof WalletNotVerifiedError) {
      return errorResponse(
        401,
        "WALLET_NOT_VERIFIED",
        "The wallet signature could not be verified.",
      );
    }
    if (error instanceof WalletLinkedElsewhereError) {
      return errorResponse(
        409,
        "WALLET_LINKED_ELSEWHERE",
        "That wallet belongs to another account.",
      );
    }
    throw error;
  }
  return Response.json({ loginMethods: await listLoginMethods(userId) });
}

// Unlinks one of the signed-in racer's login methods, never the last.
export async function DELETE(request: Request) {
  const mutationError = protectedJsonMutationError(request);
  if (mutationError) return mutationError;
  const userId = await sessionUserIdOrResponse(request);
  if (userId instanceof Response) return userId;

  const body = await parseBody(request, unlinkSchema);
  if (!body) return errorResponse(400, "INVALID_REQUEST", "Invalid request.");
  try {
    await unlinkLoginMethod(userId, body.id);
  } catch (error) {
    if (error instanceof LoginMethodNotFoundError) {
      return errorResponse(404, "NOT_FOUND", "That login method was not found.");
    }
    if (error instanceof LastLoginMethodError) {
      return errorResponse(
        409,
        "LAST_LOGIN_METHOD",
        "Your last login method cannot be removed.",
      );
    }
    throw error;
  }
  return Response.json({ loginMethods: await listLoginMethods(userId) });
}
