"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import {
  normalizeRacerUsername,
  racerOnboardingPath,
  racerUsernameSchema,
  RACER_USERNAME_MAX_LENGTH,
  RACER_USERNAME_MIN_LENGTH,
  RACER_USERNAME_REQUIREMENTS,
  safeRacerReturnTo,
} from "@/lib/racer-username";

const racerIdentitySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("complete"),
    username: z.string(),
  }),
  z.strictObject({
    status: z.literal("incomplete"),
    suggestedUsername: z.string(),
  }),
]);
const usernameClaimResponseSchema = z.object({
  code: z.string().optional(),
  status: z.literal("complete").optional(),
  username: z.string().optional(),
});
const usernameClaimFailure =
  "Your username could not be created. Your entry is still here.";

class UsernameClaimError extends Error {}

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
  const [signInPending, setSignInPending] = useState(false);
  const normalizedUsername = normalizeRacerUsername(username);

  useControllerMenuNavigation({
    containerRef: profileRef,
    enabled: true,
    navigationMode: "spatial",
    onBack: () => router.push(returnTo),
  });

  useEffect(() => {
    let active = true;
    void loadProfile().then((nextState) => {
      if (!active) return;
      setProfileState(nextState);
      if (nextState.status === "incomplete") {
        setUsername(nextState.suggestedUsername);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function retryProfile() {
    setFeedback(null);
    setProfileState({ status: "loading" });
    const nextState = await loadProfile();
    setProfileState(nextState);
    if (nextState.status === "incomplete") {
      setUsername(nextState.suggestedUsername);
    }
  }

  async function signInWithGoogle() {
    setSignInPending(true);
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
      setSignInPending(false);
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
          "This account already has a permanent username.",
        );
      }
      const claimedUsername = payload.data.username;
      if (!response.ok || !claimedUsername) {
        throw new UsernameClaimError(usernameClaimFailure);
      }

      setUsername(claimedUsername);
      setProfileState({ status: "complete", username: claimedUsername });
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
          <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            {profileState.status === "incomplete"
              ? "Complete account creation"
              : "Racer profile"}
          </p>
          <h1 className="text-4xl font-black uppercase tracking-[-0.04em] sm:text-5xl">
            {heading}
          </h1>
          <p className="max-w-lg text-sm leading-6 text-titan-ice/70">
            Your unique username identifies your work, race results, and future
            Titan Racers profile.
          </p>
        </div>

        {profileState.status === "loading" ? (
          <p className="font-mono text-sm text-titan-ice/70" role="status">
            Loading racer account…
          </p>
        ) : profileState.status === "unauthenticated" ? (
          <div className="grid gap-5">
            <p className="text-sm leading-6 text-titan-ice/76">
              Sign in with Google, then choose the username Titan Racers will
              use publicly.
            </p>
            <button
              className="titan-button titan-button-primary"
              data-controller-default="true"
              disabled={signInPending}
              type="button"
              onClick={() => void signInWithGoogle()}
            >
              {signInPending ? "Connecting…" : "Continue with Google"}
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
              {savePending ? "Creating account…" : "Create racer account"}
            </button>
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
            <p className="text-sm leading-6 text-titan-ice/70">
              Usernames are permanent after account creation so published
              attribution stays trustworthy.
            </p>
            {mode === "onboarding" ? (
              <Link
                className="titan-button titan-button-primary"
                data-controller-default="true"
                href={returnTo}
              >
                Continue
              </Link>
            ) : null}
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
