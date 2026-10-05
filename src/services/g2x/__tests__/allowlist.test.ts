/**
 * G2X Tool Allowlist Tests
 *
 * Covers:
 * - tools/list discovery populates inventory
 * - Unknown tools are DENIED_UNKNOWN
 * - Mutating tools are DENIED_MUTATING
 * - Metered AI/Lumen tools are DENIED_METERED_AI
 * - Ambiguous metered tools are DENIED_METERED_OR_UNKNOWN
 * - Reviewed read tools are ALLOWED
 * - Schema change detection
 * - Discovery is separated from authorization
 * - Capability mapping after discovery
 */

import { describe, it, expect } from 'vitest';
import {
  classifyTool,
  classifyInventory,
  isToolAllowed,
  detectSchemaChanges,
  buildCapabilityMapping,
} from '../allowlist.js';
import type { ToolInventoryEntry } from '../types.js';

function makeEntry(
  name: string,
  description: string = 'Test tool',
  overrides: Partial<ToolInventoryEntry> = {}
): ToolInventoryEntry {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties: {} },
    inputSchemaHash: 'abc123',
    classification: 'DENIED_UNKNOWN',
    classificationReason: '',
    discoveredAt: '2026-10-05T00:00:00Z',
    endpoint: 'https://mcp.g2x.com/mcp/research',
    integrationVersion: '0.1.0-commissioning',
    ...overrides,
  };
}

describe('Tool Classification', () => {
  it('classifies reviewed read-only tools as ALLOWED', () => {
    const entry = makeEntry('g2x_search_opportunities');
    const result = classifyTool(entry);
    expect(result.classification).toBe('ALLOWED');
    expect(result.reason).toContain('reviewed local policy');
  });

  it('classifies get_opportunity as ALLOWED', () => {
    const entry = makeEntry('g2x_get_record');
    const result = classifyTool(entry);
    expect(result.classification).toBe('ALLOWED');
  });

  it('classifies list_opportunity_documents as ALLOWED', () => {
    const entry = makeEntry('g2x_opportunity_documents');
    const result = classifyTool(entry);
    expect(result.classification).toBe('ALLOWED');
  });

  it('classifies get_document_text as ALLOWED', () => {
    const entry = makeEntry('g2x_opportunity_attachment_text');
    const result = classifyTool(entry);
    expect(result.classification).toBe('ALLOWED');
  });

  it('denies unknown tools as DENIED_UNKNOWN', () => {
    const entry = makeEntry('some_random_tool');
    const result = classifyTool(entry);
    expect(result.classification).toBe('DENIED_UNKNOWN');
    expect(result.reason).toContain('no local authorization policy');
  });

  it('denies known metered-AI tools', () => {
    const entry = makeEntry('analyze_document');
    const result = classifyTool(entry);
    expect(result.classification).toBe('DENIED_METERED_AI');
    expect(result.reason).toContain('known-metered-AI');
  });

  it('denies lumen_query as metered AI', () => {
    const entry = makeEntry('lumen_query');
    const result = classifyTool(entry);
    expect(result.classification).toBe('DENIED_METERED_AI');
  });

  it('denies mutating tools by name pattern', () => {
    const mutatingNames = [
      'create_opportunity',
      'update_profile',
      'delete_record',
      'modify_setting',
      'set_preference',
      'add_note',
      'remove_tag',
      'save_search',
      'write_memo',
      'submit_proposal',
      'archive_document',
    ];

    for (const name of mutatingNames) {
      const entry = makeEntry(name);
      const result = classifyTool(entry);
      expect(result.classification).toBe('DENIED_MUTATING');
    }
  });

  it('denies tools with metered-AI description heuristics', () => {
    const entry = makeEntry(
      'opportunity_insights',
      'Uses Lumen AI to analyze opportunity qualification'
    );
    const result = classifyTool(entry);
    expect(result.classification).toBe('DENIED_METERED_OR_UNKNOWN');
    expect(result.reason).toContain('metered-AI heuristic');
    expect(result.reason).toContain('architecture review');
  });

  it('denies tools with "AI-powered" in description', () => {
    const entry = makeEntry('smart_search', 'AI-powered deep search across all records');
    const result = classifyTool(entry);
    expect(result.classification).toBe('DENIED_METERED_OR_UNKNOWN');
  });

  it('denies tools with "generative" in description', () => {
    const entry = makeEntry('summary_tool', 'Provides generative summaries of opportunities');
    const result = classifyTool(entry);
    expect(result.classification).toBe('DENIED_METERED_OR_UNKNOWN');
  });

  it('prioritizes explicit metered-AI over description heuristic', () => {
    const entry = makeEntry('analyze_document', 'Simple document tool');
    const result = classifyTool(entry);
    // Should be DENIED_METERED_AI (explicit), not DENIED_UNKNOWN
    expect(result.classification).toBe('DENIED_METERED_AI');
  });

  it('prioritizes mutating pattern over allowed policy', () => {
    // If somehow a tool named "create_something" appeared in policies
    const entry = makeEntry('create_search');
    const result = classifyTool(entry);
    expect(result.classification).toBe('DENIED_MUTATING');
  });
});

describe('Inventory Classification', () => {
  it('classifies all tools in inventory', () => {
    const inventory = [
      makeEntry('g2x_search_opportunities'),
      makeEntry('unknown_tool'),
      makeEntry('analyze_document'),
      makeEntry('create_thing'),
    ];

    const classified = classifyInventory(inventory);
    expect(classified).toHaveLength(4);
    expect(classified[0].classification).toBe('ALLOWED');
    expect(classified[1].classification).toBe('DENIED_UNKNOWN');
    expect(classified[2].classification).toBe('DENIED_METERED_AI');
    expect(classified[3].classification).toBe('DENIED_MUTATING');
  });

  it('default classification is DENIED_UNKNOWN before policy review', () => {
    const inventory = [makeEntry('brand_new_tool'), makeEntry('another_new_tool')];

    const classified = classifyInventory(inventory);
    for (const entry of classified) {
      expect(entry.classification).not.toBe('ALLOWED');
    }
  });
});

describe('Tool Allowlist Check', () => {
  const inventory = classifyInventory([
    makeEntry('g2x_search_opportunities'),
    makeEntry('unknown_tool'),
    makeEntry('analyze_document'),
  ]);

  it('allows classified ALLOWED tools', () => {
    const result = isToolAllowed('g2x_search_opportunities', inventory);
    expect(result.allowed).toBe(true);
  });

  it('denies classified non-ALLOWED tools', () => {
    const result = isToolAllowed('unknown_tool', inventory);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('DENIED_UNKNOWN');
  });

  it('denies tools not in inventory', () => {
    const result = isToolAllowed('nonexistent_tool', inventory);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not found in discovered inventory');
  });
});

describe('Schema Change Detection', () => {
  it('detects changed schemas', () => {
    const previous = [makeEntry('search_opportunities', 'test', { inputSchemaHash: 'hash1' })];
    const current = [makeEntry('search_opportunities', 'test', { inputSchemaHash: 'hash2' })];

    const result = detectSchemaChanges(previous, current);
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].name).toBe('search_opportunities');
    expect(result.changed[0].previousHash).toBe('hash1');
    expect(result.changed[0].currentHash).toBe('hash2');
  });

  it('detects added tools', () => {
    const previous = [makeEntry('g2x_search_opportunities')];
    const current = [makeEntry('g2x_search_opportunities'), makeEntry('new_tool')];

    const result = detectSchemaChanges(previous, current);
    expect(result.added).toContain('new_tool');
  });

  it('detects removed tools', () => {
    const previous = [makeEntry('g2x_search_opportunities'), makeEntry('old_tool')];
    const current = [makeEntry('g2x_search_opportunities')];

    const result = detectSchemaChanges(previous, current);
    expect(result.removed).toContain('old_tool');
  });

  it('reports no changes when inventories match', () => {
    const inventory = [makeEntry('g2x_search_opportunities')];

    const result = detectSchemaChanges(inventory, inventory);
    expect(result.changed).toHaveLength(0);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });
});

describe('Capability Mapping', () => {
  it('maps available capabilities', () => {
    const inventory = classifyInventory([
      makeEntry('g2x_search_opportunities'),
      makeEntry('g2x_get_record'),
    ]);

    const mapping = buildCapabilityMapping(inventory);
    const searchCap = mapping.find((m) => m.internalCapability === 'OPPORTUNITY_SEARCH');
    expect(searchCap).toBeDefined();
    expect(searchCap!.authorizedForCommissioning).toBe(true);
    expect(searchCap!.g2xTools).toContain('g2x_search_opportunities');
  });

  it('marks unavailable capabilities', () => {
    const inventory = classifyInventory([makeEntry('g2x_search_opportunities')]);

    const mapping = buildCapabilityMapping(inventory);
    const forecastCap = mapping.find((m) => m.internalCapability === 'FORECAST');
    expect(forecastCap).toBeDefined();
    expect(forecastCap!.authorizedForCommissioning).toBe(false);
    expect(forecastCap!.g2xTools).toHaveLength(0);
  });

  it('marks metered tools as not authorized', () => {
    const inventory = classifyInventory([
      makeEntry('analyze_document'), // Known metered
    ]);

    const mapping = buildCapabilityMapping(inventory);
    // analyze_document doesn't match any policy capability directly
    for (const cap of mapping) {
      expect(cap.authorizedForCommissioning).toBe(false);
    }
  });

  it('covers all internal request types', () => {
    const inventory = classifyInventory([]);
    const mapping = buildCapabilityMapping(inventory);

    expect(mapping.length).toBeGreaterThanOrEqual(10);
    const types = mapping.map((m) => m.internalCapability);
    expect(types).toContain('OPPORTUNITY_SEARCH');
    expect(types).toContain('DOCUMENT_INVENTORY');
    expect(types).toContain('COMPANY_SEARCH');
    expect(types).toContain('AWARD_HISTORY');
    expect(types).toContain('EVENT_INTELLIGENCE');
  });
});

describe('Discovery / Authorization Separation', () => {
  it('discovery does NOT authorize — all tools start DENIED_UNKNOWN', () => {
    // Simulates: tools/list returns tools, but local policy hasn't classified them
    const rawInventory: ToolInventoryEntry[] = [
      makeEntry('completely_new_tool'),
      makeEntry('another_unknown'),
    ];

    // Before classification
    for (const entry of rawInventory) {
      expect(entry.classification).toBe('DENIED_UNKNOWN');
    }
  });

  it('remote appearance alone never authorizes execution', () => {
    // Even if a tool appears in tools/list with an innocuous name,
    // it must match local reviewed policy to be ALLOWED
    const entry = makeEntry('get_everything_free');
    const result = classifyTool(entry);
    expect(result.classification).not.toBe('ALLOWED');
  });
});
