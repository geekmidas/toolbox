/**
 * Theme constants for the UI component library.
 * Inspired by Supabase's dark theme design.
 */
export const theme = {
  colors: {
    // Background colors
    background: '#171717',
    surface: '#1c1c1c',
    surfaceHover: '#262626',
    surfaceActive: '#2a2a2a',

    // Border colors
    border: '#2e2e2e',
    borderHover: '#3e3e3e',
    borderFocus: '#3ecf8e',

    // Text colors
    text: '#fafafa',
    textMuted: '#a1a1aa',
    textSubtle: '#71717a',

    // Accent colors
    accent: '#3ecf8e',
    accentHover: '#4ade80',
    accentMuted: '#22c55e',

    // Semantic colors
    error: '#ef4444',
    errorMuted: '#dc2626',
    warning: '#f59e0b',
    warningMuted: '#d97706',
    info: '#3b82f6',
    infoMuted: '#2563eb',
    success: '#22c55e',
    successMuted: '#16a34a',
  },

  // HTTP method colors
  methods: {
    GET: '#3b82f6',
    POST: '#22c55e',
    PUT: '#f59e0b',
    PATCH: '#8b5cf6',
    DELETE: '#ef4444',
    HEAD: '#6b7280',
    OPTIONS: '#6b7280',
  } as const,

  // HTTP status code colors
  status: {
    '1xx': '#6b7280',
    '2xx': '#22c55e',
    '3xx': '#3b82f6',
    '4xx': '#f59e0b',
    '5xx': '#ef4444',
  } as const,

  // Log level colors
  logLevels: {
    trace: '#6b7280',
    debug: '#6b7280',
    info: '#3b82f6',
    warn: '#f59e0b',
    error: '#ef4444',
    fatal: '#dc2626',
  } as const,

  // Spacing scale
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
  } as const,

  // Border radius
  radius: {
    sm: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    full: '9999px',
  } as const,

  // Font sizes
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
  } as const,

  // Transitions
  transition: {
    fast: '150ms ease',
    normal: '200ms ease',
    slow: '300ms ease',
  } as const,
} as const;

export type Theme = typeof theme;
export type ThemeColors = typeof theme.colors;
export type HttpMethod = keyof typeof theme.methods;
export type StatusRange = keyof typeof theme.status;
export type LogLevel = keyof typeof theme.logLevels;

/**
 * Get the color for an HTTP method.
 */
export function getMethodColor(method: string): string {
  const upperMethod = method.toUpperCase() as HttpMethod;
  return theme.methods[upperMethod] ?? theme.colors.textMuted;
}

/**
 * Get the color for an HTTP status code.
 */
export function getStatusColor(status: number): string {
  if (status >= 100 && status < 200) return theme.status['1xx'];
  if (status >= 200 && status < 300) return theme.status['2xx'];
  if (status >= 300 && status < 400) return theme.status['3xx'];
  if (status >= 400 && status < 500) return theme.status['4xx'];
  if (status >= 500) return theme.status['5xx'];
  return theme.colors.textMuted;
}

/**
 * Get the color for a log level.
 */
export function getLogLevelColor(level: string): string {
  const lowerLevel = level.toLowerCase() as LogLevel;
  return theme.logLevels[lowerLevel] ?? theme.colors.textMuted;
}
