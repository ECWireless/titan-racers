import { expect, type Page } from "@playwright/test";

/**
 * Walks home's steps into a solo race: Race, a kart (the one already chosen
 * unless named), the course, then Start race.
 */
export async function startSoloRace(page: Page, kartName?: string) {
  await page.getByRole("button", { exact: true, name: "Race" }).click();
  await chooseKartAndCourse(page, kartName);
  await page.getByRole("button", { name: "Start race" }).click();
  // A first race's setup can hold the page for seconds under software WebGL.
  await expect(page.getByTestId("solo-time-trial-canvas")).toBeAttached({
    timeout: 30_000,
  });
}

/** From the kart step, picks a kart and the course, reaching the mode step. */
export async function chooseKartAndCourse(page: Page, kartName?: string) {
  const karts = page
    .getByRole("group", { name: "Official kart selection" })
    .getByRole("button");
  await (
    kartName
      ? karts.filter({ hasText: kartName })
      : karts.and(page.locator('[aria-pressed="true"]'))
  ).click();
  await page
    .getByRole("group", { name: "Course selection" })
    .getByRole("button")
    .click();
}
