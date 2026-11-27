import { expect, test } from "@playwright/test";

import { withoutRoomCode } from "../src/components/site-analytics";

test("page views of a room leave out its code", () => {
  expect(
    withoutRoomCode({
      type: "pageview",
      url: "https://play.titanracers.com/room/ab2cd?join=code",
    }).url,
  ).toBe("https://play.titanracers.com/room/[code]");
  const home = { type: "pageview" as const, url: "https://play.titanracers.com/?racer=ada" };
  expect(withoutRoomCode(home)).toBe(home);
});
