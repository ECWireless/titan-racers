# Identity And Course Persistence System

**Maturity:** Validated (PR 2.3.2; wallet login PR 5.2; racers kept in this
browser and passkeys PR 6.2).

## Purpose And Scope

This system owns canonical application identities, linked Better Auth provider
accounts, Postgres-backed sessions and roles, Google, wallet, and passkey login,
racers kept in one browser, explicit login-method linking, sign-in rate limits, centralized server-side admin authorization, immutable course revisions, and protected
course load/save APIs.

It keeps the portable course document defined by
[`course-data`](../course-data/README.md) free of database metadata. The visible
login and authoring experience belongs to the protected
[`course-editor`](../course-editor/README.md) system. Kart revisions reuse the
same identity, role, and request-guard boundaries; see the
[kart builder](../kart-builder/README.md).

## Source Ownership

- `src/db/schema.ts` defines Better Auth tables, application roles, course heads,
  immutable revision metadata, and append-only attributed publications.
- `drizzle/` contains the reviewed version-controlled Postgres migrations,
  including database triggers for default player roles and immutable revisions.
- `src/db/client.ts` owns the shared node-postgres pool and Drizzle client.
- `src/lib/auth.ts` configures Better Auth (1.7): its Drizzle adapter, the
  Google provider with an account-selection prompt for every sign-in,
  explicit-only account linking, the SIWE, anonymous, and passkey plugins,
  session lifetime, the sign-in rate limits, and the guards that keep a racer
  kept in this browser from being replaced.
- `src/lib/siwe.ts` owns the sign-in chain (Base, 8453), the placeholder email
  domain, and offline EOA signature checks with viem.
- `src/lib/browser-wallets.ts` discovers EIP-6963 wallets and asks one for a
  signed Sign-In with Ethereum message.
- `src/components/profile-access.tsx` runs sign-in, the username step, and the
  profile's login methods, with `@simplewebauthn/browser` for passkey prompts.
- `src/server/login-methods.ts` and `src/app/api/profile/login-methods/route.ts`
  list, link, and unlink a signed-in racer's login methods;
  `src/server/session-user.ts` resolves the racer for profile routes.
- `src/server/authorization.ts` validates live sessions and database roles at
  protected server boundaries.
- `src/server/request-guards.ts` enforces strict JSON and same-origin browser
  boundaries for custom authenticated mutations.
- `src/server/course-repository.ts` validates portable documents and owns atomic
  revision creation, latest-revision and publication loading, publication
  attribution, and optimistic concurrency.
- `src/app/api/auth/[...all]/route.ts` mounts Better Auth without adding UI.
- `src/app/api/admin/courses/[courseId]/route.ts` owns admin-only course load and
  save transport.
- `src/app/api/admin/courses/[courseId]/publication/route.ts` owns admin-only
  publication status and mutation; `src/app/api/courses/[courseId]/published`
  exposes only the validated runtime document and non-personal revision timing.
- `scripts/` and `docs/database-operations.md` own migration, first-admin,
  anonymization, and guarded course seed-reset operations.

## Identity And Authorization Flow

1. Better Auth sends Google `prompt=select_account`, so every sign-in asks the
   player to choose an identity instead of silently reusing the browser's active
   Google account. Google then authenticates the selected external identity.
2. Better Auth creates or resolves a canonical `users.id` and linked `accounts`
   row; provider IDs never replace the application user ID. Google token
   material is discarded because the application does not call Google APIs.
3. A database trigger grants every new user the baseline `player` role in the
   same database transaction.
4. The credentialed bootstrap script may grant `admin` only to an existing
   Google-linked application user. There is no public promotion endpoint.
5. Protected handlers validate the signed session against Postgres, then query
   `user_roles`. Client visibility and cookie existence are never authoritative.
6. Linking is explicit only. A new provider subject cannot inherit an existing
   canonical identity or its roles by presenting the same email.

## Wallet Login And Linking

1. Signed out, the profile offers one wallet button (a chooser when several
   EIP-6963 wallets announce). The wallet signs a message naming this host,
   Base, and a single-use server nonce; Better Auth's SIWE plugin verifies it
   with viem's offline check, so smart-contract wallets never verify. Without
   a browser wallet, no wallet button shows.
2. A new wallet creates a racer with a generated ID, a placeholder email
   `<address>@wallet.invalid` that is never shown, and a `racer` username
   seed. The racer then claims a username through onboarding.
3. Each address belongs to one racer (`wallet_addresses.address` is unique); a
   racer may link several wallets and one Google account (a partial unique
   index on `accounts`).
4. The plugin's verify signs in as the wallet's racer and ignores the session,
   so linking a wallet uses our profile route, which reads the address and
   nonce from the signed message (accepting only a canonical message),
   consumes the nonce, repeats the plugin's checks, and writes the wallet row and its `siwe`
   account together. Google links through Better Auth's `/link-social`, which
   allows a different email because wallet-first racers have a placeholder.
5. Our route unlinks any method but the last, deleting a wallet's row with its
   account and replacing a placeholder email built from that wallet. Better
   Auth's `/unlink-account` is disabled because it would leave the wallet row,
   which still signs in.

## Racers Kept In This Browser

1. Signed out, "Continue on this browser" asks Better Auth's anonymous plugin
   for a racer with no login method; nothing creates one automatically. It is
   a full racer (username, leaderboard, bests, ghosts), and `users.is_anonymous`
   records that it began this way and never changes.
2. The racer is the lasting ID. Google, wallets, and passkeys link to it; the
   plugin's merge-and-delete is off (`disableDeleteAnonymousUser`, no
   `onLinkAccount`, `/delete-anonymous-user` disabled), so it is never merged
   or deleted. Starting one is refused while any racer is signed in.
3. Until it has a login method, the profile warns it can be lost, Sign out asks
   first (profile, onboarding, and home's menu), and no other sign-in may
   replace its session: a before-hook refuses Google, wallet, and passkey
   sign-in, and a session hook refuses OAuth callbacks already under way.
4. It exists only through its session cookie, so sessions last 400 days (the
   browser cap) and renew at most daily. Only Better Auth's own responses renew
   the cookie: home calls `/api/auth/get-session` on each visit, and our
   server-side session checks pass `disableRefresh` so they never extend a
   session without its cookie.

## Passkeys

1. Any signed-in racer adds a passkey from the profile; signed out, "Continue
   with a passkey" signs in. `@better-auth/passkey` binds passkeys to the
   configured `BETTER_AUTH_URL` origin and hostname (production
   `play.titanracers.com`), never the request's; passkeys are saved on the
   device (`residentKey: "required"`), and adding one needs only a live session
   (`freshAge: 0`), as linking Google or a wallet does.
2. The device shows the racer's username: the client replaces the options'
   display name, which the plugin sets to the account email. A verification
   hook strips each registration challenge to the racer's ID.
3. Each credential belongs to one racer (`passkeys.credential_id` is unique).
   A passkey is a login method: our route lists and removes it under the
   last-method rule, and the plugin's delete, list, and rename routes are off.

## Course Revision Flow

1. Every API or repository save validates the complete input through the
   existing strict course-document schema.
2. A new course begins at revision one only when the expected revision is null.
3. Existing saves atomically advance the mutable course head only when its
   revision equals the caller's expected revision.
4. The complete portable document is inserted as JSONB with schema version,
   canonical author ID, and creation time.
5. A database trigger rejects update or delete operations on revision rows.
6. Competing stale saves return a conflict and never overwrite the winning
   revision.

## Course Publication Flow

1. An admin may publish only a revision already stored for the requested course.
2. The repository locks the course row, compares the expected latest publication
   ID, and inserts one attributed publication event; competing publishers cannot
   both advance the publication head from the same base.
3. Publication rows are immutable at the database boundary. Republishing the
   already-current revision is idempotent and does not create history noise.
   Publications only move forward: a revision older than the live one is
   refused. Each records whether it started a new leaderboard
   (`new_leaderboard`; a course's first always does, and the default covers
   builds that predate it), which the [leaderboard](../leaderboard/README.md)
   reads.
4. Protected responses retain opaque attribution for audit. The unauthenticated
   runtime response omits author, publisher, and internal publication IDs.
5. Guest racing selects an explicit course ID (`falls-view-park`) and
   consumes only its newest publication. When persistence is unavailable or no
   publication exists, it falls back to that course's validated bundled seed so
   guest play remains available; it never consumes an unpublished database
   draft.

## Accepted Invariants

- Authentication proves identity; Postgres roles grant authority.
- Google sign-in always presents explicit account selection. A forbidden editor
  session is signed out before another OAuth attempt begins, so switching
  identities cannot be mistaken for account linking.
- Custom protected course mutations accept only `application/json` from the
  direct request origin or configured canonical application/auth origins, so
  reverse-proxied same-origin traffic remains valid. Foreign or missing origins,
  cross-site fetch metadata, and simple form-compatible content types are
  rejected before request parsing.
- Email is only a credentialed bootstrap lookup and never a durable admin
  allowlist.
- Guest racing and the existing product UI do not require a database session.
- Secrets and connection strings remain outside version control.
- OAuth provider token material is not retained in Postgres.
- Anonymization removes sessions, provider credentials, wallets, passkeys and
  their pending challenges, privileged roles, leaderboard bests, and profile
  PII while retaining only the opaque user ID needed for attribution.
  `db:anonymize-user` finds a racer by email, wallet, or username.
- Racers never merge. Results, bests, and authorship point to the racer ID,
  never the username, so usernames could become changeable later; today
  migration 0012's trigger keeps them fixed and ghost links name them.
- Sessions store no IP address or user agent.
- Better Auth's limiter counts only exact sign-in paths, in Postgres so every
  instance shares it (production only): 10 new browser racers per network an
  hour, 10 passkey option requests a minute, and Better Auth's defaults for
  Google, wallet, and passkey sign-in. Every other path, unknown ones
  included, writes no row. A count resets only after a full quiet window, and
  expired rows are pruned when a later counted request reuses an expired
  bucket.
- A login method never moves between racers, and the last one cannot be
  unlinked. Database triggers refuse new sessions, login methods, wallets, and
  passkeys for anonymized racers, so a sign-in or Google link racing anonymization
  cannot restore one.
- Course documents contain no revision IDs, author IDs, timestamps, or other
  database metadata.
- Revisions are append-only and fully attributed.
- Publications are append-only, fully attributed, concurrency-safe pointers to
  immutable saved revisions.
- `rough-course` is a permanent sandbox course. Resetting it appends the
  validated source-controlled seed as a new attributed revision and never
  deletes history; the official Falls View Park uses the separate stable ID
  `falls-view-park`.
- Application traffic may use a pooled Neon connection; production migrations
  require the explicit direct migration URL and never run at app startup.

## Verification

- `tests/auth-configuration.spec.ts` covers the environment-independent Google
  account-selection policy and the no-merge, no-delete anonymous plugin
  settings.
- `tests/browser-racers.spec.ts` covers starting a racer in this browser, its
  400-day cookie, refusals while signed in, sign-ins that can't replace it,
  keeping it with a wallet, and the database-backed limiter.
- `tests/passkeys.spec.ts` drives the real passkey endpoints with a software
  authenticator (the test host `127.0.0.1` is not a valid browser RP ID):
  adding, signing in, replay and cross-racer refusal, a foreign origin, the
  last-method rule, the limiter, challenge contents, and anonymization.
- `tests/wallet-login.spec.ts` covers wallet sign-in and rejection, linking,
  unlinking, Google link initiation, and anonymization by wallet with real
  signatures; `tests/profile.spec.ts` covers the wallet chooser, the
  login-method list, the browser-racer warning and sign-out confirmation, and
  the passkey buttons with stubbed device prompts.
- `tests/course-persistence.spec.ts` covers default roles, role denial and
  approval, real Better Auth sessions, protected API load/save, Google OAuth
  initiation including the generated account-selection parameter, immutable
  attribution, and competing stale saves.
- `pnpm db:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` cover migration,
  static, and production-build boundaries.
- The production migration command is rehearsed from an empty Postgres database,
  and the created tables and triggers are inspected directly.
- The full desktop/mobile Playwright matrix remains the gameplay regression gate.

## Primary References

- [Better Auth Google provider: Always ask to select an account](https://better-auth.com/docs/authentication/google#always-ask-to-select-an-account)
  defines the server-side `prompt: "select_account"` configuration used here.
- [Better Auth anonymous plugin](https://better-auth.com/docs/plugins/anonymous),
  [passkey plugin](https://better-auth.com/docs/plugins/passkey), and the
  [1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide);
  passkeys need 1.7.16 for the
  [GHSA-gv75-j3v8-3crm](https://github.com/better-auth/better-auth/security/advisories/GHSA-gv75-j3v8-3crm)
  fix. [WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/) defines RP IDs and
  user handles.
- [EIP-4361 (Sign-In with Ethereum)](https://eips.ethereum.org/EIPS/eip-4361)
  and [EIP-6963 (multi-wallet discovery)](https://eips.ethereum.org/EIPS/eip-6963)
  define the message and wallet discovery used for wallet login.

## Known Limits And Deferred Work

- Not supported: WalletConnect, smart-contract wallets, ENS, embedded wallets,
  and on-chain actions. Unlinking does not end that method's live sessions.
- Not supported: merging racers (planned as PR 6.3), passkey-first sign-up,
  passkey autofill, email or password login, and pruning abandoned browser
  racers.
- Passkeys belong to one hostname. Changing the production domain would lock
  out racers whose only method is a passkey, and passkeys made on the QA host
  work only there.
- Automated Neon preview branches and production deployment migrations are not
  configured. Production migration is currently a deliberate laptop operation.
- The early hosted preview may share the production database by explicit
  feature-lead decision; local verification remains mandatory before migration.
