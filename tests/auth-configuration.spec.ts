import { expect, test } from "@playwright/test";

import { auth } from "../src/lib/auth";

test("requires explicit Google account selection", () => {
  expect(auth.options.socialProviders?.google).toMatchObject({
    prompt: "select_account",
  });
});
