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
        return "This racer lives only in this browser, so switching accounts would lose it. Add a passkey, Google, or a wallet from your profile first.";
      }
    }
  } catch {
    // Unknown, so the racer stays signed in.
  }
  return "Your account couldn't be checked before switching. Please retry.";
}
