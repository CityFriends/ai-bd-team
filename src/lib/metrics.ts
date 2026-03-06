/**
 * Metrics Library for AI BD Team
 *
 * Provides counters, gauges, and histograms for tracking system metrics.
 * Currently stores metrics in-memory with periodic logging.
 * Can be extended to export to Prometheus, StatsD, or other backends.
 *
 * Usage:
 *   import { metrics } from '../lib/metrics.js';
 *   metrics.increment('api.calls', { endpoint: 'sam.gov' });
 *   metrics.timing('agent.response_time', 1234, { agent: 'maya' });
 *   metrics.gauge('queue.depth', 5);
 */

import { logger } from './logger.js';

// ============================================================
// Types
// ============================================================

export interface MetricLabels {
  [key: string]: string | number | boolean;
}

interface CounterData {
  value: number;
  labels: MetricLabels;
  lastUpdated: Date;
}

interface GaugeData {
  value: number;
  labels: MetricLabels;
  lastUpdated: Date;
}

interface HistogramData {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: Map<number, number>; // bucket upper bound -> count
  labels: MetricLabels;
  lastUpdated: Date;
}

// ============================================================
// Metrics Store
// ============================================================

class MetricsStore {
  private counters: Map<string, CounterData[]> = new Map();
  private gauges: Map<string, GaugeData> = new Map();
  private histograms: Map<string, HistogramData[]> = new Map();
  private startTime: Date = new Date();

  // Default histogram buckets (in milliseconds for timing)
  private defaultBuckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  /**
   * Increment a counter
   */
  increment(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const key = this.labelsToKey(labels);
    const counters = this.counters.get(name) || [];

    const existing = counters.find((c) => this.labelsToKey(c.labels) === key);
    if (existing) {
      existing.value += value;
      existing.lastUpdated = new Date();
    } else {
      counters.push({ value, labels, lastUpdated: new Date() });
    }

    this.counters.set(name, counters);
  }

  /**
   * Set a gauge value
   */
  gauge(name: string, value: number, labels: MetricLabels = {}): void {
    const key = `${name}:${this.labelsToKey(labels)}`;
    this.gauges.set(key, { value, labels, lastUpdated: new Date() });
  }

  /**
   * Record a timing/histogram value
   */
  timing(name: string, valueMs: number, labels: MetricLabels = {}): void {
    this.histogram(name, valueMs, labels);
  }

  /**
   * Record a histogram observation
   */
  histogram(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.labelsToKey(labels);
    const histograms = this.histograms.get(name) || [];

    let existing = histograms.find((h) => this.labelsToKey(h.labels) === key);
    if (!existing) {
      existing = {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        buckets: new Map(this.defaultBuckets.map((b) => [b, 0])),
        labels,
        lastUpdated: new Date(),
      };
      histograms.push(existing);
    }

    existing.count++;
    existing.sum += value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
    existing.lastUpdated = new Date();

    // Update buckets
    for (const bucket of this.defaultBuckets) {
      if (value <= bucket) {
        existing.buckets.set(bucket, (existing.buckets.get(bucket) || 0) + 1);
      }
    }

    this.histograms.set(name, histograms);
  }

  /**
   * Get all metrics as a summary object
   */
  getSummary(): {
    uptime: number;
    counters: Record<
      string,
      { total: number; byLabel: Array<{ labels: MetricLabels; value: number }> }
    >;
    gauges: Record<string, { value: number; labels: MetricLabels }>;
    histograms: Record<
      string,
      Array<{
        labels: MetricLabels;
        count: number;
        sum: number;
        avg: number;
        min: number;
        max: number;
        p50: number;
        p95: number;
        p99: number;
      }>
    >;
  } {
    const uptimeMs = Date.now() - this.startTime.getTime();

    // Summarize counters
    const counterSummary: Record<
      string,
      { total: number; byLabel: Array<{ labels: MetricLabels; value: number }> }
    > = {};
    for (const [name, counters] of this.counters) {
      counterSummary[name] = {
        total: counters.reduce((sum, c) => sum + c.value, 0),
        byLabel: counters.map((c) => ({ labels: c.labels, value: c.value })),
      };
    }

    // Summarize gauges
    const gaugeSummary: Record<string, { value: number; labels: MetricLabels }> = {};
    for (const [key, gauge] of this.gauges) {
      const name = key.split(':')[0];
      gaugeSummary[name] = { value: gauge.value, labels: gauge.labels };
    }

    // Summarize histograms with percentiles
    const histogramSummary: Record<
      string,
      Array<{
        labels: MetricLabels;
        count: number;
        sum: number;
        avg: number;
        min: number;
        max: number;
        p50: number;
        p95: number;
        p99: number;
      }>
    > = {};

    for (const [name, histograms] of this.histograms) {
      histogramSummary[name] = histograms.map((h) => ({
        labels: h.labels,
        count: h.count,
        sum: h.sum,
        avg: h.count > 0 ? h.sum / h.count : 0,
        min: h.min === Infinity ? 0 : h.min,
        max: h.max === -Infinity ? 0 : h.max,
        p50: this.estimatePercentile(h, 50),
        p95: this.estimatePercentile(h, 95),
        p99: this.estimatePercentile(h, 99),
      }));
    }

    return {
      uptime: uptimeMs,
      counters: counterSummary,
      gauges: gaugeSummary,
      histograms: histogramSummary,
    };
  }

  /**
   * Log current metrics summary
   */
  logSummary(): void {
    const summary = this.getSummary();
    logger.info(
      {
        metrics: summary,
        uptimeHours: (summary.uptime / (1000 * 60 * 60)).toFixed(2),
      },
      'Metrics summary'
    );
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = new Date();
  }

  /**
   * Get a specific counter value
   */
  getCounter(name: string, labels: MetricLabels = {}): number {
    const counters = this.counters.get(name) || [];
    const key = this.labelsToKey(labels);
    const counter = counters.find((c) => this.labelsToKey(c.labels) === key);
    return counter?.value || 0;
  }

  /**
   * Get a specific gauge value
   */
  getGauge(name: string, labels: MetricLabels = {}): number {
    const key = `${name}:${this.labelsToKey(labels)}`;
    return this.gauges.get(key)?.value || 0;
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private labelsToKey(labels: MetricLabels): string {
    const sortedKeys = Object.keys(labels).sort();
    return sortedKeys.map((k) => `${k}=${labels[k]}`).join(',');
  }

  private estimatePercentile(h: HistogramData, percentile: number): number {
    if (h.count === 0) return 0;

    const target = (percentile / 100) * h.count;
    let cumulative = 0;

    const sortedBuckets = Array.from(h.buckets.entries()).sort((a, b) => a[0] - b[0]);

    for (const [bucket, count] of sortedBuckets) {
      cumulative += count;
      if (cumulative >= target) {
        return bucket;
      }
    }

    return h.max;
  }
}

// ============================================================
// Singleton Instance
// ============================================================

export const metrics = new MetricsStore();

// ============================================================
// Pre-defined Metric Names (for consistency)
// ============================================================

export const MetricNames = {
  // API calls
  API_CALLS: 'api.calls',
  API_ERRORS: 'api.errors',
  API_LATENCY: 'api.latency_ms',

  // Claude API
  CLAUDE_CALLS: 'claude.calls',
  CLAUDE_TOKENS_INPUT: 'claude.tokens.input',
  CLAUDE_TOKENS_OUTPUT: 'claude.tokens.output',
  CLAUDE_LATENCY: 'claude.latency_ms',
  CLAUDE_ERRORS: 'claude.errors',

  // Cache
  CACHE_HITS: 'cache.hits',
  CACHE_MISSES: 'cache.misses',

  // Agent execution
  AGENT_CALLS: 'agent.calls',
  AGENT_LATENCY: 'agent.latency_ms',
  AGENT_TOOL_CALLS: 'agent.tool_calls',
  AGENT_ITERATIONS: 'agent.iterations',
  AGENT_ERRORS: 'agent.errors',

  // Tools
  TOOL_CALLS: 'tool.calls',
  TOOL_LATENCY: 'tool.latency_ms',
  TOOL_ERRORS: 'tool.errors',

  // Events
  EVENT_PUBLISHED: 'event.published',
  EVENT_PROCESSED: 'event.processed',
  EVENT_FAILED: 'event.failed',
} as const;

// ============================================================
// Convenience Functions
// ============================================================

/**
 * Time an async operation and record to histogram
 */
export async function timeAsync<T>(
  name: string,
  fn: () => Promise<T>,
  labels: MetricLabels = {}
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    metrics.timing(name, Date.now() - start, labels);
  }
}

/**
 * Time a sync operation and record to histogram
 */
export function timeSync<T>(name: string, fn: () => T, labels: MetricLabels = {}): T {
  const start = Date.now();
  try {
    return fn();
  } finally {
    metrics.timing(name, Date.now() - start, labels);
  }
}

// Note: MetricLabels is already exported as an interface above
// CounterData, GaugeData, HistogramData are internal types used by the class
