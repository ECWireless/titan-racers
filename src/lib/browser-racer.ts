// Why switching accounts can't sign this racer out, or null when it can: a
// racer with no login method could never sign back in.
export async function switchingAccountsBlocker() {
  try {
    const response = await fetch("/api/profile", {
      cache: "no-store",
      credentials: "include",
    });
    if (response.status === 401) return null;
    if (response.ok) {
      const profile = (await response.json()) as { loginMethods?: unknown };
      if (Array.isArray(profile.loginMethods) && profile.loginMethods.length > 0) {
        return null;
      }
      if (Array.isArray(profile.loginMethods)) {
        return "This account lives only in this browser, so switching accounts would lose it. From your profile, add a passkey, Google, or a wallet, or bring it into your other account.";
      }
    }
  } catch {
    // Unknown, so the racer stays signed in.
  }
  return "Your account couldn't be checked before switching. Please retry.";
}

type AnonymousStart = "failed" | "rate-limited" | "started";

export const ANONYMOUS_START_FAILURES = {
  failed: "An account couldn't be created. Please retry.",
  "rate-limited": "Too many new accounts from this network. Try again later, or sign in.",
} as const;

// Starts a racer kept in this browser. It is refused only when this browser
// is already signed in, which keeps that racer.
export async function continueAnonymously(): Promise<AnonymousStart> {
  try {
    const response = await fetch("/api/auth/sign-in/anonymous", {
      body: "{}",
      credentials: "include",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (response.status === 429) return "rate-limited";
    return response.ok || response.status === 400 ? "started" : "failed";
  } catch {
    return "failed";
  }
}
