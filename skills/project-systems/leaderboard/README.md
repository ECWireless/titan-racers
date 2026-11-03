# Leaderboard System

**Maturity:** Candidate (PR 5.3).

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

Its bests are raced as ghosts ([ghosts](../ghosts/README.md)). Not supported:
boards for earlier revisions.

## Source Ownership

- `src/game/race/race-medals.ts`: gold, silver, and bronze by rank.
- `src/game/race/leaderboard.ts`: the board response contract.
- `src/game/race/run-submission.ts`: the client's ticket request and
  submission, and the response contract.
- `src/game/race/held-run.ts`: a guest's run kept on the device, sent once
  they sign in, and the note the leaderboard shows.
- `src/server/run-tickets.ts`: signing and reading tickets.
- `src/server/race-results.ts`: eligibility, the server's check, and storing
  a submission with its best and standing.
- `src/server/leaderboard.ts`: loading a course's current board, and a
  board's course best or a racer's own best as a ghost record.
- `src/app/api/runs/tickets/route.ts`, `src/app/api/runs/route.ts`,
  `src/app/api/leaderboards/[courseId]/route.ts`, and its `ghost/route.ts`.
- `src/app/leaderboard/page.tsx` and `src/components/leaderboard-view.tsx`:
  the page, linked from home's menu and the result screen, with each row's
  Race and Copy link buttons for that racer's ghost
  ([ghosts](../ghosts/README.md)).
- `src/components/medal-icon.tsx`: the podium medal on rows and results.
- `src/components/run-standing.tsx`: the result screen's standing, or its
  prompt to sign in or choose a username.
- `src/components/profile-access.tsx` and `leaderboard-view.tsx`: send a
  kept run once the account is complete, and on opening the board.
- `src/db/schema.ts`, `drizzle/0021_*`, and `0023_*`: `leaderboards`,
  `race_results` (with `claimed`), and `board_bests`, with their triggers.
- `src/components/solo-time-trial-canvas.tsx`: a ticket request at each run
  start (mount and Race again) and the submission after the finish frame.

## Flow

1. A run start sends the course and kart IDs, their revisions, and the
   physics version to `POST /api/runs/tickets`. A racer with a username
   racing `LEADERBOARD_COURSE_IDS` in an official kart, each at a revision
   that was ever published, under the current physics, gets a ticket: the
   race, the racer, an ID, and the issue time, signed with HMAC-SHA256 under
   a key derived from `BETTER_AUTH_SECRET` and timed from the request.
   Issuing stores nothing, and a ticket expires after two hours. A guest, or
   a racer without a username, gets a ticket naming no racer, with the
   reason (`login` or `username`), which expires 30 minutes after the run
   starts. Any other race gets no ticket (`not-eligible`), without an error.
2. After the finish frame, the race sends the ticket and its recording to
   `POST /api/runs`. A run on a ticket naming no racer is kept on the
   device instead (the fastest such run wins), and the result asks the
   player to sign in or choose a username. It is sent once their account
   is complete, after any sign-in or onboarding, or when they open
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
   top-three rank; a new best shares a link to the racer's ghost.
5. `/leaderboard` shows the official course's current board: its newest
   published revision under the current physics, the top 50 bests with
   their karts, and the viewer's own rank if they are lower.

## Invariants

- A board is one course revision and physics version (`leaderboards`), with
  one best per racer. Ties rank by who set the time first, at the
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
  its podium, and anonymization against Postgres.
- `tests/leaderboard.spec.ts`: the page, its podium, its empty state, and
  sending a kept run.
- `tests/held-run.spec.ts`: which run the device keeps, and blocked storage.
- `tests/home.spec.ts` two-lap lifecycle: a run submits its ticket and
  recording, and the result shows its standing; a guest's run is kept and
  the result asks them to sign in.

## Known Limits

- A recording does not prove which kart raced it.
- A run kept on a shared device goes to whoever signs in there next.
- A run on an older published revision ranks on that revision's board, while
  `/leaderboard` shows only the newest.
