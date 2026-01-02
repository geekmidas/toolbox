window.BENCHMARK_DATA = {
  "lastUpdate": 1767341020866,
  "repoUrl": "https://github.com/geekmidas/toolbox",
  "entries": {
    "Toolbox Benchmarks": [
      {
        "commit": {
          "author": {
            "email": "lebogang@technanimals.com",
            "name": "geekmidas",
            "username": "geekmidas"
          },
          "committer": {
            "email": "lebogang@technanimals.com",
            "name": "geekmidas",
            "username": "geekmidas"
          },
          "distinct": true,
          "id": "f85e981dd282acc38ddf8f0960cc4aaa81dea7e3",
          "message": "🔧 fix(benchmark): skip gh-pages fetch when using main branch\n\n- Add skip-fetch-gh-pages: true to avoid fetch conflicts on main\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>",
          "timestamp": "2026-01-02T09:55:56+02:00",
          "tree_id": "9df1390f2626ea22b2e8d02f426a5dedf0092d87",
          "url": "https://github.com/geekmidas/toolbox/commit/f85e981dd282acc38ddf8f0960cc4aaa81dea7e3"
        },
        "date": 1767341020836,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > set with TTL",
            "value": 1818027,
            "range": "±0.56%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > get (cache hit)",
            "value": 880212,
            "range": "±0.42%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > get (cache miss)",
            "value": 2979669,
            "range": "±0.62%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > delete",
            "value": 1184051,
            "range": "±0.97%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > set + get cycle",
            "value": 413382,
            "range": "±5.46%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache - Large Scale > 1000 sequential sets",
            "value": 1908,
            "range": "±0.66%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache - Large Scale > 1000 sequential gets",
            "value": 830,
            "range": "±0.82%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting > checkRateLimit - single IP",
            "value": 0,
            "range": "±0.00%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting > checkRateLimit - varying IPs",
            "value": 0,
            "range": "±0.00%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - High Volume > 100 requests same IP",
            "value": 6118,
            "range": "±0.45%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - High Volume > 100 requests different IPs",
            "value": 7241,
            "range": "±0.56%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 second window",
            "value": 710007,
            "range": "±0.62%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 minute window",
            "value": 726389,
            "range": "±0.49%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 hour window",
            "value": 723550,
            "range": "±0.55%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > simple object schema",
            "value": 3695,
            "range": "±1.46%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > primitive string schema",
            "value": 4122,
            "range": "±6.40%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > array of strings schema",
            "value": 5146,
            "range": "±2.45%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > deeply nested schema",
            "value": 1951,
            "range": "±0.80%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > discriminated union schema",
            "value": 4938,
            "range": "±1.07%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > large object (50 fields)",
            "value": 3848,
            "range": "±1.13%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - With Refinements > schema with refinements",
            "value": 4701,
            "range": "±1.20%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Simple > simple GET endpoint",
            "value": 146577,
            "range": "±0.49%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - With Validation > POST with body validation",
            "value": 128340,
            "range": "±0.43%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - With Validation > POST with complex body validation",
            "value": 98985,
            "range": "±0.48%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Path Params > GET with path params",
            "value": 136042,
            "range": "±0.49%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Query Params > GET with query params",
            "value": 132298,
            "range": "±0.57%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Single Service > GET with single service",
            "value": 133589,
            "range": "±0.53%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Multiple Services > GET with multiple services (3)",
            "value": 132253,
            "range": "±0.43%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Session Extraction > GET with session extraction",
            "value": 136925,
            "range": "±0.45%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Authorization > POST with authorization check",
            "value": 132651,
            "range": "±0.49%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Declarative Audit > POST with declarative audit",
            "value": 108140,
            "range": "±0.55%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Manual Audit > POST with manual audit",
            "value": 111121,
            "range": "±0.49%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Event Publishing > POST with event publishing",
            "value": 113892,
            "range": "±0.48%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Full Stack (Services + Session + Audit) > POST full stack (services + session + audit)",
            "value": 98609,
            "range": "±0.55%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Simple Endpoints > GET /health - minimal response",
            "value": 35029,
            "range": "±1.06%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > GET /users - list response",
            "value": 27946,
            "range": "±1.74%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > GET /users/:id - path params",
            "value": 29565,
            "range": "±1.79%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > POST /users - body validation",
            "value": 10081,
            "range": "±2.22%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > PUT /users/:id - params + body",
            "value": 14779,
            "range": "±2.66%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > DELETE /users/:id - params only",
            "value": 29607,
            "range": "±1.63%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Complex Validation > POST /orders - complex nested body",
            "value": 12638,
            "range": "±2.60%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Query Parameters > GET /search - with query params",
            "value": 23784,
            "range": "±2.01%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Concurrent Requests > 10 concurrent requests",
            "value": 5433,
            "range": "±1.24%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Concurrent Requests > 50 concurrent requests",
            "value": 1130,
            "range": "±1.26%",
            "unit": "ops/sec"
          }
        ]
      }
    ]
  }
}