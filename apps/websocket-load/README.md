# @geekmidas/websocket-load

Real-socket load for a `WebSocketApi`: how many connections a box holds, what
each one costs, and how fast a broadcast reaches all of them. Private — it is
how the numbers in the docs were made, not something to install.

Results from the last run are in [RESULTS.md](./RESULTS.md).

## Pieces

- **`src/target.ts`** — a `WebSocketApi` served as the generated entry serves
  one: Node's `http`, `/health`, the surface attached to upgrades. Routes:
  `echo` (returns its body), `stats` (this process's RSS, heap and socket
  count), `fanout` (broadcasts `{ fanout, t }` to every socket on every
  replica). With `REALTIME_PUBLISHER_CONNECTION_STRING=redis://…` any number
  of them share sockets as replicas on a stack do.
- **`src/simulate.ts`** — opens N sockets at a ramp rate and holds them
  (`ws` answers pings), samples round trips through `echo`, triggers
  broadcasts and times their arrival at every socket it holds, asks the
  server what its sockets cost. One loop ramps and one samples — no timer per
  socket — so one process holds tens of thousands.
- **`src/scenario.ts`** — the whole run in Docker: N replicas + Redis, the
  edge (`caddy` or `traefik`, rendered like `gkm compose` renders it — one
  route, every replica an upstream, no buffering — or `none`), and K
  generators, each its own container and so its own source IP. Writes
  `.run/docker-compose.yml`, runs it, pools the generators' reports and tears
  it down. Nothing is published on the host.

`node build.mjs` bundles target and simulator into `dist/`, which the
containers mount on a stock `node:24-alpine` — there is no image to build.

## Running

```sh
# Locally, no Docker
pnpm --filter @geekmidas/websocket-load run target          # PORT=3000
pnpm --filter @geekmidas/websocket-load run simulate -- \
  --url ws://127.0.0.1:3000 --connections 5000 --ramp 2500 --hold 20

# Through an edge, in Docker
pnpm --filter @geekmidas/websocket-load run scenario -- \
  --connections 50000 --generators 5 --replicas 4 --proxy caddy
```

### `scenario` flags

| Flag | Default | |
|---|---|---|
| `--connections` | 10000 | across every generator |
| `--generators` | 2 | containers opening sockets; keep each under ~25k |
| `--replicas` | 2 | target processes behind the edge |
| `--proxy` | caddy | `caddy`, `traefik` or `none` |
| `--ramp` | 2000 | sockets per second, across generators |
| `--hold` | 30 | seconds to hold every socket after the ramp |
| `--broadcasts` | 3 | fan-outs, 3 s apart, triggered by the first generator |
| `--heartbeat` | 30 | seconds between the server's pings |
| `--plain` | off | edge without TLS, to separate TLS's cost from the proxy's |
| `--gogc` | — | the edge's `GOGC` |
| `--default-ports` | off | leave the edge's ephemeral port range at Docker's default |
| `--idle` | off | no frames at all and pings every 300 s — what the edge's timeouts see |
| `--keep` | off | leave the stack up (`.run/docker-compose.yml`) |
| `--label` | — | recorded in `.run/summary.json` |

### `simulate` flags

`--url` (comma-separated to spread over several), `--connections`, `--ramp`,
`--hold`, `--rtt-every` (seconds, 0 for none), `--rtt-sample` (sockets per
sample), `--broadcasts`, `--broadcast-every`, `--settle` (seconds after the
ramp before broadcasting), `--no-trigger` (receive others' broadcasts only),
`--insecure` (accept the edge's own certificate), `--json <file>`, `--name`,
`--quiet`.

## Reading a report

- **RSS / connection** — the server's RSS growth divided by the sockets it
  gained, per replica seen before and after.
- **broadcast n** — `received/expected in X ms`: how many of the sockets open
  when it arrived got it, and the time from the server stamping it to the
  last one receiving it.
- **containers holding** — `docker stats` once every socket is open; the
  edge's line is the number that decides how many fit on a box.
