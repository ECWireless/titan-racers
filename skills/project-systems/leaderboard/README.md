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

Its bests are raced as ghosts ([ghosts](../ghosts/README.md)). Not supported
yet: boards for earlier revisions, and a guest's login prompt and claims.

## Source Ownership

- `src/game/race/race-medals.ts`: gold, silver, and bronze by rank.
- `src/game/race/leaderboard.ts`: the board response contract.
- `src/game/race/run-submission.ts`: the client's ticket request and
  submission, and the response contract.
- `src/server/run-tickets.ts`: signing and reading tickets.
- `src/server/race-results.ts`: eligibility, the server's check, and storing
  a submission with its best and standing.
- `src/server/leaderboard.ts`: loading a course's current board, and a
  board's course best or a racer's own best as a ghost record.
- `src/app/api/runs/tickets/route.ts`, `src/app/api/runs/route.ts`,
  `src/app/api/leaderboards/[courseId]/route.ts`, and its `ghost/route.ts`.
- `src/app/leaderboard/page.tsx` and `src/components/leaderboard-view.tsx`:
  the page, linked from home's menu and the result screen.
- `src/components/run-standing.tsx`: the result screen's standing.
- `src/db/schema.ts` and `drizzle/0021_*`: `leaderboards`, `race_results`,
  and `board_bests`, with their triggers.
- `src/components/solo-time-trial-canvas.tsx`: a ticket request at each run
  start (mount and Race again) and the submission after the finish frame.

## Flow

1. A run start sends the course and kart IDs, their revisions, and the
   physics version to `POST /api/runs/tickets`. A racer with a username
   racing `LEADERBOARD_COURSE_IDS` in an official kart, each at a revision
   that was ever published, under the current physics, gets a ticket: the
   race, the racer, an ID, and the issue time, signed with HMAC-SHA256 under
   a key derived from `BETTER_AUTH_SECRET` and timed from the request.
   Issuing stores nothing, and a ticket expires after two hours. Any other
   race gets no ticket and a reason (log in, choose a username, or not
   eligible), without an error.
2. After the finish frame, the race sends the ticket and its recording to
   `POST /api/runs`.
3. The server reads the ticket (signature, expiry, same racer), decodes the
   recording strictly, checks it against that course revision's stored gates,
   and requires the real time since the ticket to be at least the race time.
   The time is the server's own.
4. The result is stored under the ticket's ID, verified or rejected with a
   reason, so each ticket counts once (409 after). A verified run replaces
   the racer's best on its board only when faster, keeping its recording. The
   response is the server's time, rank, entries, and personal best, which
   the result screen shows with the medal for a top-three rank.
5. `/leaderboard` shows the official course's current board: its newest
   published revision under the current physics, the top 50 bests with
   their karts, and the viewer's own rank if they are lower.

## Invariants

- A board is one course revision and physics version (`leaderboards`), with
  one best per racer. Ties rank by who set the time first, at the
  submission's full timestamp precision.
- The client never sends a time, medal, or rank.
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
- `tests/leaderboard.spec.ts`: the page, its podium, and its empty state.
- `tests/home.spec.ts` two-lap lifecycle: a run submits its ticket and
  recording, and the result shows its standing.

## Known Limits

- A recording does not prove which kart raced it.
- Every recovery point needs ground under it for its resets to verify
  ([race progression](../race-progression/README.md)).
- A run on an older published revision ranks on that revision's board, while
  `/leaderboard` shows only the newest.
