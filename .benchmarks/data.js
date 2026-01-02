window.BENCHMARK_DATA = {
  "lastUpdate": 1767341698073,
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
      },
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
          "id": "f3e795bc9e2182fb650b4fc7aebfccb327dfbeac",
          "message": "🚀 feat(benchmark): add GitHub Pages deployment for dashboard\n\n- Add pages deployment steps using actions/deploy-pages\n- Add concurrency group to avoid deployment conflicts\n- Dashboard will be at https://geekmidas.github.io/toolbox/\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>",
          "timestamp": "2026-01-02T10:08:18+02:00",
          "tree_id": "23d18eca38c2ba6e7ff115300b1a2473b3788282",
          "url": "https://github.com/geekmidas/toolbox/commit/f3e795bc9e2182fb650b4fc7aebfccb327dfbeac"
        },
        "date": 1767341392465,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > set with TTL",
            "value": 1826458,
            "range": "±0.59%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > get (cache hit)",
            "value": 862729,
            "range": "±0.59%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > get (cache miss)",
            "value": 2754851,
            "range": "±0.70%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > delete",
            "value": 1165969,
            "range": "±1.12%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > set + get cycle",
            "value": 391362,
            "range": "±6.22%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache - Large Scale > 1000 sequential sets",
            "value": 2030,
            "range": "±0.84%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache - Large Scale > 1000 sequential gets",
            "value": 818,
            "range": "±1.17%",
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
            "value": 6030,
            "range": "±0.54%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - High Volume > 100 requests different IPs",
            "value": 7372,
            "range": "±0.64%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 second window",
            "value": 703702,
            "range": "±0.69%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 minute window",
            "value": 726212,
            "range": "±0.57%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 hour window",
            "value": 723557,
            "range": "±0.64%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > simple object schema",
            "value": 3764,
            "range": "±1.10%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > primitive string schema",
            "value": 4543,
            "range": "±1.55%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > array of strings schema",
            "value": 5181,
            "range": "±2.14%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > deeply nested schema",
            "value": 1973,
            "range": "±0.89%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > discriminated union schema",
            "value": 4843,
            "range": "±1.39%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > large object (50 fields)",
            "value": 3558,
            "range": "±1.08%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - With Refinements > schema with refinements",
            "value": 4978,
            "range": "±1.56%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Simple > simple GET endpoint",
            "value": 146890,
            "range": "±0.52%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - With Validation > POST with body validation",
            "value": 120607,
            "range": "±2.43%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - With Validation > POST with complex body validation",
            "value": 98226,
            "range": "±0.68%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Path Params > GET with path params",
            "value": 133976,
            "range": "±0.76%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Query Params > GET with query params",
            "value": 132277,
            "range": "±0.85%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Single Service > GET with single service",
            "value": 133225,
            "range": "±0.67%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Multiple Services > GET with multiple services (3)",
            "value": 129224,
            "range": "±0.65%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Session Extraction > GET with session extraction",
            "value": 134682,
            "range": "±0.60%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Authorization > POST with authorization check",
            "value": 132176,
            "range": "±0.63%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Declarative Audit > POST with declarative audit",
            "value": 108559,
            "range": "±0.64%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Manual Audit > POST with manual audit",
            "value": 107709,
            "range": "±0.77%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Event Publishing > POST with event publishing",
            "value": 112179,
            "range": "±0.71%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Full Stack (Services + Session + Audit) > POST full stack (services + session + audit)",
            "value": 98618,
            "range": "±0.74%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Simple Endpoints > GET /health - minimal response",
            "value": 34678,
            "range": "±1.16%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > GET /users - list response",
            "value": 32047,
            "range": "±0.88%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > GET /users/:id - path params",
            "value": 34024,
            "range": "±0.74%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > POST /users - body validation",
            "value": 12024,
            "range": "±1.22%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > PUT /users/:id - params + body",
            "value": 17877,
            "range": "±0.93%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > DELETE /users/:id - params only",
            "value": 29818,
            "range": "±1.88%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Complex Validation > POST /orders - complex nested body",
            "value": 14403,
            "range": "±0.87%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Query Parameters > GET /search - with query params",
            "value": 24670,
            "range": "±0.75%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Concurrent Requests > 10 concurrent requests",
            "value": 5122,
            "range": "±1.03%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Concurrent Requests > 50 concurrent requests",
            "value": 1113,
            "range": "±2.25%",
            "unit": "ops/sec"
          }
        ]
      },
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
          "id": "6f576b74984048bb8ddb9421170e9d48cfe7145c",
          "message": "🔧 Add .benchmarks to ignore patterns in biome.json",
          "timestamp": "2026-01-02T10:11:26+02:00",
          "tree_id": "54f2b97bc45c788be4fa5853490bf6aee5380a16",
          "url": "https://github.com/geekmidas/toolbox/commit/6f576b74984048bb8ddb9421170e9d48cfe7145c"
        },
        "date": 1767341698043,
        "tool": "customBiggerIsBetter",
        "benches": [
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > set with TTL",
            "value": 1838741,
            "range": "±0.56%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > get (cache hit)",
            "value": 892212,
            "range": "±0.47%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > get (cache miss)",
            "value": 2985444,
            "range": "±0.64%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > delete",
            "value": 1194653,
            "range": "±0.96%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache > set + get cycle",
            "value": 429311,
            "range": "±4.89%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache - Large Scale > 1000 sequential sets",
            "value": 2095,
            "range": "±0.69%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/memory.bench.ts > InMemoryCache - Large Scale > 1000 sequential gets",
            "value": 872,
            "range": "±0.83%",
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
            "value": 6194,
            "range": "±0.45%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - High Volume > 100 requests different IPs",
            "value": 7258,
            "range": "±0.59%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 second window",
            "value": 714346,
            "range": "±0.63%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 minute window",
            "value": 701284,
            "range": "±0.60%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/rateLimit.bench.ts > Rate Limiting - Window Sizes > 1 hour window",
            "value": 731587,
            "range": "±0.56%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > simple object schema",
            "value": 3480,
            "range": "±1.47%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > primitive string schema",
            "value": 3951,
            "range": "±7.52%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Simple > array of strings schema",
            "value": 5239,
            "range": "±1.83%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > deeply nested schema",
            "value": 1938,
            "range": "±0.73%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > discriminated union schema",
            "value": 4719,
            "range": "±2.03%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - Complex > large object (50 fields)",
            "value": 3544,
            "range": "±1.03%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/conversion.bench.ts > Schema Conversion - With Refinements > schema with refinements",
            "value": 4503,
            "range": "±1.10%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Simple > simple GET endpoint",
            "value": 150371,
            "range": "±0.49%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - With Validation > POST with body validation",
            "value": 130808,
            "range": "±0.45%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - With Validation > POST with complex body validation",
            "value": 102052,
            "range": "±0.48%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Path Params > GET with path params",
            "value": 137811,
            "range": "±0.51%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Query Params > GET with query params",
            "value": 134263,
            "range": "±0.51%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Single Service > GET with single service",
            "value": 135795,
            "range": "±0.51%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Multiple Services > GET with multiple services (3)",
            "value": 129017,
            "range": "±0.59%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Session Extraction > GET with session extraction",
            "value": 136479,
            "range": "±0.53%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Authorization > POST with authorization check",
            "value": 134181,
            "range": "±0.44%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Declarative Audit > POST with declarative audit",
            "value": 112017,
            "range": "±0.51%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Manual Audit > POST with manual audit",
            "value": 111098,
            "range": "±0.52%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Event Publishing > POST with event publishing",
            "value": 115194,
            "range": "±0.48%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/endpoint.bench.ts > Endpoint Handling - Full Stack (Services + Session + Audit) > POST full stack (services + session + audit)",
            "value": 100799,
            "range": "±0.49%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Simple Endpoints > GET /health - minimal response",
            "value": 34489,
            "range": "±1.11%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > GET /users - list response",
            "value": 31959,
            "range": "±0.75%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > GET /users/:id - path params",
            "value": 33515,
            "range": "±0.59%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > POST /users - body validation",
            "value": 11913,
            "range": "±1.15%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > PUT /users/:id - params + body",
            "value": 18358,
            "range": "±0.65%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - CRUD Operations > DELETE /users/:id - params only",
            "value": 31669,
            "range": "±0.61%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Complex Validation > POST /orders - complex nested body",
            "value": 14610,
            "range": "±0.64%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Query Parameters > GET /search - with query params",
            "value": 25110,
            "range": "±1.20%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Concurrent Requests > 10 concurrent requests",
            "value": 5509,
            "range": "±0.87%",
            "unit": "ops/sec"
          },
          {
            "name": "src/__benchmarks__/hono-server.bench.ts > Hono E2E - Concurrent Requests > 50 concurrent requests",
            "value": 1148,
            "range": "±0.96%",
            "unit": "ops/sec"
          }
        ]
      }
    ]
  }
}