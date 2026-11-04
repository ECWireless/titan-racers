import { expect, type Page, test } from "@playwright/test";

import { RACER_USERNAME_REQUIREMENTS } from "../src/lib/racer-username";

const profileApiPattern = "**/api/profile";

async function installStandardGamepadFixture(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __TR_GAMEPADS__?: Gamepad[];
    };
    testWindow.__TR_GAMEPADS__ = [];
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => testWindow.__TR_GAMEPADS__ ?? [],
    });
  });
}

async function setStandardTestGamepad(
  page: Page,
  buttonValues: Record<number, number> = {},
) {
  await page.evaluate((nextButtonValues) => {
    const testWindow = window as typeof window & {
      __TR_GAMEPADS__?: Gamepad[];
    };
    testWindow.__TR_GAMEPADS__ = [
      {
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, index) => {
          const value = nextButtonValues[index] ?? 0;
          return { pressed: value > 0, touched: value > 0, value };
        }),
        connected: true,
        id: "Automated standard controller",
        index: 0,
        mapping: "standard",
        timestamp: performance.now(),
      } as unknown as Gamepad,
    ];
  }, buttonValues);
}

const PASSKEY_REGISTRATION_OPTIONS = {
  attestation: "none",
  authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  challenge: "AQID",
  excludeCredentials: [],
  pubKeyCredParams: [{ alg: -7, type: "public-key" }],
  rp: { id: "127.0.0.1", name: "Titan Racers" },
  user: { displayName: "nova@example.com", id: "AQID", name: "nova_racer" },
};

// Stands in for the device's passkey prompts; the server side is mocked too.
async function stubPasskeys(page: Page) {
  await page.addInitScript(() => {
    const bytes = (...values: number[]) => new Uint8Array(values).buffer;
    const credential = (response: Record<string, unknown>) => ({
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      id: "AQID",
      rawId: bytes(1, 2, 3),
      response,
      type: "public-key",
    });
    const testWindow = window as typeof window & {
      cancelPasskey?: boolean;
      passkeyUser?: unknown;
    };
    navigator.credentials.create = async (options) => {
      testWindow.passkeyUser = {
        displayName: options?.publicKey?.user.displayName,
        name: options?.publicKey?.user.name,
      };
      return credential({
        attestationObject: bytes(1),
        clientDataJSON: bytes(1),
        getTransports: () => ["internal"],
      }) as unknown as Credential;
    };
    navigator.credentials.get = async () => {
      if (testWindow.cancelPasskey) {
        throw new DOMException("The request was cancelled.", "NotAllowedError");
      }
      return credential({
        authenticatorData: bytes(1),
        clientDataJSON: bytes(1),
        signature: bytes(1),
        userHandle: bytes(1),
      }) as unknown as Credential;
    };
  });
}

async function fulfillIncompleteProfile(page: Page, suggestion = "elliott4821") {
  await page.route(profileApiPattern, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          loginMethods: [],
          status: "incomplete",
          suggestedUsername: suggestion,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fallback();
  });
}

test.describe("racer onboarding and profile", () => {
  test("loads an editable suggestion and claims its normalized username", async ({
    page,
  }) => {
    let savedPayload: unknown;
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      savedPayload = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({
          status: "complete",
          username: "nova_racer",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/onboarding?returnTo=%2Fadmin%2Fkarts");
    const input = page.getByRole("textbox", { name: "Username" });
    await expect(input).toHaveValue("elliott4821");

    await input.fill("  Nova---Racer  ");
    await expect(page.getByText("Public credit: @nova_racer")).toBeVisible();
    await page.getByRole("button", { name: "Create account" }).click();

    expect(savedPayload).toEqual({ username: "nova_racer" });
    await expect(page.getByText("@nova_racer", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Continue" }),
    ).toHaveAttribute("href", "/admin/karts");
  });

  test("sends a racer who already has a username straight on from onboarding", async ({
    page,
  }) => {
    await page.route(profileApiPattern, (route) =>
      route.fulfill({
        json: { loginMethods: [], status: "complete", username: "nova_racer" },
      }),
    );

    await page.goto("/onboarding?returnTo=%2Fprofile");
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByText("@nova_racer", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue" })).toHaveCount(0);
  });

  test("sends a run kept before signing in once, and lands on the board", async ({
    page,
  }) => {
    await page.addInitScript((run) => {
      // Only on the first page: the run is forgotten once sent.
      if (!sessionStorage.getItem("kept-run-seeded")) {
        sessionStorage.setItem("kept-run-seeded", "1");
        localStorage.setItem("titan-racers.held-run.v1", run);
      }
    }, JSON.stringify({
      expiresAt: Date.now() + 20 * 60 * 1_000,
      recording: "test-recording",
      ticket: "guest-ticket",
      timeMicroseconds: 92_250_000,
    }));
    await page.route(profileApiPattern, (route) =>
      route.fulfill({
        json: { loginMethods: [], status: "complete", username: "nova_racer" },
      }),
    );
    let sent = 0;
    await page.route("**/api/runs", async (route) => {
      sent += 1;
      await route.fulfill({
        json: {
          entries: 4,
          personalBest: { improved: true, timeMicroseconds: 92_250_000 },
          rank: 2,
          status: "verified",
          username: "nova_racer",
        },
      });
    });
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({
        json: {
          board: { courseName: "Falls View Park", entries: [], viewer: null },
          earlier: [],
        },
      }),
    );

    // Signing in returns through onboarding, which carries a complete racer on.
    await page.goto("/onboarding?returnTo=%2Fleaderboard");
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(
      page.getByText("Your 1:32.250 is on the leaderboard, rank 2 of 4."),
    ).toBeVisible();
    expect(sent).toBe(1);
  });

  test("shows an existing username as immutable on the profile page", async ({
    page,
  }) => {
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          loginMethods: [],
          status: "complete",
          username: "nova_racer",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/profile");
    await expect(page.getByText("@nova_racer", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /save|create/i })).toHaveCount(0);
  });

  test("lists login methods and unlinks while another remains", async ({
    page,
  }) => {
    const google = { id: "google-row", kind: "google", label: "Google" };
    const wallet = { id: "wallet-row", kind: "wallet", label: "0x1111…1111" };
    let unlinkBody: unknown;
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          loginMethods: [google, wallet],
          status: "complete",
          username: "nova_racer",
        }),
        contentType: "application/json",
      });
    });
    await page.route("**/api/profile/login-methods", async (route) => {
      expect(route.request().method()).toBe("DELETE");
      unlinkBody = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({ loginMethods: [google] }),
        contentType: "application/json",
      });
    });

    await page.goto("/profile");
    const methods = page.getByRole("region", { name: "Login methods" });
    await expect(methods.getByRole("listitem")).toHaveText([
      /Google/,
      /Wallet 0x1111…1111/,
    ]);
    await expect(
      methods.getByRole("button", { exact: true, name: "Link Google" }),
    ).toHaveCount(0);
    await methods
      .getByRole("button", { name: "Unlink Wallet 0x1111…1111" })
      .click();
    expect(unlinkBody).toEqual({ id: "wallet-row" });
    await expect(page.getByText("Wallet 0x1111…1111 unlinked.")).toBeVisible();
    await expect(methods.getByRole("listitem")).toHaveText([/Google/]);
    await expect(
      methods.getByRole("button", { name: "Unlink Google" }),
    ).toBeDisabled();
    await expect(
      methods.getByText("Add another login method before removing this one."),
    ).toBeVisible();
  });

  test("starts Google sign-in through onboarding for signed-out racers", async ({
    page,
  }) => {
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Authentication required." }),
        contentType: "application/json",
        status: 401,
      });
    });
    await page.route("**/api/auth/sign-in/social", async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        callbackURL: "/onboarding?returnTo=%2Fprofile",
        newUserCallbackURL: "/onboarding?returnTo=%2Fprofile",
        provider: "google",
      });
      await route.fulfill({
        body: JSON.stringify({
          url: "http://127.0.0.1:3873/onboarding?oauth=started",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/profile");
    await expect(
      page.getByRole("heading", { name: "Account" }),
    ).toBeVisible();
    await expect(page.getByText("Profile", { exact: true })).toHaveCount(0);
    // Without a browser wallet there is no wallet option at all.
    await expect(
      page.getByRole("button", { name: "Continue with wallet" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/oauth=started/);
  });

  test("continues anonymously, or says when this network made too many", async ({
    page,
  }) => {
    let started = false;
    let attempts = 0;
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill(
        started
          ? {
              body: JSON.stringify({
                loginMethods: [],
                status: "incomplete",
                suggestedUsername: "racer4821",
              }),
              contentType: "application/json",
            }
          : { body: "{}", contentType: "application/json", status: 401 },
      );
    });
    await page.route("**/api/auth/sign-in/anonymous", async (route) => {
      attempts += 1;
      expect(route.request().postDataJSON()).toEqual({});
      if (attempts === 1) {
        await route.fulfill({ body: "{}", contentType: "application/json", status: 429 });
        return;
      }
      started = true;
      await route.fulfill({ body: "{}", contentType: "application/json" });
    });

    await page.goto("/profile");
    const start = page.getByRole("button", { name: "Continue anonymously" });
    await start.click();
    await expect(
      page.getByText("Too many new accounts from this network. Try again later, or sign in."),
    ).toHaveRole("alert");
    await start.click();
    await expect(page.getByLabel("Username")).toHaveValue("racer4821");
    await expect(page.getByText(/lives only in this browser/)).toContainText(
      "Once you have a username, add a passkey, Google, or a wallet to keep it.",
    );
  });

  test("warns a racer kept only in this browser and confirms signing out", async ({
    page,
  }) => {
    let signOuts = 0;
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          loginMethods: [],
          status: "complete",
          username: "nova_racer",
        }),
        contentType: "application/json",
      });
    });
    await page.route("**/api/auth/sign-out", async (route) => {
      signOuts += 1;
      await route.fulfill({ body: "{}", contentType: "application/json" });
    });

    await page.goto("/profile");
    const methods = page.getByRole("region", { name: "Login methods" });
    await expect(methods).toContainText(
      "This account lives only in this browser. Clearing your browsing data, switching devices, or a year away loses it for good. Add a passkey, Google, or a wallet to keep it.",
    );
    await expect(methods.getByRole("listitem")).toHaveCount(0);
    await expect(
      methods.getByRole("button", { exact: true, name: "Link Google" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    const confirm = page.getByRole("group", { name: /Sign out and lose this account/ });
    await expect(confirm.getByRole("button", { name: "Keep racing" })).toBeFocused();
    await confirm.getByRole("button", { name: "Keep racing" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
    expect(signOuts).toBe(0);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Sign out anyway" }).click();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeFocused();
    expect(signOuts).toBe(1);
  });

  test("brings a racer kept in this browser into another after confirming", async ({
    page,
  }) => {
    let merged = false;
    let requests = 0;
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          merged
            ? {
                loginMethods: [{ id: "google-1", kind: "google", label: "Google" }],
                status: "complete",
                username: "elliott",
              }
            : { loginMethods: [], status: "complete", username: "nova_racer" },
        ),
        contentType: "application/json",
      });
    });
    await page.route("**/api/profile/merge", async (route) => {
      requests += 1;
      await route.fulfill({ status: 204 });
    });
    await page.route("**/api/auth/sign-in/social", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        errorCallbackURL: "/profile",
        provider: "google",
      });
      merged = true;
      // Google returns through onboarding, which carries on to the profile.
      await route.fulfill({
        body: JSON.stringify({
          url: "http://127.0.0.1:3873/onboarding?returnTo=%2Fprofile",
        }),
        contentType: "application/json",
      });
    });

    await page.goto("/profile");
    await page.getByRole("button", { name: "Bring @nova_racer into it" }).click();
    const confirm = page.getByRole("group", {
      name: "Bring @nova_racer into your other account?",
    });
    await expect(confirm).toHaveAccessibleDescription(/This can't be undone\.$/);
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bring @nova_racer into it" })).toBeFocused();
    expect(requests).toBe(0);

    await page.getByRole("button", { name: "Bring @nova_racer into it" }).click();
    await confirm.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page.getByText("@nova_racer is now part of @elliott.")).toHaveRole(
      "status",
    );
    expect(requests).toBe(1);
  });

  test("says nothing was brought together when the Google sign-in can't start", async ({
    page,
  }) => {
    let linked = false;
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          loginMethods: linked ? [{ id: "google-1", kind: "google", label: "Google" }] : [],
          status: "complete",
          username: "nova_racer",
        }),
        contentType: "application/json",
      });
    });
    await page.route("**/api/profile/merge", (route) => route.fulfill({ status: 204 }));
    await page.route("**/api/auth/sign-in/social", (route) =>
      route.fulfill({ body: "{}", contentType: "application/json", status: 400 }),
    );

    await page.goto("/profile");
    await page.getByRole("button", { name: "Bring @nova_racer into it" }).click();
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(
      page.getByText("Your accounts couldn't be merged. Please retry."),
    ).toHaveRole("alert");

    // Linking Google later is just linking, never a merge.
    linked = true;
    await page.goto("about:blank");
    await page.goto("/profile");
    await expect(page.getByRole("listitem")).toHaveText(/Google/);
    await expect(page.getByText("Your accounts are now one.")).toHaveCount(0);
  });

  test("offers to bring the racer into the one Google belongs to, and says when signing in must finish it", async ({
    page,
  }) => {
    let signedOut = false;
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill(
        signedOut
          ? { body: "{}", contentType: "application/json", status: 401 }
          : {
              body: JSON.stringify({
                loginMethods: [],
                status: "complete",
                username: "nova_racer",
              }),
              contentType: "application/json",
            },
      );
    });

    await page.goto("/profile?error=account_already_linked_to_different_user");
    await expect(page.getByText("That Google account is already linked to another account.")).toHaveRole(
      "alert",
    );
    await expect(
      page.getByRole("group", { name: "Bring @nova_racer into your other account?" }),
    ).toBeVisible();

    // A merge that committed before its sign-in did leaves this browser
    // signed out, with everything waiting in the other racer.
    await page.evaluate(() =>
      sessionStorage.setItem("titan-racers.merging-racer", "nova_racer"),
    );
    signedOut = true;
    await page.goto("about:blank");
    await page.goto("/profile");
    await expect(page.getByText("Sign in to your other account to finish.")).toHaveRole(
      "alert",
    );
  });

  test("adds a passkey, which keeps a racer started on this browser", async ({
    page,
  }) => {
    await stubPasskeys(page);
    let added = false;
    let optionsUrl = "";
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          loginMethods: added
            ? [{ id: "passkey-1", kind: "passkey", label: "Passkey" }]
            : [],
          status: "complete",
          username: "nova_racer",
        }),
        contentType: "application/json",
      });
    });
    await page.route("**/api/auth/passkey/generate-register-options?*", async (route) => {
      optionsUrl = route.request().url();
      await route.fulfill({ json: PASSKEY_REGISTRATION_OPTIONS });
    });
    await page.route("**/api/auth/passkey/verify-registration", async (route) => {
      added = true;
      await route.fulfill({ json: { id: "passkey-1" } });
    });

    await page.goto("/profile");
    const methods = page.getByRole("region", { name: "Login methods" });
    await expect(methods).toContainText("Add a passkey, Google, or a wallet to keep it.");
    await methods.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByText("Passkey added.")).toBeVisible();
    // The password manager files it under the racer's username, never an
    // email.
    expect(new URL(optionsUrl).searchParams.get("name")).toBe("nova_racer");
    expect(
      await page.evaluate(() => (window as typeof window & { passkeyUser?: unknown }).passkeyUser),
    ).toEqual({ displayName: "nova_racer", name: "nova_racer" });
    await expect(methods.getByRole("listitem")).toHaveText([/Passkey/]);
    await expect(methods).not.toContainText("lives only in this browser");
  });

  test("signs in with a passkey, and says when it's rate-limited or cancelled", async ({
    page,
  }) => {
    await stubPasskeys(page);
    let signedIn = false;
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill(
        signedIn
          ? {
              body: JSON.stringify({ loginMethods: [], status: "complete", username: "nova_racer" }),
              contentType: "application/json",
            }
          : { body: "{}", contentType: "application/json", status: 401 },
      );
    });
    let optionRequests = 0;
    await page.route("**/api/auth/passkey/generate-authenticate-options", (route) => {
      optionRequests += 1;
      return optionRequests === 1
        ? route.fulfill({ json: {}, status: 429 })
        : route.fulfill({ json: { challenge: "AQID", rpId: "127.0.0.1", userVerification: "preferred" } });
    });
    await page.route("**/api/auth/passkey/verify-authentication", async (route) => {
      signedIn = true;
      await route.fulfill({ json: {} });
    });

    await page.goto("/profile");
    await page.evaluate(() => {
      (window as typeof window & { cancelPasskey?: boolean }).cancelPasskey = true;
    });
    const passkey = page.getByRole("button", { name: "Continue with a passkey" });
    await passkey.click();
    await expect(
      page.getByText("Too many passkey requests from this network. Try again in a minute."),
    ).toBeVisible();
    await passkey.click();
    await expect(page.getByText("The passkey request was cancelled.")).toBeVisible();
    expect(signedIn).toBe(false);

    await page.evaluate(() => {
      (window as typeof window & { cancelPasskey?: boolean }).cancelPasskey = false;
    });
    await passkey.click();
    await expect(page.getByText("@nova_racer", { exact: true })).toBeVisible();
  });

  test("signs in with a chosen browser wallet", async ({ page }) => {
    const walletAddress = "0x1111111111111111111111111111111111111111";
    await page.addInitScript((address) => {
      const provider = {
        request: async ({ method }: { method: string }) =>
          method === "eth_requestAccounts" ? [address] : "0xabc123",
      };
      window.addEventListener("eip6963:requestProvider", () => {
        for (const name of ["Test Wallet", "Other Wallet"]) {
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", {
              detail: Object.freeze({
                info: {
                  icon: "data:image/svg+xml,<svg/>",
                  name,
                  rdns: `${name}.test`,
                  uuid: name,
                },
                provider,
              }),
            }),
          );
        }
      });
    }, walletAddress);
    let verifyBody: { message?: string } | undefined;
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill(
        verifyBody
          ? {
              body: JSON.stringify({
                loginMethods: [],
                status: "incomplete",
                suggestedUsername: "racer4821",
              }),
              contentType: "application/json",
              status: 200,
            }
          : { body: "{}", contentType: "application/json", status: 401 },
      );
    });
    await page.route("**/api/auth/siwe/nonce", async (route) => {
      expect(route.request().postDataJSON()).toEqual({});
      await route.fulfill({
        body: JSON.stringify({ nonce: "abcdefgh12345678" }),
        contentType: "application/json",
      });
    });
    await page.route("**/api/auth/siwe/verify", async (route) => {
      verifyBody = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({ success: true }),
        contentType: "application/json",
      });
    });

    await page.goto("/profile");
    await page.getByRole("button", { name: "Continue with wallet" }).click();
    const testWallet = page
      .getByRole("group", { name: "Choose a wallet" })
      .getByRole("button", { name: "Test Wallet" });
    await expect(testWallet).toBeFocused();
    await testWallet.click();
    await expect(page.getByLabel("Username")).toHaveValue("racer4821");
    expect(verifyBody).toEqual({
      message: expect.any(String),
      signature: "0xabc123",
    });
    expect(verifyBody?.message).toContain(
      `${new URL(page.url()).host} wants you to sign in with your Ethereum account:\n${walletAddress}`,
    );
    expect(verifyBody?.message).toContain("Nonce: abcdefgh12345678");
  });

  test("rejects invalid usernames before sending a claim", async ({ page }) => {
    let claimRequests = 0;
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      claimRequests += 1;
      await route.fulfill({ status: 500 });
    });

    await page.goto("/onboarding");
    await page.getByRole("textbox", { name: "Username" }).fill("ab");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      RACER_USERNAME_REQUIREMENTS,
    );
    expect(claimRequests).toBe(0);
  });

  test("keeps the entered username when the claim is already taken", async ({
    page,
  }) => {
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          code: "USERNAME_TAKEN",
          error: "That username is already taken.",
        }),
        contentType: "application/json",
        status: 409,
      });
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "Username" });
    await input.fill("wanted_name");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(input).toHaveValue("wanted_name");
    await expect(page.locator("p[role='alert']")).toHaveText(
      "That username is already taken.",
    );
  });

  test("uses stable copy for malformed claim responses", async ({ page }) => {
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        body: "<html>upstream failure</html>",
        contentType: "text/html",
        status: 500,
      });
    });

    await page.goto("/onboarding");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.locator("p[role='alert']")).toHaveText(
      "Your username could not be created. Your entry is still here.",
    );
  });

  test("locks the username snapshot while account creation is pending", async ({
    page,
  }) => {
    let releaseClaim: (() => void) | undefined;
    const claimReleased = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      await claimReleased;
      await route.fulfill({
        body: JSON.stringify({
          status: "complete",
          username: "locked_snapshot",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "Username" });
    await input.fill("  Locked Snapshot  ");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(input).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Creating account…" }),
    ).toBeDisabled();
    releaseClaim?.();
    await expect(page.getByText("@locked_snapshot")).toBeVisible();
  });

  test("supports controller create and back navigation", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Controller desktop fixture.",
    );
    await installStandardGamepadFixture(page);
    await fulfillIncompleteProfile(page, "controller_racer");
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          status: "complete",
          username: "controller_racer",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/onboarding");
    const profile = page.locator('[data-controller-menu-ready="true"]');
    const create = page.getByRole("button", { name: "Create account" });
    await expect(profile).toHaveCount(1);

    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { 13: 1 });
    await expect(create).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { 0: 1 });
    await expect(page.getByText("@controller_racer")).toBeVisible();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { 1: 1 });
    await expect(page).toHaveURL(/\/$/);
  });

  test("rejects unsafe onboarding return paths", async ({ page }) => {
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          loginMethods: [],
          status: "complete",
          username: "safe_racer",
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    for (const returnTo of [
      "https://evil.example",
      "/\\evil.example",
      "/\t/evil.example",
    ]) {
      // A returning racer is sent on at once, so only to this site's home.
      await page.goto(`/onboarding?returnTo=${encodeURIComponent(returnTo)}`);
      await expect(page).toHaveURL(
        new URL("/", test.info().project.use.baseURL).href,
      );
    }
  });

  test("fits the onboarding panel within the viewport", async ({ page }) => {
    await fulfillIncompleteProfile(page, "responsive_racer");

    await page.goto("/onboarding");
    await expect(page.getByRole("textbox", { name: "Username" })).toBeVisible();
    const metrics = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }));
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    await expect(page.locator("main")).toHaveCSS(
      "min-height",
      `${metrics.viewportHeight}px`,
    );
  });
});
