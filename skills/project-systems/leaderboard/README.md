# Leaderboard System

**Maturity:** Validated (PRs 5.1–5.5 and 6.0, 2026-11-03).

## Purpose And Scope

How a logged-in racer's run becomes a verified result: signed run tickets,
the server's check of the run's ghost recording, results, each racer's best
and its ghost per board, the leaderboard page with podium medals, and the
standing on the result screen. Runs are verified, not
cheat-proof: a forged recording that obeys the checks still passes.

The recording format and recorder belong to [ghosts](../ghosts/README.md),
the gate re-check mirrors [race progression](../race-progression/README.md),
and sessions and usernames belong to
[identity](../identity-course-persistence/README.md).

Its bests are raced as ghosts ([ghosts](../ghosts/README.md)). Earlier
course versions' boards stay to look at, read-only.

## Source Ownership

- `src/game/race/race-medals.ts`: gold, silver, and bronze by rank.
- `src/game/race/leaderboard.ts`: the board response contract.
- `src/game/race/run-submission.ts`: the client's ticket request and
  submission, and the response contract.
- `src/game/race/held-run.ts`: a guest's run kept on the device, sent once
  they sign in, and the note the leaderboard shows.
- `src/server/run-tickets.ts`: signing and reading tickets.
- `src/server/race-results.ts`: eligibility, which board a revision races
  on, the earlier boards, the server's check, and storing a submission with
  its best and standing.
- `src/server/leaderboard.ts`: loading a course's current board or an
  earlier one, the current board's number and racers for the publish dialog,
  a board's course best or a racer's own best as a ghost record, and a
  racer's standing (best and rank, without the recording) for a ghost link's
  preview.
- `src/server/ghost-link-preview.ts`, `src/app/page.tsx`'s
  `generateMetadata`, `src/lib/social-metadata.ts`, and
  `src/app/social-card/`: link previews. Every page shares one card (a
  graded shot from the levee), and a ghost link's page and card show the
  racer's current best, rank, and course, looked up by exact username. A
  racer not found, or a lookup that fails or takes over 2 s, gives the plain
  preview. The card's address carries the time, rank, and entries, so a
  change gets a new picture past preview caches.
- `src/app/api/runs/tickets/route.ts`, `src/app/api/runs/route.ts`,
  `src/app/api/leaderboards/[courseId]/route.ts`, and its `ghost/route.ts`.
- `src/app/leaderboard/page.tsx` and `src/components/leaderboard-view.tsx`:
  the page, linked from home's first screen and menu, and the result
  screen, with each row's Race and Copy link buttons for that racer's ghost
  ([ghosts](../ghosts/README.md)), and the Course versions list. The page's
  controller and arrow-key navigation belongs to
  [editor controller input](../editor-controller-input/README.md).
- `src/components/medal-icon.tsx`: the podium medal on rows and results.
- `src/components/run-standing.tsx`: the result screen's standing, or its
  prompt to sign in or choose a username.
- `src/db/schema.ts`, `drizzle/0021_*`, `0023_*`, and `0025_*`:
  `leaderboards` (numbered per course by a trigger), `race_results` (with
  `claimed`), `board_bests`, and `course_publications.new_leaderboard`, with
  their triggers.
- The course editor's publish dialog, which asks whether a publication keeps
  the board ([course editor](../course-editor/README.md)).
- `src/components/solo-time-trial-canvas.tsx`: a ticket request at each run
  start (mount and Race again) and the submission after the finish frame.

## Flow

1. A run start sends the course and kart IDs, their revisions, and the
   physics version to `POST /api/runs/tickets`. A racer with a username
   racing `LEADERBOARD_COURSE_IDS` in an official kart at a revision that
   was ever published, on a course revision on its current board, under the
   current physics, gets a ticket: the
   race, the racer, an ID, and the issue time, signed with HMAC-SHA256 under
   a key derived from `BETTER_AUTH_SECRET` and timed from the request.
   Issuing stores nothing, and a ticket expires after two hours. A guest, or
   a racer without a username, gets a ticket naming no racer, with the
   reason (`login` or `username`), which expires 30 minutes after the run
   starts. Any other race gets no ticket (`not-eligible`), without an error.
2. After the finish frame, the race sends the ticket and its recording to
   `POST /api/runs`. A run on a ticket naming no racer is kept on the
   device instead (the fastest such run wins), and the result asks the
   player to sign in or choose a username. Starting a racer on this browser
   counts as signing in. It is sent once their account is complete, after any sign-in or onboarding, or when they open
   `/leaderboard`, which sends it before loading the board and says what
   became of it.
3. The server reads the ticket (signature, expiry, and the same racer, or
   any signed-in racer with a username for a ticket naming none), decodes
   the recording strictly, checks it against that course revision's stored
   gates, and requires the real time since the ticket to be at least the
   race time.
   The time is the server's own.
4. The result is stored under the ticket's ID, verified or rejected with a
   reason, so each ticket counts once (409 after). A verified run replaces
   the racer's best on its board only when faster, keeping its recording. The
   response is the server's time, rank, entries, personal best, and the
   racer's username, which the result screen shows with the medal for a
   top-three rank.
5. `/leaderboard` shows the official course's current board: the board its
   newest published revision races on under the current physics, the top 50
   bests with their karts, and the viewer's own rank if they are lower. A
   quiet Course versions icon beside the page's label lists the latest
   version and every earlier board with times, newest first by the revision
   that started it, named by when its times were set. An earlier one
   (`?board=<number>`) is read-only: its podium and your rank, without
   ghosts ([ghosts](../ghosts/README.md)). A link to a board with no times
   shows the latest.

## Invariants

- A board runs from a publication that started a new leaderboard (a
  course's first always does) up to the next one, under one physics version,
  with one best per racer; a physics change always starts one.
  `leaderboards.course_revision` is the revision that started it. Each run
  is still checked against the gates of the revision it raced. Publications
  only move forward ([identity](../identity-course-persistence/README.md)).
- A run already racing when a new leaderboard starts lands on the board it
  raced; new tickets are for the current board only.
- Board numbers say which board, not their order: one first raced late can
  be numbered after a newer one. Ties rank by who set the time first, at the
  submission's full timestamp precision.
- The client never sends a time, medal, or rank.
- A result is the submitting racer's; one from a ticket naming no racer is
  `claimed`. The guest's gameplay run summary is never linked to them.
- Results are immutable; rejected results keep no recording.
- A best's recording holds at most `MAX_RUN_SAMPLES` (20,000) samples, about
  480 KB; a two-minute race is about 58 KB.
- Gold, silver, and bronze are the board's current first, second, and third
  places, worked out from rank and never stored.
- Anonymization deletes a racer's bests and keeps results under the opaque
  ID. Triggers refuse new results or bests for an anonymized racer, including
  a submission waiting on an anonymization.

## Verification

- `tests/race-results.spec.ts`: tickets, submissions, bests, the board and
  its podium, boards kept and started across publications and their
  numbers, earlier boards, a ghost link's standing and preview, and
  anonymization against Postgres.
- `tests/leaderboard.spec.ts`: the page, its podium, its empty state,
  sending a kept run, and the Course versions list.
- `tests/social-card.spec.ts`: the preview tags, including the head that
  link-preview crawlers read, and the card.
- `tests/held-run.spec.ts`: which run the device keeps, and blocked storage.
- `tests/home.spec.ts` two-lap lifecycle: a run submits its ticket and
  recording, and the result shows its standing; a guest's run is kept and
  the result asks them to sign in.

## Known Limits

- A recording does not prove which kart raced it.
- A run kept on a shared device goes to whoever signs in there next.
- A kept board's times may come from earlier revisions.
- A guest's kept run is matched by course revision, so on a kept board a run
  on the newer revision replaces a faster one kept from the older.
