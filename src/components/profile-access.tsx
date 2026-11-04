"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { z } from "zod";

import { OrDivider } from "@/components/or-divider";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import { sendHeldRun } from "@/game/race/held-run";
import {
  ANONYMOUS_START_FAILURES,
  continueAnonymously,
} from "@/lib/browser-racer";
import {
  type BrowserWallet,
  signWalletMessage,
  useBrowserWallets,
  WalletRequestCancelledError,
} from "@/lib/browser-wallets";
import {
  normalizeRacerUsername,
  racerOnboardingPath,
  racerUsernameSchema,
  RACER_USERNAME_MAX_LENGTH,
  RACER_USERNAME_MIN_LENGTH,
  RACER_USERNAME_REQUIREMENTS,
  safeRacerReturnTo,
} from "@/lib/racer-username";

const loginMethodsSchema = z.array(
  z.strictObject({
    id: z.string(),
    kind: z.enum(["google", "passkey", "wallet"]),
    label: z.string(),
  }),
);
type LoginMethod = z.infer<typeof loginMethodsSchema>[number];
const racerIdentitySchema = z.discriminatedUnion("status", [
  z.strictObject({
    loginMethods: loginMethodsSchema,
    status: z.literal("complete"),
    username: z.string(),
  }),
  z.strictObject({
    loginMethods: loginMethodsSchema,
    status: z.literal("incomplete"),
    suggestedUsername: z.string(),
  }),
]);
const loginMethodsResponseSchema = z.object({
  loginMethods: loginMethodsSchema,
});
type WalletPurpose = "link" | "merge" | "sign-in";
const usernameClaimResponseSchema = z.object({
  code: z.string().optional(),
  status: z.literal("complete").optional(),
  username: z.string().optional(),
});
const usernameClaimFailure =
  "Your username could not be created. Your entry is still here.";
const BROWSER_ONLY_WARNING =
  "This account lives only in this browser. Clearing your browsing data, switching devices, or a year away loses it for good.";

const noSubscription = () => () => {};

// The username of the racer this browser is bringing into another, kept
// across the Google sign-in that finishes it; passkeys and wallets finish
// on the page.
const MERGING_KEY = "titan-racers.merging-racer";
const MERGE_FAILED = "Your accounts couldn't be merged. Please retry.";

function readMergingRacer() {
  try {
    return sessionStorage.getItem(MERGING_KEY);
  } catch {
    return null;
  }
}

function writeMergingRacer(username: string | null) {
  try {
    if (username) sessionStorage.setItem(MERGING_KEY, username);
    else sessionStorage.removeItem(MERGING_KEY);
  } catch {
    // Without storage the merge still happens; only the notice is lost.
  }
}

// A merge sign-in this tab started and didn't finish leaves no request
// behind for a later sign-in here to use. A new request waits for it, so a
// slow cancel never removes a retry's.
let mergeCancelled: Promise<void> = Promise.resolve();

function cancelMergeRequest() {
  mergeCancelled = fetch("/api/profile/merge", {
    body: "{}",
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "DELETE",
  }).then(
    () => {},
    () => {},
  );
}

// What a sign-in meant to bring this browser's racer into another did.
function mergeOutcome(state: ProfileState, broughtIn: string) {
  if (state.status === "loading" || state.status === "error") return null;
  if (state.status === "unauthenticated") {
    return {
      kind: "error" as const,
      message: "Sign in to your other account to finish.",
    };
  }
  // Still the racer kept only here, so nothing was brought together.
  if (state.loginMethods.length === 0) {
    return { kind: "error" as const, message: MERGE_FAILED };
  }
  return {
    kind: "success" as const,
    message:
      state.status === "complete" && state.username !== broughtIn
        ? `@${broughtIn} is now part of @${state.username}.`
        : "Your accounts are now one.",
  };
}

const ALREADY_KEPT =
  "This account already has a login method, so it can't be brought into another.";

class PasskeyRateLimitError extends Error {}

// What went wrong in a passkey request, in the racer's terms.
function passkeyFailureMessage(error: unknown, fallback: string) {
  if (error instanceof PasskeyRateLimitError) {
    return "Too many passkey requests from this network. Try again in a minute.";
  }
  if (error instanceof Error && error.name === "NotAllowedError") {
    return "The passkey request was cancelled.";
  }
  if (error instanceof Error && error.name === "InvalidStateError") {
    return "This device already has a passkey for your account.";
  }
  return fallback;
}

class UsernameClaimError extends Error {}

function walletFailureMessage(purpose: WalletPurpose, status?: number) {
  if (status === 401) {
    return "Your wallet's signature could not be verified. Please retry. Smart-contract wallets aren't supported.";
  }
  if (status === 409) return "That wallet belongs to another account.";
  if (purpose === "merge") return MERGE_FAILED;
  return purpose === "sign-in"
    ? "Wallet sign-in could not be completed. Please retry."
    : "The wallet could not be linked. Please retry.";
}

function loginMethodName(method: LoginMethod) {
  if (method.kind === "google") return "Google";
  if (method.kind === "wallet") return `Wallet ${method.label}`;
  return method.label;
}

// Better Auth returns to the profile with ?error= when Google linking, or a
// Google sign-in bringing this racer into another, fails.
function googleErrorCode() {
  const code = new URLSearchParams(window.location.search).get("error");
  if (code) window.history.replaceState(null, "", "/profile");
  return code;
}

function googleLinkErrorMessage(code: string) {
  if (code === "account_already_linked_to_different_user") {
    return "That Google account is already linked to another account.";
  }
  // A Google sign-in meant to bring this racer in, refused.
  if (code === "RACER_MERGE_FAILED" || code === "SIGN_OUT_FIRST") return MERGE_FAILED;
  return "Google could not be linked. Please retry.";
}

function WalletChooser({
  onCancel,
  onChoose,
  wallets,
}: {
  onCancel: () => void;
  onChoose: (wallet: BrowserWallet) => void;
  wallets: BrowserWallet[];
}) {
  const firstWalletRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => firstWalletRef.current?.focus(), []);
  return (
    <div
      aria-label="Choose a wallet"
      className="grid gap-3 border border-titan-ice/20 p-4"
      role="group"
    >
      <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-titan-ice/72">
        Choose a wallet
      </p>
      {wallets.map((wallet, index) => (
        <button
          className="titan-button titan-button-secondary"
          key={wallet.id}
          ref={index === 0 ? firstWalletRef : undefined}
          type="button"
          onClick={() => onChoose(wallet)}
        >
          {wallet.name}
        </button>
      ))}
      <button
        className="titan-button titan-button-secondary"
        type="button"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

// Bringing this browser's racer into another can't be undone, so it says
// what happens first, then the player signs in to the other racer there.
function MergeConfirmation({
  onCancel,
  onChoose,
  passkeys,
  pending,
  username,
  walletChooser,
  wallets,
}: {
  onCancel: () => void;
  onChoose: (method: "google" | "passkey" | "wallet") => void;
  passkeys: boolean;
  pending: string | null;
  username: string;
  walletChooser: React.ReactNode;
  wallets: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const choosingWallet = Boolean(walletChooser);
  // Cancel is the safe default: on opening, after choosing no wallet, and
  // once a sign-in that didn't finish here lets go.
  const idle = pending === null;
  useEffect(() => {
    if (!choosingWallet && idle) cancelRef.current?.focus();
  }, [choosingWallet, idle]);
  const walletPending =
    pending !== null && !["google", "passkey"].includes(pending);
  return (
    <div
      aria-describedby="merge-details"
      aria-labelledby="merge-heading"
      className="grid gap-4 border border-titan-hazard/45 p-4"
      role="group"
    >
      <p className="font-bold text-titan-ice" id="merge-heading">
        Bring @{username} into your other account?
      </p>
      <p className="text-sm leading-6 text-titan-ice/76" id="merge-details">
        Sign in to your other account to finish. @{username}&apos;s best times
        and ghosts move to it, and the faster time counts. This can&apos;t be
        undone.
      </p>
      {walletChooser ?? (
        <div className="grid gap-3">
          <button
            className="titan-button titan-button-primary"
            disabled={pending !== null}
            type="button"
            onClick={() => onChoose("google")}
          >
            {pending === "google" ? "Connecting…" : "Continue with Google"}
          </button>
          {wallets ? (
            <button
              className="titan-button titan-button-secondary"
              disabled={pending !== null}
              type="button"
              onClick={() => onChoose("wallet")}
            >
              {walletPending ? "Check your wallet…" : "Continue with wallet"}
            </button>
          ) : null}
          {passkeys ? (
            <button
              className="titan-button titan-button-secondary"
              disabled={pending !== null}
              type="button"
              onClick={() => onChoose("passkey")}
            >
              {pending === "passkey" ? "Check your device…" : "Continue with a passkey"}
            </button>
          ) : null}
          <button
            className="titan-button titan-button-secondary"
            disabled={pending !== null}
            ref={cancelRef}
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// A racer with no login method can't sign back in, so signing out asks first.
function SignOutConfirmation({
  disabled,
  onCancel,
  onConfirm,
}: {
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <div
      aria-labelledby="sign-out-warning"
      className="grid gap-4 border border-red-300/45 p-4"
      role="group"
    >
      <p className="text-sm leading-6 text-titan-ice" id="sign-out-warning">
        Sign out and lose this account? It lives only in this browser, so
        there&apos;s no way back in.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="titan-button titan-button-primary"
          ref={keepRef}
          type="button"
          onClick={onCancel}
        >
          Keep racing
        </button>
        <button
          className="titan-button titan-button-secondary"
          disabled={disabled}
          type="button"
          onClick={onConfirm}
        >
          Sign out anyway
        </button>
      </div>
    </div>
  );
}

type ProfileState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "unauthenticated" }
  | z.infer<typeof racerIdentitySchema>;

async function loadProfile(): Promise<ProfileState> {
  try {
    const response = await fetch("/api/profile", {
      cache: "no-store",
      credentials: "include",
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (!response.ok) {
      return {
        message: "Your account couldn't be loaded.",
        status: "error",
      };
    }
    return racerIdentitySchema.parse(await response.json());
  } catch {
    return {
      message: "Your account couldn't be loaded.",
      status: "error",
    };
  }
}

export function ProfileAccess({
  mode,
  returnTo: requestedReturnTo,
}: {
  mode: "onboarding" | "profile";
  returnTo?: string;
}) {
  const profileRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const returnTo = safeRacerReturnTo(
    mode === "onboarding" ? requestedReturnTo : "/",
  );
  const [profileState, setProfileState] = useState<ProfileState>({
    status: "loading",
  });
  const [username, setUsername] = useState("");
  const [feedback, setFeedback] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [signInPending, setSignInPending] = useState<string | null>(null);
  const wallets = useBrowserWallets();
  // Known only in the browser, so the server renders without passkeys.
  const passkeysSupported = useSyncExternalStore(
    noSubscription,
    browserSupportsWebAuthn,
    () => false,
  );
  const [walletChoice, setWalletChoice] = useState<WalletPurpose | null>(
    null,
  );
  const [unlinkPending, setUnlinkPending] = useState<string | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const methodChangePending = signInPending !== null || unlinkPending !== null;
  const walletPending =
    signInPending !== null &&
    !["browser", "google", "passkey"].includes(signInPending);
  const signedIn =
    profileState.status === "complete" || profileState.status === "incomplete";
  // Kept only by this browser's cookie until the racer adds a login method.
  const onlyThisBrowser = signedIn && profileState.loginMethods.length === 0;
  const normalizedUsername = normalizeRacerUsername(username);

  useControllerMenuNavigation({
    containerRef: profileRef,
    enabled: true,
    navigationMode: "spatial",
    onBack: () => router.push(returnTo),
  });

  // A returning racer signing in has nothing to set up, so carry on. A run
  // held from before signing in is sent on the way; the leaderboard shares
  // the same request.
  const carryOn = useCallback(
    (nextState: ProfileState) => {
      if (mode !== "onboarding" || nextState.status !== "complete") {
        return false;
      }
      void sendHeldRun();
      router.replace(returnTo);
      return true;
    },
    [mode, returnTo, router],
  );

  // However the racer signed in, a complete account takes its held run.
  useEffect(() => {
    if (profileState.status === "complete") void sendHeldRun();
  }, [profileState.status]);

  useEffect(() => {
    let active = true;
    void loadProfile().then((nextState) => {
      if (!active) return;
      const errorCode = mode === "profile" ? googleErrorCode() : null;
      // Onboarding passes a finished Google merge on to the profile, which
      // says what it did.
      const broughtIn = mode === "profile" ? readMergingRacer() : null;
      if (broughtIn) writeMergingRacer(null);
      // Only this tab's own Google attempt is withdrawn; another tab's may
      // still be under way.
      if (
        broughtIn &&
        nextState.status === "complete" &&
        nextState.loginMethods.length === 0
      ) {
        cancelMergeRequest();
      }
      let merged = broughtIn ? mergeOutcome(nextState, broughtIn) : null;
      // An error from Google's return means no merge, even if this racer
      // gained a login method meanwhile. Without one, a racer still kept
      // only here left Google's page some other way, so nothing was tried.
      if (errorCode && merged?.kind === "success") {
        merged = { kind: "error", message: MERGE_FAILED };
      } else if (!errorCode && merged?.message === MERGE_FAILED) {
        merged = null;
      }
      if (carryOn(nextState)) return;
      setProfileState(nextState);
      if (merged) {
        setFeedback(merged);
      } else if (errorCode) {
        setFeedback({ kind: "error", message: googleLinkErrorMessage(errorCode) });
        // A racer kept only here can be brought into the one that has it.
        setConfirmingMerge(
          errorCode === "account_already_linked_to_different_user" &&
            nextState.status === "complete" &&
            nextState.loginMethods.length === 0,
        );
      }
      if (nextState.status === "incomplete") {
        setUsername(nextState.suggestedUsername);
      }
    });
    return () => {
      active = false;
    };
  }, [carryOn, mode]);

  async function retryProfile() {
    setFeedback(null);
    setProfileState({ status: "loading" });
    const nextState = await loadProfile();
    if (carryOn(nextState)) return;
    setProfileState(nextState);
    if (nextState.status === "incomplete") {
      setUsername(nextState.suggestedUsername);
    }
  }

  // A passkey or wallet merge finishes on the page.
  async function finishMerge(broughtIn: string) {
    const nextState = await loadProfile();
    setProfileState(nextState);
    const merged = mergeOutcome(nextState, broughtIn);
    setFeedback(merged);
    if (merged?.kind === "success") {
      setConfirmingMerge(false);
      // The confirmation that held focus is gone.
      requestAnimationFrame(() =>
        document.getElementById("login-methods-heading")?.focus(),
      );
    }
  }

  // Back from Google's page without finishing, nothing is under way.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      if (readMergingRacer()) cancelMergeRequest();
      writeMergingRacer(null);
      setSignInPending(null);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  async function signInWithGoogle({ broughtIn }: { broughtIn?: string } = {}) {
    setSignInPending("google");
    setFeedback(null);
    const destination = racerOnboardingPath(
      mode === "profile" ? "/profile" : returnTo,
    );
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        body: JSON.stringify({
          callbackURL: destination,
          // A refused merge comes back here to say so.
          ...(broughtIn ? { errorCallbackURL: "/profile" } : {}),
          newUserCallbackURL: destination,
          provider: "google",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Google sign-in could not be started.");
      const payload = z
        .object({ url: z.string().url() })
        .parse(await response.json());
      writeMergingRacer(broughtIn ?? null);
      window.location.assign(payload.url);
    } catch {
      writeMergingRacer(null);
      if (broughtIn) cancelMergeRequest();
      setFeedback({
        kind: "error",
        message: broughtIn
          ? MERGE_FAILED
          : "Google sign-in could not be started. Please retry.",
      });
      setSignInPending(null);
    }
  }

  async function signInAnonymously() {
    setSignInPending("browser");
    setFeedback(null);
    const started = await continueAnonymously();
    if (started === "started") await retryProfile();
    else setFeedback({ kind: "error", message: ANONYMOUS_START_FAILURES[started] });
    setSignInPending(null);
  }

  // Asks to bring this browser's racer into the racer it signs in to next,
  // then starts that sign-in.
  async function startMerge(method: "google" | "passkey" | "wallet") {
    if (profileState.status !== "complete" || signInPending !== null) return;
    const broughtIn = profileState.username;
    setSignInPending(method);
    setFeedback(null);
    await mergeCancelled;
    try {
      const response = await fetch("/api/profile/merge", {
        body: "{}",
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.status === 409) {
        setConfirmingMerge(false);
        await retryProfile();
        setFeedback({ kind: "error", message: ALREADY_KEPT });
        setSignInPending(null);
        return;
      }
      if (!response.ok) throw new Error("The merge could not be requested.");
    } catch {
      setFeedback({ kind: "error", message: MERGE_FAILED });
      setSignInPending(null);
      return;
    }
    if (method === "google") {
      void signInWithGoogle({ broughtIn });
    } else if (method === "passkey") {
      void signInWithPasskey({ broughtIn });
    } else {
      setSignInPending(null);
      chooseWallet("merge");
    }
  }

  async function signInWithPasskey({ broughtIn }: { broughtIn?: string } = {}) {
    setSignInPending("passkey");
    setFeedback(null);
    try {
      const options = await fetch("/api/auth/passkey/generate-authenticate-options", {
        cache: "no-store",
        credentials: "include",
      });
      if (options.status === 429) throw new PasskeyRateLimitError();
      if (!options.ok) throw new Error("Passkey options were unavailable.");
      const response = await startAuthentication({
        optionsJSON: await options.json(),
      });
      const verified = await fetch("/api/auth/passkey/verify-authentication", {
        body: JSON.stringify({ response }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (verified.status === 429) throw new PasskeyRateLimitError();
      if (verified.status === 401) {
        setFeedback({
          kind: "error",
          message:
            "That passkey couldn't sign you in. It may have been removed from your account.",
        });
        return;
      }
      if (!verified.ok) throw new Error("Passkey sign-in failed.");
      if (broughtIn) await finishMerge(broughtIn);
      else await retryProfile();
    } catch (error) {
      setFeedback({
        kind: "error",
        message: passkeyFailureMessage(
          error,
          broughtIn
            ? MERGE_FAILED
            : "Passkey sign-in could not be completed. Please retry.",
        ),
      });
    } finally {
      // Once merged this session asked nothing, so only an unfinished
      // request goes.
      if (broughtIn) cancelMergeRequest();
      setSignInPending(null);
    }
  }

  async function addPasskey(racerUsername: string) {
    writeMergingRacer(null);
    setSignInPending("passkey");
    setFeedback(null);
    try {
      const options = await fetch(
        `/api/auth/passkey/generate-register-options?name=${encodeURIComponent(racerUsername)}`,
        { cache: "no-store", credentials: "include" },
      );
      if (options.status === 429) throw new PasskeyRateLimitError();
      if (!options.ok) throw new Error("Passkey options were unavailable.");
      const optionsJSON = await options.json();
      // The password manager shows the racer's username, never an email.
      const response = await startRegistration({
        optionsJSON: {
          ...optionsJSON,
          user: { ...optionsJSON.user, displayName: racerUsername },
        },
      });
      const verified = await fetch("/api/auth/passkey/verify-registration", {
        body: JSON.stringify({ response }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!verified.ok) throw new Error("Passkey registration failed.");
      const nextState = await loadProfile();
      if (nextState.status !== "complete") {
        setProfileState(nextState);
        return;
      }
      applyLoginMethods(nextState.loginMethods);
      setFeedback({ kind: "success", message: "Passkey added." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message: passkeyFailureMessage(
          error,
          "The passkey could not be added. Please retry.",
        ),
      });
    } finally {
      setSignInPending(null);
    }
  }

  function applyLoginMethods(loginMethods: LoginMethod[]) {
    setProfileState((current) =>
      current.status === "complete" || current.status === "incomplete"
        ? { ...current, loginMethods }
        : current,
    );
  }

  function chooseWallet(purpose: WalletPurpose) {
    if (wallets.length === 1) void runWalletAction(purpose, wallets[0]);
    else setWalletChoice(purpose);
  }

  function cancelWalletChoice(purpose: WalletPurpose) {
    setWalletChoice(null);
    requestAnimationFrame(() =>
      document.getElementById(`wallet-${purpose}-trigger`)?.focus(),
    );
  }

  async function runWalletAction(purpose: WalletPurpose, wallet: BrowserWallet) {
    const broughtIn =
      purpose === "merge" && profileState.status === "complete"
        ? profileState.username
        : null;
    setWalletChoice(null);
    setSignInPending(wallet.id);
    setFeedback(null);
    try {
      const signed = await signWalletMessage(
        wallet,
        purpose === "link"
          ? "Link this wallet to your Titan Racers account."
          : "Sign in to Titan Racers.",
      );
      const response = await fetch(
        purpose === "link"
          ? "/api/profile/login-methods"
          : "/api/auth/siwe/verify",
        {
          body: JSON.stringify({
            message: signed.message,
            signature: signed.signature,
          }),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (!response.ok) {
        setFeedback({
          kind: "error",
          message: walletFailureMessage(purpose, response.status),
        });
        // A racer kept only here can be brought into the one that has it.
        if (purpose === "link" && response.status === 409 && onlyThisBrowser) {
          setConfirmingMerge(true);
        }
        return;
      }
      if (broughtIn) {
        await finishMerge(broughtIn);
        return;
      }
      if (purpose === "sign-in") {
        await retryProfile();
        return;
      }
      applyLoginMethods(
        loginMethodsResponseSchema.parse(await response.json()).loginMethods,
      );
      setFeedback({ kind: "success", message: "Wallet linked." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof WalletRequestCancelledError
            ? "The wallet request was cancelled."
            : walletFailureMessage(purpose),
      });
    } finally {
      if (broughtIn) cancelMergeRequest();
      setSignInPending(null);
    }
  }

  async function linkGoogle() {
    writeMergingRacer(null);
    setSignInPending("google");
    setFeedback(null);
    try {
      const response = await fetch("/api/auth/link-social", {
        body: JSON.stringify({
          callbackURL: "/profile",
          errorCallbackURL: "/profile",
          provider: "google",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Google linking could not start.");
      const payload = z
        .object({ url: z.string().url() })
        .parse(await response.json());
      window.location.assign(payload.url);
    } catch {
      setFeedback({
        kind: "error",
        message: "Google linking could not be started. Please retry.",
      });
      setSignInPending(null);
    }
  }

  async function unlinkLoginMethod(method: LoginMethod) {
    setUnlinkPending(method.id);
    setFeedback(null);
    try {
      const response = await fetch("/api/profile/login-methods", {
        body: JSON.stringify({ id: method.id }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      if (response.status === 409) {
        setFeedback({
          kind: "error",
          message: "Your last login method can't be removed.",
        });
        return;
      }
      if (!response.ok) throw new Error("Unlink failed.");
      applyLoginMethods(
        loginMethodsResponseSchema.parse(await response.json()).loginMethods,
      );
      setFeedback({
        kind: "success",
        message: `${loginMethodName(method)} unlinked.`,
      });
    } catch {
      setFeedback({
        kind: "error",
        message: "That login method could not be unlinked. Please retry.",
      });
    } finally {
      setUnlinkPending(null);
    }
  }

  async function signOut() {
    setFeedback(null);
    try {
      const response = await fetch("/api/auth/sign-out", {
        body: JSON.stringify({}),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Sign-out failed.");
      setConfirmingSignOut(false);
      setUsername("");
      setProfileState({ status: "unauthenticated" });
      // The sign-out control is gone, so focus the first way back in.
      requestAnimationFrame(() =>
        profileRef.current
          ?.querySelector<HTMLElement>("[data-controller-default='true']")
          ?.focus(),
      );
    } catch {
      setFeedback({
        kind: "error",
        message: "You could not be signed out. Please retry.",
      });
    }
  }

  async function claimUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savePending) return;
    setFeedback(null);

    const parsedUsername = racerUsernameSchema.safeParse(username);
    if (!parsedUsername.success) {
      setFeedback({
        kind: "error",
        message:
          parsedUsername.error.issues[0]?.message ??
          RACER_USERNAME_REQUIREMENTS,
      });
      return;
    }

    setSavePending(true);
    try {
      const response = await fetch("/api/profile", {
        body: JSON.stringify({ username: parsedUsername.data }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      const payload = usernameClaimResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (!payload.success) {
        throw new UsernameClaimError(usernameClaimFailure);
      }
      if (payload.data.code === "USERNAME_TAKEN") {
        throw new UsernameClaimError("That username is already taken.");
      }
      if (payload.data.code === "USERNAME_ALREADY_CLAIMED") {
        throw new UsernameClaimError(
          "This account already has a username.",
        );
      }
      const claimedUsername = payload.data.username;
      if (!response.ok || !claimedUsername) {
        throw new UsernameClaimError(usernameClaimFailure);
      }

      setUsername(claimedUsername);
      setProfileState((current) => ({
        loginMethods:
          current.status === "incomplete" ? current.loginMethods : [],
        status: "complete",
        username: claimedUsername,
      }));
      setFeedback({ kind: "success", message: "Account created." });
    } catch (error) {
      setFeedback({
        kind: "error",
        message:
          error instanceof UsernameClaimError
            ? error.message
            : usernameClaimFailure,
      });
    } finally {
      setSavePending(false);
    }
  }

  const signOutControl = confirmingSignOut ? (
    <SignOutConfirmation
      disabled={savePending}
      onCancel={() => {
        setConfirmingSignOut(false);
        requestAnimationFrame(() =>
          document.getElementById("sign-out-trigger")?.focus(),
        );
      }}
      onConfirm={() => void signOut()}
    />
  ) : (
    <button
      className="titan-button titan-button-secondary"
      disabled={savePending}
      id="sign-out-trigger"
      type="button"
      onClick={() =>
        onlyThisBrowser ? setConfirmingSignOut(true) : void signOut()
      }
    >
      Sign out
    </button>
  );

  const heading =
    profileState.status === "complete"
      ? "Your account"
      : profileState.status === "incomplete"
        ? "Claim your username"
        : "Account";

  return (
    <main
      ref={profileRef}
      className="relative grid min-h-screen place-items-center overflow-hidden bg-titan-black px-5 py-10 text-titan-ice"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgb(52_64_74/0.42),transparent_46%),linear-gradient(145deg,rgb(7_7_6),rgb(20_18_15))]" />
      <section className="relative grid w-full max-w-xl gap-7 border border-titan-ice/20 bg-titan-black/88 p-6 shadow-[0_28px_100px_rgb(0_0_0/0.62)] sm:p-9">
        <header className="flex flex-wrap items-center justify-between gap-5">
          <Link
            aria-label="Back to racing"
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-titan-hazard"
            href={returnTo}
          >
            <Image
              src="/titan-racers-logo.png"
              alt="Titan Racers"
              width={300}
              height={60}
              priority
              className="h-10 w-auto sm:h-12"
            />
          </Link>
          <Link
            className="titan-button titan-button-secondary"
            href={returnTo}
          >
            Back
          </Link>
        </header>

        <div className="grid gap-3">
          {signedIn ? (
            <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
              {profileState.status === "incomplete"
                ? "Complete account creation"
                : "Profile"}
            </p>
          ) : null}
          <h1 className="text-4xl font-black uppercase tracking-[-0.04em] sm:text-5xl">
            {heading}
          </h1>
          {signedIn ? (
            <p className="max-w-lg text-sm leading-6 text-titan-ice/70">
              Your unique username identifies your work, race results, and
              future Titan Racers profile.
            </p>
          ) : null}
        </div>

        {profileState.status === "loading" ? (
          <p className="font-mono text-sm text-titan-ice/70" role="status">
            Loading your account…
          </p>
        ) : profileState.status === "unauthenticated" ? (
          <div className="grid gap-5">
            <button
              className="titan-button titan-button-primary"
              data-controller-default="true"
              disabled={signInPending !== null}
              type="button"
              onClick={() => void signInWithGoogle()}
            >
              {signInPending === "google" ? "Connecting…" : "Continue with Google"}
            </button>
            {walletChoice === "sign-in" ? (
              <WalletChooser
                wallets={wallets}
                onCancel={() => cancelWalletChoice("sign-in")}
                onChoose={(wallet) => void runWalletAction("sign-in", wallet)}
              />
            ) : wallets.length > 0 ? (
              <button
                className="titan-button titan-button-secondary"
                disabled={signInPending !== null}
                id="wallet-sign-in-trigger"
                type="button"
                onClick={() => chooseWallet("sign-in")}
              >
                {walletPending ? "Check your wallet…" : "Continue with wallet"}
              </button>
            ) : null}
            {passkeysSupported ? (
              <button
                className="titan-button titan-button-secondary"
                disabled={signInPending !== null}
                type="button"
                onClick={() => void signInWithPasskey()}
              >
                {signInPending === "passkey"
                  ? "Check your device…"
                  : "Continue with a passkey"}
              </button>
            ) : null}
            <OrDivider />
            <button
              className="titan-button titan-button-secondary"
              disabled={signInPending !== null}
              type="button"
              onClick={() => void signInAnonymously()}
            >
              {signInPending === "browser" ? "Starting…" : "Continue anonymously"}
            </button>
          </div>
        ) : profileState.status === "error" ? (
          <div className="grid gap-5">
            <p className="text-sm leading-6 text-titan-ice/76" role="alert">
              {profileState.message}
            </p>
            <button
              className="titan-button titan-button-primary"
              data-controller-default="true"
              type="button"
              onClick={() => void retryProfile()}
            >
              Retry
            </button>
          </div>
        ) : profileState.status === "incomplete" ? (
          <form
            className="grid gap-5"
            onSubmit={(event) => void claimUsername(event)}
          >
            <label className="grid gap-2" htmlFor="racer-username">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-titan-ice/72">
                Username
              </span>
              <span className="flex border border-titan-ice/24 bg-titan-black text-lg font-bold text-titan-ice transition focus-within:border-titan-hazard focus-within:ring-1 focus-within:ring-titan-hazard">
                <span
                  aria-hidden="true"
                  className="grid place-items-center border-r border-titan-ice/15 px-3 text-titan-hazard"
                >
                  @
                </span>
                <input
                  aria-describedby="racer-username-guidance"
                  autoCapitalize="none"
                  autoComplete="username"
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 font-bold outline-none placeholder:text-titan-muted"
                  data-controller-default="true"
                  disabled={savePending}
                  id="racer-username"
                  name="username"
                  spellCheck={false}
                  tabIndex={0}
                  type="text"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setFeedback(null);
                  }}
                />
              </span>
              <span
                className="grid gap-1 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-titan-muted"
                id="racer-username-guidance"
              >
                <span>
                  {RACER_USERNAME_MIN_LENGTH}–{RACER_USERNAME_MAX_LENGTH} letters,
                  numbers, or internal underscores
                </span>
                <span className="text-titan-ice/72">
                  Public credit: @{normalizedUsername || "username"}
                </span>
              </span>
            </label>
            <button
              className="titan-button titan-button-primary"
              disabled={savePending}
              type="submit"
            >
              {savePending ? "Creating account…" : "Create account"}
            </button>
            {onlyThisBrowser ? (
              <p className="border border-titan-hazard/45 bg-titan-hazard/[0.06] px-4 py-3 text-sm leading-6 text-titan-ice">
                {BROWSER_ONLY_WARNING} Once you have a username, add a
                passkey, Google, or a wallet to keep it.
              </p>
            ) : null}
            {signOutControl}
          </form>
        ) : (
          <div className="grid gap-5">
            <div className="border border-titan-hazard/45 bg-titan-hazard/[0.06] px-5 py-6">
              <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-titan-muted">
                Public username
              </p>
              <p className="mt-2 break-all text-3xl font-black text-titan-hazard">
                @{profileState.username}
              </p>
            </div>
            {mode === "profile" ? (
              <section
                aria-labelledby="login-methods-heading"
                className="grid gap-3"
              >
                <h2
                  className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-titan-muted"
                  id="login-methods-heading"
                  tabIndex={-1}
                >
                  Login methods
                </h2>
                {onlyThisBrowser ? (
                  <div className="grid gap-3 border border-titan-hazard/45 bg-titan-hazard/[0.06] px-4 py-3 text-sm leading-6 text-titan-ice">
                    <p>
                      {BROWSER_ONLY_WARNING} Add a passkey, Google, or a
                      wallet to keep it.
                    </p>
                    {confirmingMerge ? null : (
                      <p>
                        Already have an account?{" "}
                        <button
                          className="inline-flex min-h-11 items-center font-bold text-titan-hazard underline underline-offset-4 disabled:text-titan-muted"
                          disabled={methodChangePending}
                          id="merge-trigger"
                          type="button"
                          onClick={() => {
                            setFeedback(null);
                            setConfirmingMerge(true);
                          }}
                        >
                          Bring @{profileState.username} into it
                        </button>
                      </p>
                    )}
                  </div>
                ) : (
                  <ul className="grid gap-2">
                    {profileState.loginMethods.map((method) => (
                      <li
                        className="flex items-center justify-between gap-3 border border-titan-ice/15 px-4 py-2"
                        key={method.id}
                      >
                        <span className="font-bold">
                          {loginMethodName(method)}
                        </span>
                        <button
                          aria-describedby={
                            profileState.loginMethods.length === 1
                              ? "last-login-method-note"
                              : undefined
                          }
                          aria-label={`Unlink ${loginMethodName(method)}`}
                          className="font-mono text-xs font-bold uppercase tracking-[0.12em] text-titan-hazard underline-offset-4 hover:underline disabled:text-titan-muted disabled:no-underline"
                          disabled={
                            profileState.loginMethods.length <= 1 ||
                            methodChangePending
                          }
                          type="button"
                          onClick={() => void unlinkLoginMethod(method)}
                        >
                          {unlinkPending === method.id ? "Unlinking…" : "Unlink"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {profileState.loginMethods.length === 1 ? (
                  <p
                    className="text-xs leading-5 text-titan-muted"
                    id="last-login-method-note"
                  >
                    Add another login method before removing this one.
                  </p>
                ) : null}
                {confirmingMerge && onlyThisBrowser ? (
                  <MergeConfirmation
                    passkeys={passkeysSupported}
                    pending={signInPending}
                    username={profileState.username}
                    walletChooser={
                      walletChoice === "merge" ? (
                        <WalletChooser
                          wallets={wallets}
                          onCancel={() => {
                            cancelMergeRequest();
                            setWalletChoice(null);
                          }}
                          onChoose={(wallet) => void runWalletAction("merge", wallet)}
                        />
                      ) : null
                    }
                    wallets={wallets.length > 0}
                    onCancel={() => {
                      cancelMergeRequest();
                      setConfirmingMerge(false);
                      requestAnimationFrame(() =>
                        document.getElementById("merge-trigger")?.focus(),
                      );
                    }}
                    onChoose={(method) => void startMerge(method)}
                  />
                ) : walletChoice === "link" ? (
                  <WalletChooser
                    wallets={wallets}
                    onCancel={() => cancelWalletChoice("link")}
                    onChoose={(wallet) => void runWalletAction("link", wallet)}
                  />
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {passkeysSupported ? (
                      <button
                        className="titan-button titan-button-secondary"
                        disabled={methodChangePending}
                        type="button"
                        onClick={() => void addPasskey(profileState.username)}
                      >
                        {signInPending === "passkey"
                          ? "Check your device…"
                          : "Add a passkey"}
                      </button>
                    ) : null}
                    {profileState.loginMethods.some(
                      (method) => method.kind === "google",
                    ) ? null : (
                      <button
                        className="titan-button titan-button-secondary"
                        disabled={methodChangePending}
                        type="button"
                        onClick={() => void linkGoogle()}
                      >
                        {signInPending === "google"
                          ? "Connecting…"
                          : "Link Google"}
                      </button>
                    )}
                    {wallets.length > 0 ? (
                      <button
                        className="titan-button titan-button-secondary"
                        disabled={methodChangePending}
                        id="wallet-link-trigger"
                        type="button"
                        onClick={() => chooseWallet("link")}
                      >
                        {walletPending ? "Check your wallet…" : "Link wallet"}
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}
            {mode === "onboarding" && onlyThisBrowser ? (
              <p className="border border-titan-hazard/45 bg-titan-hazard/[0.06] px-4 py-3 text-sm leading-6 text-titan-ice">
                {BROWSER_ONLY_WARNING} Add a passkey, Google, or a wallet from
                your profile to keep it.
              </p>
            ) : null}
            {mode === "onboarding" ? (
              <Link
                className="titan-button titan-button-primary"
                data-controller-default="true"
                href={returnTo}
              >
                Continue
              </Link>
            ) : null}
            {signOutControl}
          </div>
        )}

        <p
          className={
            feedback
              ? feedback.kind === "error"
                ? "font-mono text-xs font-bold uppercase tracking-[0.12em] text-red-300"
                : "font-mono text-xs font-bold uppercase tracking-[0.12em] text-titan-hazard"
              : "sr-only"
          }
          role={feedback?.kind === "error" ? "alert" : "status"}
        >
          {feedback?.message ?? ""}
        </p>
      </section>
    </main>
  );
}
