import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  categorizeError,
  isRetryable,
  withRetry,
  ErrorCategory,
  TimeoutError,
  RateLimitError,
  ApiError,
  sleep,
  wrapError,
} from '../errors.js';

describe('errors module', () => {
  describe('categorizeError', () => {
    describe('transient errors', () => {
      it('should categorize timeout errors as transient', () => {
        const error = new Error('Connection timeout');
        const result = categorizeError(error);

        expect(result.category).toBe(ErrorCategory.TRANSIENT);
        expect(result.retryable).toBe(true);
      });

      it('should categorize network errors as transient', () => {
        const errors = [
          new Error('ECONNRESET'),
          new Error('ECONNREFUSED'),
          new Error('ETIMEDOUT'),
          new Error('socket hang up'),
          new Error('network error'),
        ];

        for (const error of errors) {
          const result = categorizeError(error);
          expect(result.category).toBe(ErrorCategory.TRANSIENT);
          expect(result.retryable).toBe(true);
        }
      });

      it('should categorize rate limit errors as transient', () => {
        const errors = [
          new Error('Rate limit exceeded'),
          new Error('Too many requests'),
          new Error('429 Too Many Requests'),
        ];

        for (const error of errors) {
          const result = categorizeError(error);
          expect(result.category).toBe(ErrorCategory.TRANSIENT);
          expect(result.retryable).toBe(true);
        }
      });

      it('should categorize 5xx errors as transient', () => {
        const errors = [
          new Error('503 Service Unavailable'),
          new Error('502 Bad Gateway'),
          new Error('504 Gateway Timeout'),
        ];

        for (const error of errors) {
          const result = categorizeError(error);
          expect(result.category).toBe(ErrorCategory.TRANSIENT);
        }
      });
    });

    describe('permanent errors', () => {
      it('should categorize auth errors as permanent', () => {
        const errors = [
          new Error('Unauthorized'),
          new Error('Forbidden'),
          new Error('Authentication failed'),
          new Error('Permission denied'),
        ];

        for (const error of errors) {
          const result = categorizeError(error);
          expect(result.category).toBe(ErrorCategory.PERMANENT);
          expect(result.retryable).toBe(false);
        }
      });

      it('should categorize not found errors as permanent', () => {
        const error = new Error('404 Not Found');
        const result = categorizeError(error);

        expect(result.category).toBe(ErrorCategory.PERMANENT);
        expect(result.retryable).toBe(false);
      });

      it('should categorize invalid parameter errors as permanent', () => {
        const errors = [
          new Error('Invalid parameter'),
          new Error('Invalid API key'),
          new Error('Invalid token'),
          new Error('Bad request'),
        ];

        for (const error of errors) {
          const result = categorizeError(error);
          expect(result.category).toBe(ErrorCategory.PERMANENT);
        }
      });
    });

    describe('unknown errors', () => {
      it('should categorize unknown errors with caution', () => {
        const error = new Error('Something weird happened');
        const result = categorizeError(error);

        expect(result.category).toBe(ErrorCategory.UNKNOWN);
        expect(result.retryable).toBe(true); // Allow one retry for unknown
      });
    });

    describe('status code extraction', () => {
      it('should extract status code from error properties', () => {
        const error = new Error('API Error') as Error & { statusCode: number };
        error.statusCode = 503;
        const result = categorizeError(error);

        expect(result.statusCode).toBe(503);
        expect(result.category).toBe(ErrorCategory.TRANSIENT);
      });

      it('should extract status code from error message', () => {
        const error = new Error('Request failed with status 404');
        const result = categorizeError(error);

        expect(result.statusCode).toBe(404);
      });
    });

    it('should handle non-Error objects', () => {
      const result = categorizeError('string error');
      expect(result.message).toBe('string error');
      expect(result.originalError).toBeInstanceOf(Error);
    });
  });

  describe('isRetryable', () => {
    it('should return true for transient errors', () => {
      expect(isRetryable(new Error('timeout'))).toBe(true);
      expect(isRetryable(new Error('network error'))).toBe(true);
    });

    it('should return false for permanent errors', () => {
      expect(isRetryable(new Error('401 Unauthorized'))).toBe(false);
      expect(isRetryable(new Error('404 Not Found'))).toBe(false);
    });

    it('should return true for unknown errors (cautious retry)', () => {
      expect(isRetryable(new Error('weird error'))).toBe(true);
    });
  });

  describe('withRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const resultPromise = withRetry(fn, { maxRetries: 3 });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient errors', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue('success');

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        jitter: false,
      });

      // Advance through retries
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(200);
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry permanent errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));

      // Permanent errors should fail immediately without retry
      await expect(withRetry(fn, { maxRetries: 3 })).rejects.toThrow('401 Unauthorized');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect maxRetries limit', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('timeout'));

      // Start the promise and immediately attach the rejection handler
      const promise = withRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 100,
        jitter: false,
      }).catch((e) => e); // Catch to prevent unhandled rejection

      // Advance through all retries and run to completion
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('timeout');
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should call onRetry callback', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('success');

      const onRetry = vi.fn();

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        jitter: false,
        onRetry,
      });

      await vi.advanceTimersByTimeAsync(100);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({ category: ErrorCategory.TRANSIENT }),
        1,
        100
      );
    });

    it('should apply exponential backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue('success');

      const resultPromise = withRetry(fn, {
        maxRetries: 3,
        initialDelayMs: 100,
        backoffMultiplier: 2,
        jitter: false,
      });

      // First retry after 100ms
      await vi.advanceTimersByTimeAsync(100);
      expect(fn).toHaveBeenCalledTimes(2);

      // Second retry after 200ms (100 * 2)
      await vi.advanceTimersByTimeAsync(200);
      expect(fn).toHaveBeenCalledTimes(3);

      await vi.runAllTimersAsync();
      await resultPromise;
    });

    it('should respect retryOn filter', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('some unknown error'));

      // Unknown errors not in retryOn, so should fail immediately
      await expect(
        withRetry(fn, {
          maxRetries: 3,
          retryOn: [ErrorCategory.TRANSIENT], // Only retry transient
        })
      ).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should sleep for specified duration', async () => {
      const sleepPromise = sleep(1000);

      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(1000);
      await sleepPromise;
    });
  });

  describe('wrapError', () => {
    it('should add context to error', () => {
      const error = new Error('timeout');
      const wrapped = wrapError(error, { operation: 'fetch', url: 'https://api.example.com' });

      expect(wrapped.context).toMatchObject({
        operation: 'fetch',
        url: 'https://api.example.com',
      });
      expect(wrapped.category).toBe(ErrorCategory.TRANSIENT);
    });

    it('should allow custom message', () => {
      const error = new Error('original message');
      const wrapped = wrapError(error, {}, 'custom message');

      expect(wrapped.message).toBe('custom message');
    });
  });

  describe('custom error types', () => {
    describe('TimeoutError', () => {
      it('should create with operation and timeout', () => {
        const error = new TimeoutError('fetchData', 5000);

        expect(error.name).toBe('TimeoutError');
        expect(error.message).toBe('fetchData timed out after 5000ms');
      });

      it('should be categorized as transient', () => {
        const error = new TimeoutError('operation', 1000);
        const categorized = categorizeError(error);

        expect(categorized.category).toBe(ErrorCategory.TRANSIENT);
      });
    });

    describe('RateLimitError', () => {
      it('should create with message and optional retryAfter', () => {
        const error = new RateLimitError('Rate limit exceeded', 60);

        expect(error.name).toBe('RateLimitError');
        expect(error.message).toBe('Rate limit exceeded');
        expect(error.retryAfter).toBe(60);
      });

      it('should be categorized as transient', () => {
        const error = new RateLimitError('Too many requests');
        const categorized = categorizeError(error);

        expect(categorized.category).toBe(ErrorCategory.TRANSIENT);
      });
    });

    describe('ApiError', () => {
      it('should create with message, status code, and response', () => {
        const error = new ApiError('Not Found', 404, { error: 'Resource not found' });

        expect(error.name).toBe('ApiError');
        expect(error.message).toBe('Not Found');
        expect(error.statusCode).toBe(404);
        expect(error.response).toEqual({ error: 'Resource not found' });
      });

      it('should be categorized based on status code', () => {
        const notFound = new ApiError('Not Found', 404);
        expect(categorizeError(notFound).category).toBe(ErrorCategory.PERMANENT);

        const serverError = new ApiError('Server Error', 503);
        expect(categorizeError(serverError).category).toBe(ErrorCategory.TRANSIENT);
      });
    });
  });
});
