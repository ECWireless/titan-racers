import { expect, test } from "@playwright/test";

const meta = (html: string, key: string) =>
  html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

test.describe("link previews", () => {
  test("previews home with the social card, and an unknown ghost link the same way", async ({
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Previews only need checking once.");
    for (const path of ["/", "/?ghost=no_such_racer"]) {
      const html = await (await request.get(path)).text();
      expect(meta(html, "og:title"), path).toBe("Titan Racers");
      expect(meta(html, "og:image"), path).toMatch(/\/social-card$/);
      expect(meta(html, "og:image:width"), path).toBe("1200");
      expect(meta(html, "twitter:card"), path).toBe("summary_large_image");
      expect(meta(html, "og:description"), path).toContain("Falls View Park");
    }

    // Link-preview crawlers get the tags in the page's head, not streamed.
    const crawled = await (
      await request.get("/?ghost=no_such_racer", {
        headers: { "user-agent": "Twitterbot/1.0" },
      })
    ).text();
    const head = crawled.slice(0, crawled.indexOf("</head>"));
    expect(meta(head, "og:image")).toMatch(/\/social-card$/);
    expect(meta(head, "twitter:card")).toBe("summary_large_image");

    const card = await request.get("/social-card");
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toBe("image/png");
    expect((await card.body()).byteLength).toBeGreaterThan(50_000);
    // A racer the card cannot find still gets the plain card.
    const unknown = await request.get("/social-card?racer=no_such_racer");
    expect(unknown.status()).toBe(200);
    expect(unknown.headers()["cache-control"]).toContain("max-age=300");
  });
});
