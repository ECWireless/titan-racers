import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { type AddressInfo, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOM_REPORT_SIGNATURE_HEADER } from "../../src/game/room/room-signing";

export type RoomServerReport = { signature: string | null; body: string };

export async function freePort() {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * Runs the room server under `wrangler dev`, with a stub app that collects
 * the race reports it sends. No Cloudflare account is involved.
 */
export async function startRoomServer({
  origins,
  port,
  secret,
}: {
  origins: string[];
  port: number;
  secret: string;
}) {
  const reports: RoomServerReport[] = [];
  const results = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const header = request.headers[ROOM_REPORT_SIGNATURE_HEADER];
      reports.push({
        signature: typeof header === "string" ? header : null,
        body,
      });
      response.writeHead(201).end("{}");
    });
  });
  await new Promise<void>((resolve) => results.listen(0, "127.0.0.1", resolve));
  const resultsPort = (results.address() as AddressInfo).port;
  const stateDir = mkdtempSync(join(tmpdir(), "room-server-"));
  const wrangler = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--config",
      "room-server/wrangler.jsonc",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      stateDir,
      "--show-interactive-dev-session=false",
      "--var",
      `ROOM_SERVER_SECRET:${secret}`,
      "--var",
      `APP_ORIGINS:${origins.join(",")}`,
      "--var",
      `APP_RESULTS_URL:http://127.0.0.1:${resultsPort}/results`,
    ],
    {
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  let output = "";
  let exited = false;
  const wranglerExited = new Promise<void>((resolve) =>
    wrangler.once("exit", () => {
      exited = true;
      resolve();
    }),
  );
  wrangler.stdout?.on("data", (chunk) => (output += chunk));
  wrangler.stderr?.on("data", (chunk) => (output += chunk));

  async function stop() {
    // ROOM_SERVER_LOG=1 prints the room server's output, for debugging.
    if (process.env.ROOM_SERVER_LOG) console.log(output);
    try {
      if (wrangler.pid && wrangler.exitCode === null) {
        try {
          process.kill(-wrangler.pid, "SIGTERM");
        } catch {
          // Already gone.
        }
        await Promise.race([
          wranglerExited,
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]);
      }
    } finally {
      await new Promise<void>((resolve) => results.close(() => resolve()));
      rmSync(stateDir, { recursive: true, force: true });
    }
  }

  const started = Date.now();
  while (!exited && Date.now() - started < 80_000) {
    // Wrangler prints its address once this server is the one listening.
    if (output.includes(`127.0.0.1:${port}`)) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        if (response.status === 404) return { reports, stop };
      } catch {
        // Not accepting yet.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stop();
  throw new Error(`wrangler dev did not start:\n${output}`);
}
