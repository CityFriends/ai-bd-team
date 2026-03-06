import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { metrics, MetricNames, timeAsync, timeSync } from '../metrics.js';

describe('metrics module', () => {
  beforeEach(() => {
    // Reset metrics before each test
    metrics.reset();
  });

  describe('counters', () => {
    it('should increment a counter', () => {
      metrics.increment('test.counter');
      metrics.increment('test.counter');
      metrics.increment('test.counter');

      expect(metrics.getCounter('test.counter')).toBe(3);
    });

    it('should increment by custom value', () => {
      metrics.increment('test.counter', {}, 5);
      metrics.increment('test.counter', {}, 10);

      expect(metrics.getCounter('test.counter')).toBe(15);
    });

    it('should track counters with different labels separately', () => {
      metrics.increment('api.calls', { endpoint: 'sam.gov' });
      metrics.increment('api.calls', { endpoint: 'sam.gov' });
      metrics.increment('api.calls', { endpoint: 'usaspending' });

      expect(metrics.getCounter('api.calls', { endpoint: 'sam.gov' })).toBe(2);
      expect(metrics.getCounter('api.calls', { endpoint: 'usaspending' })).toBe(1);
    });

    it('should return 0 for non-existent counters', () => {
      expect(metrics.getCounter('non.existent')).toBe(0);
    });
  });

  describe('gauges', () => {
    it('should set a gauge value', () => {
      metrics.gauge('queue.depth', 5);

      expect(metrics.getGauge('queue.depth')).toBe(5);
    });

    it('should overwrite gauge value', () => {
      metrics.gauge('queue.depth', 5);
      metrics.gauge('queue.depth', 10);

      expect(metrics.getGauge('queue.depth')).toBe(10);
    });

    it('should track gauges with different labels separately', () => {
      metrics.gauge('queue.depth', 5, { agent: 'maya' });
      metrics.gauge('queue.depth', 10, { agent: 'david' });

      expect(metrics.getGauge('queue.depth', { agent: 'maya' })).toBe(5);
      expect(metrics.getGauge('queue.depth', { agent: 'david' })).toBe(10);
    });

    it('should return 0 for non-existent gauges', () => {
      expect(metrics.getGauge('non.existent')).toBe(0);
    });
  });

  describe('histograms/timing', () => {
    it('should record timing values', () => {
      metrics.timing('api.latency', 100);
      metrics.timing('api.latency', 200);
      metrics.timing('api.latency', 150);

      const summary = metrics.getSummary();
      const histogram = summary.histograms['api.latency'][0];

      expect(histogram.count).toBe(3);
      expect(histogram.sum).toBe(450);
      expect(histogram.avg).toBe(150);
      expect(histogram.min).toBe(100);
      expect(histogram.max).toBe(200);
    });

    it('should track timing with different labels', () => {
      metrics.timing('api.latency', 100, { endpoint: 'sam.gov' });
      metrics.timing('api.latency', 500, { endpoint: 'usaspending' });

      const summary = metrics.getSummary();
      const histograms = summary.histograms['api.latency'];

      expect(histograms.length).toBe(2);

      const samGov = histograms.find((h) => h.labels.endpoint === 'sam.gov');
      const usaspending = histograms.find((h) => h.labels.endpoint === 'usaspending');

      expect(samGov?.avg).toBe(100);
      expect(usaspending?.avg).toBe(500);
    });

    it('should calculate percentiles correctly', () => {
      // Add values across different buckets
      for (let i = 0; i < 100; i++) {
        metrics.timing('test.latency', i * 10); // 0, 10, 20, ... 990
      }

      const summary = metrics.getSummary();
      const histogram = summary.histograms['test.latency'][0];

      // p50 should be around 500ms (bucket 500)
      expect(histogram.p50).toBeLessThanOrEqual(500);
      // p95 should be around 950ms (bucket 1000 or 500 depending on distribution)
      expect(histogram.p95).toBeGreaterThanOrEqual(500);
    });
  });

  describe('getSummary', () => {
    it('should return complete summary', () => {
      metrics.increment('test.counter', { type: 'a' }, 5);
      metrics.gauge('test.gauge', 10);
      metrics.timing('test.timing', 100);

      const summary = metrics.getSummary();

      expect(summary.uptime).toBeGreaterThanOrEqual(0);
      expect(summary.counters['test.counter'].total).toBe(5);
      expect(summary.gauges['test.gauge'].value).toBe(10);
      expect(summary.histograms['test.timing'][0].count).toBe(1);
    });

    it('should aggregate counters by label', () => {
      metrics.increment('test.counter', { type: 'a' }, 2);
      metrics.increment('test.counter', { type: 'b' }, 3);

      const summary = metrics.getSummary();

      expect(summary.counters['test.counter'].total).toBe(5);
      expect(summary.counters['test.counter'].byLabel.length).toBe(2);
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      metrics.increment('test.counter');
      metrics.gauge('test.gauge', 10);
      metrics.timing('test.timing', 100);

      metrics.reset();

      expect(metrics.getCounter('test.counter')).toBe(0);
      expect(metrics.getGauge('test.gauge')).toBe(0);

      const summary = metrics.getSummary();
      expect(Object.keys(summary.counters).length).toBe(0);
      expect(Object.keys(summary.gauges).length).toBe(0);
      expect(Object.keys(summary.histograms).length).toBe(0);
    });
  });

  describe('MetricNames', () => {
    it('should have pre-defined metric names', () => {
      expect(MetricNames.API_CALLS).toBe('api.calls');
      expect(MetricNames.CLAUDE_TOKENS_INPUT).toBe('claude.tokens.input');
      expect(MetricNames.AGENT_LATENCY).toBe('agent.latency_ms');
      expect(MetricNames.CACHE_HITS).toBe('cache.hits');
    });
  });

  describe('timeAsync', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should time async operations', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 'result';
      });

      const resultPromise = timeAsync('test.operation', fn, { type: 'test' });

      await vi.advanceTimersByTimeAsync(100);
      const result = await resultPromise;

      expect(result).toBe('result');

      const summary = metrics.getSummary();
      expect(summary.histograms['test.operation']).toBeDefined();
      expect(summary.histograms['test.operation'][0].count).toBe(1);
    });

    it('should record timing even on error', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        throw new Error('test error');
      });

      await expect(timeAsync('test.operation', fn)).rejects.toThrow('test error');

      const summary = metrics.getSummary();
      expect(summary.histograms['test.operation'][0].count).toBe(1);
    });
  });

  describe('timeSync', () => {
    it('should time sync operations', () => {
      const fn = vi.fn().mockReturnValue('result');

      const result = timeSync('test.sync', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);

      const summary = metrics.getSummary();
      expect(summary.histograms['test.sync']).toBeDefined();
    });

    it('should record timing even on error', () => {
      const fn = vi.fn().mockImplementation(() => {
        throw new Error('sync error');
      });

      expect(() => timeSync('test.sync', fn)).toThrow('sync error');

      const summary = metrics.getSummary();
      expect(summary.histograms['test.sync'][0].count).toBe(1);
    });
  });

  describe('label handling', () => {
    it('should handle labels with different value types', () => {
      metrics.increment('test', { str: 'value', num: 123, bool: true });
      metrics.increment('test', { str: 'value', num: 123, bool: true });

      expect(metrics.getCounter('test', { str: 'value', num: 123, bool: true })).toBe(2);
    });

    it('should treat different label orders as same', () => {
      metrics.increment('test', { a: '1', b: '2' });
      metrics.increment('test', { b: '2', a: '1' });

      // Labels should be sorted, so both increments go to same counter
      expect(metrics.getCounter('test', { a: '1', b: '2' })).toBe(2);
    });
  });
});
