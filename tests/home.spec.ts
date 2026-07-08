import { expect, test } from "@playwright/test";

test.describe("home screen", () => {
  test("shows player-first mode selection with coming soon feedback", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByAltText("Titan Racers")).toBeVisible();
    await expect(page.getByText("Choose game mode")).toBeVisible();

    const raceFriends = page.getByRole("button", { name: "Race Friends" });
    const soloTimeTrial = page.getByRole("button", { name: "Solo Time Trial" });

    await expect(raceFriends).toBeVisible();
    await expect(soloTimeTrial).toBeVisible();

    await raceFriends.click();
    await expect(page.getByRole("status")).toHaveText("coming soon");

    await soloTimeTrial.click();
    await expect(page.getByRole("status")).toHaveText("coming soon");
  });
});
