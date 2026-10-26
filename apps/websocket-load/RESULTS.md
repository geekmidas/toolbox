# WebSocketApi load results

Measured 2026-10-17 with this package, through real sockets.

**Machine:** Mac Studio (Mac15,14), 28 cores, 96 GB, macOS 26.6. Docker Desktop
29.6.2, its VM given 24 CPUs and 47 GB. Everything — edge, replicas, Redis
and the load generators — ran in that one VM. Generators share its CPUs with
the server, so the latencies below are pessimistic, and the memory numbers are
the ones that carry over to a VPS.

Every run was `apps/websocket-load`'s scenario: replicas sharing Redis
(`redis://…?channel=load`), the edge in front of them as `gkm compose`
renders it (one route, every replica an upstream, no buffering), and
generators each in their own container. Edge and generators run with
`net.ipv4.ip_local_port_range=1024 65535` and `nofile=1048576` unless noted.

## The headline

**The edge, not the app, decides how many connections fit on a box.** Caddy
and Traefik each hold **~150–185 KB per proxied WebSocket**. The Node process
behind them holds **~10–16 KB**.

| What | Per connection | Where it comes from |
|---|---|---|
| Edge (Caddy 2 / Traefik v3.7.13), TLS | **170–185 KB** | container memory ÷ sockets (VmRSS confirms it is the process's own memory, not kernel socket buffers) |
| Edge, plain HTTP | 140–175 KB | TLS adds ~10–30 KB; the rest is the proxy |
| Edge, `GOGC=25` | 140–160 KB | GC tuning barely moves it — the memory is live, not garbage |
| Kernel slab, edge (2 sockets per client) | ~8 KB | `memory.stat` `slab` |
| `WebSocketApi` process, RSS growth | 7–14 KB | the server's own `process.memoryUsage().rss` before vs. after |
| `WebSocketApi` container | ~15 KB | `docker stats`, including its kernel memory |

Budgeting ~190 KB per connection for the stack as a whole:

| VPS memory (≈ 1 GB left for the OS, Redis, the rest of the stack) | Concurrent WebSockets |
|---|---|
| 4 GB | ~15k |
| 8 GB | ~35k |
| 16 GB | ~80k |
| 32 GB | ~165k |

The earlier estimate in #286 (50–80 KB all-in, ~100k on 8 GB) was wrong by a
factor of three, and the reason is the proxy.

## Runs

`--hold` 30–40 s, three broadcasts each, RTT sampled on 50 sockets/s per generator.

| Run | Sockets | Failures | Connect p50 / p99 | Echo RTT p50 / p99 | Broadcast to all | Edge memory | App RSS / conn |
|---|---|---|---|---|---|---|---|
| 20k, Caddy, TLS, 2 replicas | 20,000 | 0 | 5.1 / 210 ms | 1.5 / 106 ms | 109–154 ms | 3.53 GiB | 10.7 KB |
| 20k, Traefik, TLS, 2 replicas | 20,000 | 0 | 3.9 / 28 ms | 2.2 / 137 ms | 106–147 ms | 3.47 GiB | 10.2 KB |
| 20k, no edge, 2 replicas | 20,000 | 0 | 0.8 / 18 ms | 1.1 / 102 ms | 95–121 ms | — | 8.9 KB |
| 20k, Caddy, plain | 20,000 | 0 | 1.7 / 24 ms | 1.7 / 98 ms | 102–148 ms | 3.33 GiB | 12.0 KB |
| 20k, Traefik, plain | 20,000 | 0 | 1.7 / 20 ms | 1.9 / 134 ms | 118–139 ms | 2.78 GiB | 10.1 KB |
| 20k, Caddy, TLS, `GOGC=25` | 20,000 | 0 | 3.5 / 46 ms | 1.8 / 125 ms | 115–139 ms | 3.04 GiB | 11.1 KB |
| 20k, Traefik, TLS, `GOGC=25` | 20,000 | 0 | 4.0 / 57 ms | 2.0 / 142 ms | 111–148 ms | 2.71 GiB | 10.3 KB |
| **50k, Caddy, TLS, 4 replicas** | 50,000 | 0 | 12.4 / 178 ms | 1.3 / 148 ms | 150–196 ms | **8.24 GiB** | 13.5 KB |
| **50k, Traefik, TLS, 4 replicas** | 50,000 | 0 | 4.6 / 25 ms | 1.7 / 108 ms | 151–188 ms | **8.09 GiB** | 13.5 KB |
| 35k, Caddy plain, **1 replica, default port range** | **28,199** | **6,801 × 502** | 4.0 / 26 ms | 1.5 / 382 ms | 383 ms | 4.90 GiB | 7.8 KB |
| 35k, Caddy plain, 1 replica, port range widened | 35,000 | 0 | 2.1 / 279 ms | 1.5 / 478 ms | 489 ms | 5.44 GiB | 7.1 KB |

"Broadcast to all" is from the server stamping the message to the last socket
receiving it, across every generator. Every broadcast reached every socket in
every run.

## Findings

1. **~28k per replica behind the edge is real, and exact.** With Docker's
   default `ip_local_port_range` (32768–60999 = 28,232 ports) one replica
   stopped at 28,231 sockets — the rest got `502` from the edge. Widening the
   range on the edge container (`sysctls`) lifted it; the same single replica
   then held 35,000. Either widen it or run more replicas — each replica is a
   different destination address, with its own 28k.
2. **One Node process handles 35k sockets** and broadcasts to all of them in
   ~0.5 s. Four replicas at 12.5k each broadcast to 50k in 150–200 ms.
   Replicas are about broadcast latency and the port budget; memory per
   connection is the same either way.
3. **Traefik's 60 s `respondingTimeouts.readTimeout` does not cut upgraded
   connections.** 2,000 sockets held completely silent for 90 s (server pings
   every 300 s, no frames) through Traefik v3.7.13 and through Caddy:
   `unexpected closes {}` on both. No edge timeout needs changing for idle
   sockets — the 30 s server ping stays for NATs and dead peers.
4. **Caddy's connect tail is longer than Traefik's** under a fast ramp (p99
   178–210 ms vs 25–28 ms with TLS); steady-state RTT and broadcast are the
   same.
5. Loopback RTT p99 of ~100–150 ms is the generators and the server sharing
   one VM's CPUs during broadcasts; p50 stays at 1–2 ms.

## Not measured

- A real VPS. These are Docker Desktop numbers; memory per connection
  carries over, latency does not. The same scenario runs on any Docker host.
- conntrack: Docker Desktop's VM did not hit `nf_conntrack_max` at 50k.
  A small VPS's default (65–130k entries, ~2 per client) is still worth
  raising before ~30k clients.
- More than 50k: the VM had the memory (≈ 9 GB of edge at 50k) — runs beyond
  were not attempted.

## Reproduce

```sh
pnpm --filter @geekmidas/websocket-load run scenario -- \
  --connections 50000 --generators 5 --replicas 4 --proxy traefik --hold 40 --ramp 3000

# the per-replica port ceiling
pnpm --filter @geekmidas/websocket-load run scenario -- \
  --connections 35000 --generators 4 --replicas 1 --proxy caddy --plain --default-ports

# idle sockets through the edge
pnpm --filter @geekmidas/websocket-load run scenario -- \
  --connections 2000 --generators 2 --proxy traefik --idle --hold 90
```

In-process benchmarks (`pnpm bench:ci packages/constructs/src/__benchmarks__/websocket.bench.ts`,
same machine, client and server in one process, plain loopback):

| Benchmark | Result |
|---|---|
| Echo round trip (parse → validate → handle → reply) | 24.6k/s, mean 0.059 ms, p99 0.31 ms |
| Broadcast to 1,000 sockets, until all received | mean 5.8 ms, p99 8.4 ms |
| Broadcast to 10,000 sockets, until all received | mean 68.5 ms, p99 88.8 ms |
| `publisher.send` → socket, memory transport | 95k/s, mean 0.013 ms |
| `publisher.send` → socket, Redis transport | 6.5k/s, mean 0.16 ms, p99 0.24 ms |
