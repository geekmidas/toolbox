# Phase 4: Studio UI Polish - Implementation Plan

## Technical Decisions

| Decision | Choice | Fallback |
|----------|--------|----------|
| Charting | Tremor | Custom SVG if performance issues |
| Real-time | Extend existing WebSocket | - |
| Time range | Hybrid (presets + custom picker) | - |

---

## 1. Analytics Data Visualization (Tremor)

### 1.1 Installation

```bash
pnpm --filter @geekmidas/studio add @tremor/react
```

Tremor requires Tailwind CSS (already have v4).

### 1.2 Components to Use

| Current | Replace With | Tremor Component |
|---------|--------------|------------------|
| Custom progress bars (status distribution) | `<DonutChart />` | Pie/donut with legend |
| Custom bar chart (latency percentiles) | `<BarChart />` | Horizontal bar chart |
| Custom vertical bars (time series) | `<AreaChart />` | Area chart with gradient fill |
| MetricCard sparklines | `<SparkAreaChart />` | Inline trend chart |

### 1.3 New Visualizations

| Chart | Purpose | Tremor Component |
|-------|---------|------------------|
| Request volume over time | Show traffic patterns | `<AreaChart />` with time axis |
| Error rate trend | Track error spikes | `<LineChart />` with threshold line |
| Latency distribution | Show p50/p95/p99 bands | `<AreaChart />` with stacked areas |
| Top endpoints | Ranked list with bars | `<BarList />` |

### 1.4 File Changes

```
packages/studio/ui/src/
├── components/
│   └── charts/
│       ├── RequestVolumeChart.tsx    # AreaChart for traffic
│       ├── StatusDistributionChart.tsx # DonutChart for 2xx/3xx/4xx/5xx
│       ├── LatencyChart.tsx          # BarChart for percentiles
│       ├── ErrorRateChart.tsx        # LineChart with threshold
│       └── TopEndpointsChart.tsx     # BarList for endpoints
└── pages/
    └── AnalyticsPage.tsx             # Refactor to use new charts
```

### 1.5 Example Implementation

```tsx
// RequestVolumeChart.tsx
import { AreaChart, Card, Title } from '@tremor/react';

interface DataPoint {
  timestamp: string;
  requests: number;
}

export function RequestVolumeChart({ data }: { data: DataPoint[] }) {
  return (
    <Card>
      <Title>Request Volume</Title>
      <AreaChart
        data={data}
        index="timestamp"
        categories={['requests']}
        colors={['blue']}
        showLegend={false}
        showGridLines={false}
        curveType="monotone"
      />
    </Card>
  );
}
```

---

## 2. Real-time Metrics via WebSocket

### 2.1 New Message Type

Add `metrics` message type to existing WebSocket infrastructure.

```typescript
// packages/telescope/src/types.ts
type WebSocketMessage =
  | { type: 'request'; data: RequestEntry }
  | { type: 'exception'; data: ExceptionEntry }
  | { type: 'log'; data: LogEntry }
  | { type: 'metrics'; data: MetricsSnapshot }; // NEW

interface MetricsSnapshot {
  timestamp: string;
  totalRequests: number;
  requestsPerSecond: number;
  avgDuration: number;
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  statusDistribution: {
    '2xx': number;
    '3xx': number;
    '4xx': number;
    '5xx': number;
  };
}
```

### 2.2 Server-Side Changes

```typescript
// packages/telescope/src/server/hono/websocket.ts

// Add metrics broadcast interval (every 5 seconds)
const METRICS_BROADCAST_INTERVAL = 5000;

export function setupWebSocket(telescope: Telescope) {
  // ... existing code ...

  // Add metrics broadcast
  setInterval(() => {
    const metrics = telescope.getMetricsAggregator().getSnapshot();
    broadcast({ type: 'metrics', data: metrics });
  }, METRICS_BROADCAST_INTERVAL);
}
```

### 2.3 Client-Side Changes

```typescript
// packages/studio/ui/src/providers/StudioProvider.tsx

interface StudioState {
  // ... existing ...
  metrics: MetricsSnapshot | null;
}

// In WebSocket message handler:
case 'metrics':
  setState(prev => ({ ...prev, metrics: message.data }));
  break;
```

### 2.4 Analytics Page Integration

```tsx
// Use real-time metrics when available, fall back to polling
const { metrics: realtimeMetrics } = useStudio();
const [polledMetrics, setPolledMetrics] = useState<Metrics | null>(null);

const metrics = realtimeMetrics ?? polledMetrics;

// Reduce polling frequency when WebSocket is connected
useEffect(() => {
  if (realtimeMetrics) return; // Skip polling if WS connected

  const interval = setInterval(fetchMetrics, 30000);
  return () => clearInterval(interval);
}, [realtimeMetrics]);
```

---

## 3. Time Range Selector (Hybrid)

### 3.1 Component Design

```
┌─────────────────────────────────────────────────────────────┐
│  [Last 1h] [Last 6h] [Last 24h] [Last 7d] │ [Custom ▾]     │
└─────────────────────────────────────────────────────────────┘
                                                    │
                                    ┌───────────────▼───────────┐
                                    │  From: [Date Picker]      │
                                    │  To:   [Date Picker]      │
                                    │  [Apply] [Cancel]         │
                                    └───────────────────────────┘
```

### 3.2 Time Range State

```typescript
// packages/studio/ui/src/hooks/useTimeRange.ts

type TimeRangePreset = '1h' | '6h' | '24h' | '7d' | 'custom';

interface TimeRange {
  preset: TimeRangePreset;
  start: Date;
  end: Date;
}

export function useTimeRange() {
  const [timeRange, setTimeRange] = useState<TimeRange>({
    preset: '1h',
    start: subHours(new Date(), 1),
    end: new Date(),
  });

  const setPreset = (preset: TimeRangePreset) => {
    const end = new Date();
    const start = match(preset)
      .with('1h', () => subHours(end, 1))
      .with('6h', () => subHours(end, 6))
      .with('24h', () => subHours(end, 24))
      .with('7d', () => subDays(end, 7))
      .with('custom', () => timeRange.start)
      .exhaustive();

    setTimeRange({ preset, start, end });
  };

  const setCustomRange = (start: Date, end: Date) => {
    setTimeRange({ preset: 'custom', start, end });
  };

  return { timeRange, setPreset, setCustomRange };
}
```

### 3.3 Component Implementation

```tsx
// packages/studio/ui/src/components/TimeRangeSelector.tsx

import { Button, DateRangePicker } from '@tremor/react';

const presets = [
  { label: 'Last 1h', value: '1h' },
  { label: 'Last 6h', value: '6h' },
  { label: 'Last 24h', value: '24h' },
  { label: 'Last 7d', value: '7d' },
] as const;

export function TimeRangeSelector({
  value,
  onChange
}: {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg border">
        {presets.map(({ label, value: preset }) => (
          <Button
            key={preset}
            variant={value.preset === preset ? 'primary' : 'secondary'}
            onClick={() => onChange({ ...value, preset })}
          >
            {label}
          </Button>
        ))}
      </div>

      <DateRangePicker
        value={{ from: value.start, to: value.end }}
        onValueChange={({ from, to }) => {
          if (from && to) {
            onChange({ preset: 'custom', start: from, end: to });
          }
        }}
        enableSelect={false}
      />
    </div>
  );
}
```

### 3.4 API Integration

```typescript
// Update API calls to include time range
const fetchMetrics = async (timeRange: TimeRange) => {
  const params = new URLSearchParams({
    start: timeRange.start.toISOString(),
    end: timeRange.end.toISOString(),
  });

  return fetch(`/__studio/api/metrics?${params}`).then(r => r.json());
};
```

---

## 4. Endpoint Details Drill-Down

### 4.1 New Route

```tsx
// packages/studio/ui/src/pages/EndpointDetailsPage.tsx

// Route: /analytics/endpoints/:method/:path
// Example: /analytics/endpoints/GET/api/users
```

### 4.2 UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back to Analytics                                        │
│                                                             │
│  GET /api/users                              [Time Range ▾] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Requests │ │ Avg Dur  │ │ Error %  │ │ p95 Dur  │       │
│  │  12,456  │ │  45ms    │ │  2.3%    │ │  120ms   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Request Volume Over Time               │   │
│  │  [AreaChart]                                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Latency Distribution                    │   │
│  │  [AreaChart with p50/p95/p99 bands]                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Recent Requests                         │   │
│  │  [Table: timestamp, status, duration, error]        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 API Endpoint

```typescript
// GET /__studio/api/metrics/endpoints/:method/:path

interface EndpointDetails {
  method: string;
  path: string;
  totalRequests: number;
  avgDuration: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
  timeSeries: Array<{
    timestamp: string;
    requests: number;
    avgDuration: number;
    errorRate: number;
  }>;
  recentRequests: Array<{
    id: string;
    timestamp: string;
    status: number;
    duration: number;
    error?: string;
  }>;
}
```

### 4.4 Navigation from Analytics Page

```tsx
// In TopEndpointsChart or endpoints table
<Link to={`/analytics/endpoints/${endpoint.method}/${encodeURIComponent(endpoint.path)}`}>
  {endpoint.method} {endpoint.path}
</Link>
```

---

## 5. Export Metrics as CSV/JSON

### 5.1 Export Button Component

```tsx
// packages/studio/ui/src/components/ExportButton.tsx

import { Button, Select } from '@tremor/react';
import { Download } from 'lucide-react';

type ExportFormat = 'csv' | 'json';

export function ExportButton({
  data,
  filename
}: {
  data: unknown;
  filename: string;
}) {
  const [format, setFormat] = useState<ExportFormat>('csv');

  const handleExport = () => {
    const content = format === 'csv'
      ? convertToCSV(data)
      : JSON.stringify(data, null, 2);

    const blob = new Blob([content], {
      type: format === 'csv' ? 'text/csv' : 'application/json'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={format} onValueChange={setFormat}>
        <SelectItem value="csv">CSV</SelectItem>
        <SelectItem value="json">JSON</SelectItem>
      </Select>
      <Button onClick={handleExport} icon={Download}>
        Export
      </Button>
    </div>
  );
}
```

### 5.2 CSV Conversion Utility

```typescript
// packages/studio/ui/src/utils/export.ts

export function convertToCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => JSON.stringify(row[h] ?? '')).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}
```

### 5.3 Export Options per Section

| Section | Export Data |
|---------|-------------|
| Overview | Summary metrics (single row) |
| Time Series | Timestamp, requests, duration, error rate |
| Endpoints | All endpoint metrics |
| Status Distribution | Status codes with counts |

---

## Implementation Order

| Step | Task | Estimated Effort |
|------|------|------------------|
| 1 | Install Tremor, verify Tailwind compatibility | Small |
| 2 | Create chart components (Status, Latency, Volume) | Medium |
| 3 | Refactor AnalyticsPage to use new charts | Medium |
| 4 | Implement TimeRangeSelector component | Small |
| 5 | Add time range to API calls | Small |
| 6 | Add `metrics` WebSocket message type (server) | Small |
| 7 | Integrate real-time metrics (client) | Small |
| 8 | Create EndpointDetailsPage | Medium |
| 9 | Add endpoint details API | Small |
| 10 | Implement export functionality | Small |

---

## File Summary

### New Files
- `packages/studio/ui/src/components/charts/RequestVolumeChart.tsx`
- `packages/studio/ui/src/components/charts/StatusDistributionChart.tsx`
- `packages/studio/ui/src/components/charts/LatencyChart.tsx`
- `packages/studio/ui/src/components/charts/ErrorRateChart.tsx`
- `packages/studio/ui/src/components/charts/TopEndpointsChart.tsx`
- `packages/studio/ui/src/components/TimeRangeSelector.tsx`
- `packages/studio/ui/src/components/ExportButton.tsx`
- `packages/studio/ui/src/hooks/useTimeRange.ts`
- `packages/studio/ui/src/pages/EndpointDetailsPage.tsx`
- `packages/studio/ui/src/utils/export.ts`

### Modified Files
- `packages/studio/ui/package.json` (add Tremor)
- `packages/studio/ui/src/pages/AnalyticsPage.tsx`
- `packages/studio/ui/src/providers/StudioProvider.tsx`
- `packages/studio/ui/src/api.ts`
- `packages/telescope/src/server/hono/websocket.ts`
- `packages/telescope/src/server/hono/routes.ts`
- `packages/telescope/src/types.ts`
