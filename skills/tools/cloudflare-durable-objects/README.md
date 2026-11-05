# Cloudflare Durable Objects

**Maturity:** Candidate (PR 6.4, 2026-11-05).

## Purpose And Scope

Maps the [multiplayer rooms](../../game-concepts/multiplayer-rooms/README.md)
standard to Cloudflare Workers with one Durable Object per room. Read it
before changing the room server, its WebSocket handling, its storage or
alarms, its deployment, or its costs. Pricing and limits are version
sensitive: they were read from Cloudflare's docs on 2026-11-04, so check the
linked pages before relying on a number.

## Objects And Routing

- A Worker validates each request, then reaches the room's object with
  `env.ROOMS.getByName(code)`. Rejecting bad requests in the Worker keeps
  them from being billed as Durable Object requests.
- The first access to a name runs a global uniqueness check, a few hundred
  milliseconds, and the object is created near that first request.
- The Free plan allows only SQLite-backed objects. Declare the class in
  `wrangler.jsonc`, either with the newer `exports` field (switching to it
  is one-way) or a migration's `new_sqlite_classes`.

## WebSockets And Hibernation

- Accept with `ctx.acceptWebSocket(server, tags)` (the hibernation API) and
  handle `webSocketMessage`, `webSocketClose`, and `webSocketError` on the
  class. Never call `server.accept()`: it bills duration for the whole
  connection.
- An object hibernates after about 10 s idle only with no timers, pending
  I/O, or outbound connections. On wake the constructor runs again and
  in-memory state is gone, so rebuild it from storage and each socket's
  `serializeAttachment` (at most 16,384 bytes, lost on close).
- `setWebSocketAutoResponse` answers a fixed request string without waking
  the object or billing duration. Its reply is fixed too, so it cannot carry
  the server's time: clock-sync pings must reach the object.
- From compatibility date 2026-04-07 the runtime replies to a client's close
  frame itself.
- Up to 32,768 connections per object; incoming messages up to 32 MiB.
  About 1,000 requests a second per object is a soft limit.

## Clock, Storage, And Alarms

- In production `Date.now()` advances only after I/O, so it reads the time
  the current event arrived and stays frozen through synchronous work.
  Local development does not freeze it.
- `ctx.storage` offers synchronous `kv`, async `get`/`put`, and `sql.exec`.
  The output gate holds outgoing messages until writes confirm.
  `deleteAll()` is atomic and, from compatibility date 2026-02-24, also
  removes the alarm.
- One alarm per object; `setAlarm` replaces it. Alarms run at least once,
  may run twice, retry with backoff up to 6 times, wake a hibernated object,
  and can run up to a minute late, so check deadlines on every event too.
- A `fetch` from the object opens its input gate, so other events may
  interleave while it waits. Free allows 50 subrequests per invocation.

## Crypto And Secrets

- Web Crypto supports HMAC without `nodejs_compat`, so one HMAC module can
  run in the Worker and in Node.
- Set secrets with `wrangler secret put`; locally, put them in a gitignored
  `.dev.vars` (or `.env`, not both).

## Local Development And Deployment

- `wrangler dev` runs Durable Objects locally in workerd, with hibernation,
  and keeps state in `.wrangler/state`. Durable Object bindings cannot be
  remote bindings under `wrangler dev`. Alarms can fail after a hot reload;
  restart the server.
- Deploy with `wrangler login`, or `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. A custom domain needs the zone active on
  Cloudflare.
- Workers with Durable Objects get no preview or version URLs.
- By default a deploy waits up to 300 s for each object to hibernate.
  Hibernated sockets survive onto the new code, so a lobby can wake on a
  newer protocol; an object still active at the limit resets and its
  sockets close. A racing room never idles, so do not deploy mid-race.
- Set `WRANGLER_SEND_METRICS=false` to turn off Wrangler's usage telemetry.

## Pricing And Limits (2026-11-04)

| | Free | Workers Paid ($5/month) |
|---|---|---|
| Durable Object requests | 100,000 a day | 1M a month, then $0.15/M |
| Duration (at 128 MB) | 13,000 GB-s a day | 400k GB-s a month, then $12.50/M GB-s |
| Rows written | 100k a day | 50M a month, then $1/M |
| Storage | 5 GB in total, 1 GB per object | 5 GB-month, then $0.20/GB-month; 10 GB per object |
| Worker requests | 100k a day | 10M a month |
| CPU per invocation | 10 ms (Workers Free; the Durable Objects page states only 30 s) | 30 s |

- A WebSocket upgrade counts as one Worker request and one Durable Object
  request. Outgoing messages and protocol pings are not billed.
- On Paid, 20 incoming messages count as one request. The pricing page
  attaches that ratio only to the Paid column, so treat Free as unstated:
  counted one for one, four players at 10 messages a second use Free's
  daily requests in about 40 minutes of racing.
- Over a Free limit, operations fail until 00:00 UTC.

## Related

- [Multiplayer rooms](../../game-concepts/multiplayer-rooms/README.md)
- [Multiplayer rooms system](../../project-systems/multiplayer-rooms/README.md)

## Sources

- Pricing: <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- Limits: <https://developers.cloudflare.com/durable-objects/platform/limits/>
- Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- WebSockets and hibernation:
  <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>
- State API: <https://developers.cloudflare.com/durable-objects/api/state/>
- Alarms: <https://developers.cloudflare.com/durable-objects/api/alarms/>
- SQLite storage:
  <https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>
- Migrations:
  <https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/>
- Timers and `Date.now()`:
  <https://developers.cloudflare.com/workers/runtime-apis/performance/>
- Web Crypto: <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
- Secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- Compatibility flags:
  <https://developers.cloudflare.com/workers/configuration/compatibility-flags/>
- Local development:
  <https://developers.cloudflare.com/workers/local-development/>
- Version URLs:
  <https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/>
- Code updates:
  <https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/>
- Wrangler telemetry:
  <https://github.com/cloudflare/workers-sdk/blob/main/packages/wrangler/telemetry.md>
