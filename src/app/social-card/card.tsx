import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { formatRaceTime } from "@/game/race/race-presentation";
import { type GhostLinkStanding, SOCIAL_CARD_SIZE } from "@/lib/social-metadata";

const ASSETS = join(process.cwd(), "src/app/social-card/assets");
const HAZARD = "#ffbd59";
const ICE = "#f7f2e8";
const BLACK = "#070706";

// Read once per server.
let assets: Promise<{
  background: string;
  logo: string;
  mono: Buffer;
  sans: Buffer;
}> | null = null;

function loadAssets() {
  assets ??= Promise.all([
    readFile(join(ASSETS, "background.jpg")),
    // The logo at twice the size it is drawn, not its full 1783 x 458.
    readFile(join(ASSETS, "logo.png")),
    readFile(join(ASSETS, "LiberationMono-Bold.ttf")),
    readFile(join(ASSETS, "LiberationSans-Bold.ttf")),
  ]).then(([background, logo, mono, sans]) => ({
    background: `data:image/jpeg;base64,${background.toString("base64")}`,
    logo: `data:image/png;base64,${logo.toString("base64")}`,
    mono,
    sans,
  }));
  // A failed read is tried again on the next card.
  assets.catch(() => {
    assets = null;
  });
  return assets;
}

/**
 * The picture a shared link shows: a shot of a kart off the levee kicker,
 * and for a ghost link, whose ghost it is and the time to beat.
 */
export async function drawSocialCard(
  challenge: GhostLinkStanding | null,
  headers: Record<string, string>,
) {
  const { background, logo, mono, sans } = await loadAssets();
  return new ImageResponse(
    (
      <div
        style={{
          background: BLACK,
          color: ICE,
          display: "flex",
          fontFamily: "Sans",
          height: "100%",
          position: "relative",
          width: "100%",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn by next/og */}
        <img
          alt=""
          height={SOCIAL_CARD_SIZE.height}
          src={background}
          style={{ left: 0, position: "absolute", top: 0 }}
          width={SOCIAL_CARD_SIZE.width}
        />
        <div
          style={{
            background:
              "linear-gradient(90deg, rgba(7,7,6,0.9) 0%, rgba(7,7,6,0.62) 34%, rgba(7,7,6,0) 62%)",
            display: "flex",
            height: "100%",
            left: 0,
            position: "absolute",
            top: 0,
            width: "100%",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            justifyContent: "space-between",
            padding: "56px 64px 72px",
            position: "relative",
            width: "100%",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn by next/og */}
          <img alt="Titan Racers" height={92} src={logo} width={358} />
          {challenge ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  color: "rgba(247,242,232,0.8)",
                  fontFamily: "Mono",
                  fontSize: 26,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                }}
              >
                Race the ghost of
              </div>
              {/* A username keeps its own case. */}
              <div
                style={{
                  fontSize: challenge.username.length > 14 ? 56 : 72,
                  letterSpacing: -2,
                  lineHeight: 1,
                  marginTop: 14,
                }}
              >
                {`@${challenge.username}`}
              </div>
              <div
                style={{
                  color: HAZARD,
                  fontFamily: "Mono",
                  fontSize: 104,
                  letterSpacing: -4,
                  lineHeight: 1,
                  marginTop: 18,
                }}
              >
                {formatRaceTime(challenge.timeMicroseconds, 3)}
              </div>
              <div
                style={{
                  color: "rgba(247,242,232,0.8)",
                  fontFamily: "Mono",
                  fontSize: 26,
                  letterSpacing: 3,
                  marginTop: 22,
                  textTransform: "uppercase",
                }}
              >
                {`Rank ${challenge.rank} of ${challenge.entries} · ${challenge.courseName}`}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  fontSize: 72,
                  letterSpacing: -2.5,
                  lineHeight: 0.95,
                  textTransform: "uppercase",
                }}
              >
                <span>Build the kart.</span>
                <span style={{ color: HAZARD }}>Race the habitat.</span>
              </div>
              <div
                style={{
                  color: "rgba(247,242,232,0.9)",
                  fontSize: 30,
                  letterSpacing: -0.5,
                  marginTop: 24,
                }}
              >
                RC kart racing inside humanity&apos;s last space colony
              </div>
            </div>
          )}
        </div>
        {/* Livery along the foot: hazard slashes trailing into a fading
            pinstripe, drawn as shapes so their edges stay clean. */}
        <div
          style={{
            alignItems: "center",
            bottom: 30,
            display: "flex",
            left: 64,
            position: "absolute",
            right: 0,
          }}
        >
          {[1, 0.75, 0.5, 0.3].map((opacity) => (
            <div
              key={opacity}
              style={{
                background: HAZARD,
                display: "flex",
                height: 14,
                marginRight: 7,
                opacity,
                transform: "skewX(-35deg)",
                width: 22,
              }}
            />
          ))}
          <div
            style={{
              background: `linear-gradient(90deg, ${HAZARD}b3 0%, ${HAZARD}00 70%)`,
              display: "flex",
              flexGrow: 1,
              height: 2,
              marginLeft: 10,
            }}
          />
        </div>
      </div>
    ),
    {
      ...SOCIAL_CARD_SIZE,
      fonts: [
        { data: sans, name: "Sans", style: "normal", weight: 700 },
        { data: mono, name: "Mono", style: "normal", weight: 700 },
      ],
      headers,
    },
  );
}
