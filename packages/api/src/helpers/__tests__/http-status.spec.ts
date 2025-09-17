import { describe, expect, it } from 'vitest';
import { isSuccessStatus } from '../http-status';

describe('isSuccessStatus', () => {
  it('should return true for 2xx status codes', () => {
    expect(isSuccessStatus(200)).toBe(true);
    expect(isSuccessStatus(201)).toBe(true);
    expect(isSuccessStatus(202)).toBe(true);
    expect(isSuccessStatus(204)).toBe(true);
    expect(isSuccessStatus(299)).toBe(true);
  });

  it('should return false for 1xx status codes', () => {
    expect(isSuccessStatus(100)).toBe(false);
    expect(isSuccessStatus(199)).toBe(false);
  });

  it('should return false for 3xx status codes', () => {
    expect(isSuccessStatus(300)).toBe(false);
    expect(isSuccessStatus(301)).toBe(false);
    expect(isSuccessStatus(302)).toBe(false);
    expect(isSuccessStatus(399)).toBe(false);
  });

  it('should return false for 4xx status codes', () => {
    expect(isSuccessStatus(400)).toBe(false);
    expect(isSuccessStatus(401)).toBe(false);
    expect(isSuccessStatus(404)).toBe(false);
    expect(isSuccessStatus(499)).toBe(false);
  });

  it('should return false for 5xx status codes', () => {
    expect(isSuccessStatus(500)).toBe(false);
    expect(isSuccessStatus(501)).toBe(false);
    expect(isSuccessStatus(502)).toBe(false);
    expect(isSuccessStatus(599)).toBe(false);
  });

  it('should handle edge cases', () => {
    expect(isSuccessStatus(199.9)).toBe(false);
    expect(isSuccessStatus(200.1)).toBe(true);
    expect(isSuccessStatus(299.9)).toBe(true);
    expect(isSuccessStatus(300.1)).toBe(false);
  });
});
