import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { roomRaceEntries, roomRaces, users } from "@/db/schema";
import { FALLS_VIEW_PARK_COURSE_ID } from "@/game/course/course-ids";
import {
  ACCEPTED_PHYSICS_VERSIONS,
  CURRENT_PHYSICS_VERSION,
} from "@/game/physics/physics-version";
import { RACE_LAP_COUNT } from "@/game/race/race-course";
import {
  ROOM_PROTOCOL,
  ROOM_RACE_LIMIT_MS,
  type RoomRaceReport,
} from "@/game/room/room-protocol";
import {
  randomRoomPlayerKey,
  roomPlayerKey,
  signRoomToken,
} from "@/game/room/room-signing";
import {
  loadLatestCoursePublication,
  wasCourseRevisionPublished,
} from "@/server/course-repository";
import { wasKartRevisionPublished } from "@/server/kart-repository";
import { loadOfficialKartRoster } from "@/server/official-kart-roster";

/**
 * The app's side of private rooms: it signs who may join which room, and
 * stores each finished race the room server reports. Rooms race official
 * karts on Falls View Park; nothing here touches leaderboards.
 */

export class RoomsUnavailableError extends Error {}

export function roomServerSecret() {
  const secret = process.env.ROOM_SERVER_SECRET?.trim() ?? "";
  if (secret.length < 32) throw new RoomsUnavailableError();
  return secret;
}

async function usernameOf(userId: string) {
  const [user] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.username ?? null;
}

/** A join token for one room: a guest's when `userId` is null. */
export async function issueRoomToken(roomCode: string, userId: string | null) {
  const secret = roomServerSecret();
  const [publication, roster, username] = await Promise.all([
    loadLatestCoursePublication(FALLS_VIEW_PARK_COURSE_ID),
    loadOfficialKartRoster(),
    userId ? usernameOf(userId) : null,
  ]).catch(() => {
    // The error itself can name database hosts, so it stays out of logs.
    console.error("Room token lookups failed.");
    throw new RoomsUnavailableError();
  });
  // A bundled roster means the database is out, so no result could be kept.
  if (
    !publication ||
    roster.source !== "published" ||
    roster.karts.length === 0
  ) {
    throw new RoomsUnavailableError();
  }
  return signRoomToken(secret, {
    protocol: ROOM_PROTOCOL,
    room: roomCode,
    courseId: publication.courseId,
    courseRevision: publication.revision,
    // Each checkpoint and the finish line, every lap.
    gateCount: RACE_LAP_COUNT * (publication.document.checkpoints.length + 1),
    physicsVersion: CURRENT_PHYSICS_VERSION,
    karts: roster.karts.map(({ runtime }) => ({
      id: runtime.kartId,
      revision: runtime.revision,
    })),
    player: {
      key: userId
        ? await roomPlayerKey(secret, roomCode, userId)
        : randomRoomPlayerKey(),
      username,
      signedIn: userId !== null,
    },
  });
}

/** Why a report can never be stored; retrying won't change it. */
async function reportProblem(report: RoomRaceReport) {
  if (
    !(ACCEPTED_PHYSICS_VERSIONS as readonly string[]).includes(
      report.physicsVersion,
    )
  ) {
    return "Unknown physics version.";
  }
  if (
    report.endedAt < report.racingAt ||
    // The room's cap, with time for its alarm to run late.
    report.endedAt - report.racingAt > ROOM_RACE_LIMIT_MS + 5 * 60_000
  ) {
    return "Impossible race times.";
  }
  if (report.entries.some(({ place }, index) => place !== index + 1)) {
    return "Places must run from 1.";
  }
  const timed = report.entries.flatMap(({ timeMicroseconds }) =>
    timeMicroseconds === null ? [] : [timeMicroseconds],
  );
  if (
    report.entries
      .slice(0, timed.length)
      .some(({ timeMicroseconds }) => timeMicroseconds === null) ||
    timed.some((time, index) => index > 0 && time < timed[index - 1])
  ) {
    return "Finishers must place first, fastest first.";
  }
  const { courseId, courseRevision } = report;
  if (!(await wasCourseRevisionPublished(courseId, courseRevision))) {
    return "Course revision was never published.";
  }
  for (const { kartId, kartRevision } of report.entries) {
    if (!(await wasKartRevisionPublished(kartId, kartRevision))) {
      return "Kart revision was never published.";
    }
  }
  return null;
}

/** Stores a reported race once; a repeat of the same race changes nothing. */
export async function recordRoomRace(report: RoomRaceReport) {
  const problem = await reportProblem(report);
  if (problem) return { status: "invalid", problem } as const;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(roomRaces)
      .values({
        id: report.raceId,
        roomCode: report.roomCode,
        courseId: report.courseId,
        courseRevision: report.courseRevision,
        physicsVersion: report.physicsVersion,
        racingAt: new Date(report.racingAt),
        endedAt: new Date(report.endedAt),
        endReason: report.endReason,
      })
      .onConflictDoNothing({ target: roomRaces.id })
      .returning({ id: roomRaces.id });
    if (inserted.length === 0) return { status: "duplicate" } as const;
    await tx.insert(roomRaceEntries).values(
      report.entries.map((entry) => ({ raceId: report.raceId, ...entry })),
    );
    return { status: "stored" } as const;
  });
}
