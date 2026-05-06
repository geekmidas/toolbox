import { describe, expect, it } from 'vitest';
import {
	getPublicEnvPrefix,
	PUBLIC_ENV_PREFIXES,
	stripPublicPrefix,
} from '../publicEnv.ts';

describe('getPublicEnvPrefix', () => {
	it('returns NEXT_PUBLIC_ for nextjs', () => {
		expect(getPublicEnvPrefix('nextjs')).toBe('NEXT_PUBLIC_');
	});

	it('returns VITE_ for vite', () => {
		expect(getPublicEnvPrefix('vite')).toBe('VITE_');
	});

	it('returns VITE_ for tanstack-start', () => {
		expect(getPublicEnvPrefix('tanstack-start')).toBe('VITE_');
	});

	it('returns EXPO_PUBLIC_ for expo', () => {
		expect(getPublicEnvPrefix('expo')).toBe('EXPO_PUBLIC_');
	});

	it('returns empty string for remix', () => {
		expect(getPublicEnvPrefix('remix')).toBe('');
	});

	it('falls back to NEXT_PUBLIC_ when framework is undefined', () => {
		expect(getPublicEnvPrefix(undefined)).toBe('NEXT_PUBLIC_');
	});

	it('falls back to NEXT_PUBLIC_ for backend frameworks', () => {
		expect(getPublicEnvPrefix('hono')).toBe('NEXT_PUBLIC_');
		expect(getPublicEnvPrefix('better-auth')).toBe('NEXT_PUBLIC_');
	});
});

describe('stripPublicPrefix', () => {
	it('strips NEXT_PUBLIC_', () => {
		expect(stripPublicPrefix('NEXT_PUBLIC_AUTH_URL')).toBe('AUTH_URL');
	});

	it('strips VITE_', () => {
		expect(stripPublicPrefix('VITE_API_URL')).toBe('API_URL');
	});

	it('strips EXPO_PUBLIC_', () => {
		expect(stripPublicPrefix('EXPO_PUBLIC_API_URL')).toBe('API_URL');
	});

	it('returns null when no known prefix matches', () => {
		expect(stripPublicPrefix('AUTH_URL')).toBeNull();
		expect(stripPublicPrefix('REACT_APP_FOO')).toBeNull();
	});
});

describe('PUBLIC_ENV_PREFIXES', () => {
	it('exposes NEXT_PUBLIC_, VITE_, and EXPO_PUBLIC_', () => {
		expect(PUBLIC_ENV_PREFIXES).toContain('NEXT_PUBLIC_');
		expect(PUBLIC_ENV_PREFIXES).toContain('VITE_');
		expect(PUBLIC_ENV_PREFIXES).toContain('EXPO_PUBLIC_');
	});
});
