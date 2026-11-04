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

import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import { sendHeldRun } from "@/game/race/held-run";
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
type WalletPurpose = "link" | "sign-in";
const usernameClaimResponseSchema = z.object({
  code: z.string().optional(),
  status: z.literal("complete").optional(),
  username: z.string().optional(),
});
const usernameClaimFailure =
  "Your username could not be created. Your entry is still here.";
const BROWSER_ONLY_WARNING =
  "This racer lives only in this browser. Clearing your browsing data, switching devices, or a year away loses it for good.";

const noSubscription = () => () => {};

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
    return "This device already has a passkey for your racer.";
  }
  return fallback;
}

class UsernameClaimError extends Error {}

function walletFailureMessage(purpose: WalletPurpose, status?: number) {
  if (status === 401) {
    return "Your wallet's signature could not be verified. Please retry. Smart-contract wallets aren't supported.";
  }
  if (status === 409) return "That wallet belongs to another racer.";
  return purpose === "sign-in"
    ? "Wallet sign-in could not be completed. Please retry."
    : "The wallet could not be linked. Please retry.";
}

function loginMethodName(method: LoginMethod) {
  if (method.kind === "google") return "Google";
  if (method.kind === "wallet") return `Wallet ${method.label}`;
  return method.label.startsWith("Passkey")
    ? method.label
    : `Passkey · ${method.label}`;
}

// Better Auth returns to the profile with ?error= when Google linking fails.
function googleLinkErrorMessage() {
  const code = new URLSearchParams(window.location.search).get("error");
  if (!code) return null;
  window.history.replaceState(null, "", "/profile");
  return code === "account_already_linked_to_different_user"
    ? "That Google account belongs to another racer."
    : "Google could not be linked. Please retry.";
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

// A racer with no login method can't sign back in, so signing out asks first.
function SignOutConfirmation({
  onCancel,
  onConfirm,
}: {
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
        Sign out and lose this racer? It lives only in this browser, so
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
        message: "Your racer identity could not be loaded.",
        status: "error",
      };
    }
    return racerIdentitySchema.parse(await response.json());
  } catch {
    return {
      message: "Your racer identity response was unavailable or invalid.",
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
      if (!active || carryOn(nextState)) return;
      setProfileState(nextState);
      const linkError = mode === "profile" ? googleLinkErrorMessage() : null;
      if (linkError) setFeedback({ kind: "error", message: linkError });
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

  async function signInWithGoogle() {
    setSignInPending("google");
    setFeedback(null);
    const destination = racerOnboardingPath(
      mode === "profile" ? "/profile" : returnTo,
    );
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        body: JSON.stringify({
          callbackURL: destination,
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
      window.location.assign(payload.url);
    } catch {
      setFeedback({
        kind: "error",
        message: "Google sign-in could not be started. Please retry.",
      });
      setSignInPending(null);
    }
  }

  async function signInOnThisBrowser() {
    setSignInPending("browser");
    setFeedback(null);
    try {
      const response = await fetch("/api/auth/sign-in/anonymous", {
        body: "{}",
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.status === 429) {
        setFeedback({
          kind: "error",
          message:
            "Too many new racers from this network. Try again later, or continue with Google or a wallet.",
        });
        return;
      }
      // Refused when this browser is already signed in: show that racer.
      if (!response.ok && response.status !== 400) {
        throw new Error("Browser sign-in failed.");
      }
      await retryProfile();
    } catch {
      setFeedback({
        kind: "error",
        message: "A racer could not be started on this browser. Please retry.",
      });
    } finally {
      setSignInPending(null);
    }
  }

  async function signInWithPasskey() {
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
            "That passkey couldn't sign you in. It may have been removed from your racer.",
        });
        return;
      }
      if (!verified.ok) throw new Error("Passkey sign-in failed.");
      await retryProfile();
    } catch (error) {
      setFeedback({
        kind: "error",
        message: passkeyFailureMessage(
          error,
          "Passkey sign-in could not be completed. Please retry.",
        ),
      });
    } finally {
      setSignInPending(null);
    }
  }

  async function addPasskey(racerUsername: string) {
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
    setWalletChoice(null);
    setSignInPending(wallet.id);
    setFeedback(null);
    try {
      const signed = await signWalletMessage(
        wallet,
        purpose === "sign-in"
          ? "Sign in to Titan Racers."
          : "Link this wallet to your Titan Racers racer.",
      );
      const response = await fetch(
        purpose === "sign-in"
          ? "/api/auth/siwe/verify"
          : "/api/profile/login-methods",
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
      setSignInPending(null);
    }
  }

  async function linkGoogle() {
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
      setFeedback({ kind: "success", message: "Racer account complete." });
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
      ? "Racer ID"
      : profileState.status === "incomplete"
        ? "Claim your username"
        : "Racer account";

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
                : "Racer profile"}
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
            Loading racer account…
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
            <div className="grid gap-2">
              <button
                aria-describedby="this-browser-note"
                className="titan-button titan-button-secondary"
                disabled={signInPending !== null}
                type="button"
                onClick={() => void signInOnThisBrowser()}
              >
                {signInPending === "browser"
                  ? "Starting…"
                  : "Continue on this browser"}
              </button>
              <p
                className="text-xs leading-5 text-titan-muted"
                id="this-browser-note"
              >
                No Google or wallet needed. Your racer stays in this browser
                until you add a passkey, Google, or a wallet.
              </p>
            </div>
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
              {savePending ? "Creating account…" : "Create racer account"}
            </button>
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
                >
                  Login methods
                </h2>
                {onlyThisBrowser ? (
                  <p className="border border-titan-hazard/45 bg-titan-hazard/[0.06] px-4 py-3 text-sm leading-6 text-titan-ice">
                    {BROWSER_ONLY_WARNING} Add a passkey, Google, or a wallet
                    to keep it.
                  </p>
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
                {walletChoice === "link" ? (
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
