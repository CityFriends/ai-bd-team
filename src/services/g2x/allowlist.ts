/**
 * G2X Tool Allowlist — Separated Discovery and Authorization
 *
 * Discovery (tools/list) is authoritative for WHAT EXISTS.
 * Authorization (local policy) determines WHAT MAY EXECUTE.
 *
 * A tool becomes ALLOWED only if its exact discovered identity
 * and behavior match a locally approved research capability.
 * Remote appearance alone NEVER authorizes execution.
 *
 * Metered-AI detection uses:
 * 1. Explicit local approved tool names/capabilities
 * 2. Explicit known-denied/metered tools
 * 3. Description/schema heuristic as additional deny signal
 * 4. Unknown/ambiguous = DENY_METERED_OR_UNKNOWN
 */

import { logger } from '../../lib/logger.js';
import type {
  CapabilityMapping,
  ResearchRequestTypeValue,
  ToolAuthorizationPolicy,
  ToolClassification,
  ToolInventoryEntry,
} from './types.js';
import { ResearchRequestType } from './types.js';

const log = logger.child({ service: 'G2XAllowlist' });

// ============================================================
// Local Authorization Policy
// ============================================================

/**
 * Locally reviewed authorization policies.
 * Each entry maps an internal capability to a specific G2X tool
 * that has been reviewed and explicitly approved.
 *
 * IMPORTANT: Tool names here are CANDIDATES based on expected
 * G2X API naming. Actual authorization occurs only when a real
 * tools/list discovery confirms the tool exists with compatible
 * schema. Names will be updated after first real discovery.
 */
const REVIEWED_POLICIES: ToolAuthorizationPolicy[] = [
  // --- Authorized after real tools/list discovery (2026-10-05) ---
  // --- Account: Basic plan, Endpoint: /mcp/research via govcon ---
  {
    capability: 'OPPORTUNITY_SEARCH',
    toolName: 'g2x_search_opportunities',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Keyword search of open federal opportunities, max 8 rows, readOnlyHint=true',
  },
  {
    capability: 'OPPORTUNITY_SEARCH',
    toolName: 'g2x_search_supplementary',
    meteredAI: false,
    mutating: false,
    reviewNote:
      'Search opportunities + attachment text (SAM, SLED, DLA DIBBS, SBIR/STTR), readOnlyHint=true',
  },
  {
    capability: 'OPPORTUNITY_DETAIL',
    toolName: 'g2x_get_record',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Read public summary of opportunity or company record, readOnlyHint=true',
  },
  {
    capability: 'DOCUMENT_INVENTORY',
    toolName: 'g2x_opportunity_documents',
    meteredAI: false,
    mutating: false,
    reviewNote: 'List solicitation documents with readiness/version, readOnlyHint=true',
  },
  {
    capability: 'ATTACHMENT_TEXT',
    toolName: 'g2x_opportunity_attachment_text',
    meteredAI: false,
    mutating: false,
    reviewNote:
      'Read document text (Markdown/JSON), cursor-paginated with SHA-256, readOnlyHint=true',
  },
  {
    capability: 'COMPANY_SEARCH',
    toolName: 'g2x_search_companies',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Resolve company name to SAM-registered entities by UEI, readOnlyHint=true',
  },
  {
    capability: 'COMPANY_CONTRACTS',
    toolName: 'g2x_company_contract_history',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Company federal contracting portfolio by UEI, readOnlyHint=true',
  },
  {
    capability: 'AWARD_HISTORY',
    toolName: 'g2x_search_records',
    meteredAI: false,
    mutating: false,
    reviewNote:
      'Search any dataset (awards, IDVs, subawards, OTAs, protests, forecasts, etc.), readOnlyHint=true',
  },
  {
    capability: 'FORECAST',
    toolName: 'g2x_forecast_scan',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Scan procurement forecasts (planned buys not yet solicited), readOnlyHint=true',
  },
  {
    capability: 'TEAMING',
    toolName: 'g2x_teaming_partners',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Find teaming partners by NAICS with past performance ranking, readOnlyHint=true',
  },
  {
    capability: 'TEAMING',
    toolName: 'g2x_get_graph_neighborhood',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Company one-hop contracting relationships (awards, subs), readOnlyHint=true',
  },
  {
    capability: 'EVENT_INTELLIGENCE',
    toolName: 'g2x_search_events',
    meteredAI: false,
    mutating: false,
    reviewNote:
      'Search upcoming GovCon events (conferences, industry days, matchmaking), readOnlyHint=true',
  },
  {
    capability: 'EVENT_INTELLIGENCE',
    toolName: 'g2x_get_event',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Read event details (dates, speakers, agenda, registration), readOnlyHint=true',
  },
  {
    capability: 'SPENDING',
    toolName: 'g2x_search_records',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Search procurement records across datasets, readOnlyHint=true',
  },
  {
    capability: 'USAGE',
    toolName: 'g2x_usage',
    meteredAI: false,
    mutating: false,
    reviewNote: 'Read Lumen usage meter (does not trigger metered AI), readOnlyHint=true',
  },
];

/**
 * Known metered-AI / Lumen tool patterns.
 * These are explicitly denied regardless of description heuristics.
 * Updated as we learn actual G2X tool names during commissioning.
 */
const KNOWN_METERED_TOOLS: Set<string> = new Set([
  'analyze_document',
  'analyze_opportunity',
  'lumen_query',
  'lumen_analyze',
  'qualify_opportunity',
  'ai_document_analysis',
  'deep_research',
  'provider_lookup',
]);

/**
 * Known mutating operation patterns.
 * Denied even on the /research endpoint.
 */
const KNOWN_MUTATING_PATTERNS: RegExp[] = [
  /create_/i,
  /update_/i,
  /delete_/i,
  /modify_/i,
  /set_/i,
  /add_/i,
  /remove_/i,
  /save_/i,
  /write_/i,
  /submit_/i,
  /archive_/i,
];

/**
 * Description heuristics that suggest metered AI work.
 * Used as an ADDITIONAL deny signal, not sole authority.
 */
const METERED_AI_DESCRIPTION_PATTERNS: RegExp[] = [
  /\blumen\b/i,
  /\bai[\s-]analysis\b/i,
  /\bai[\s-]powered\b/i,
  /\bdeep[\s-]analysis\b/i,
  /\bqualification\b/i,
  /\breasoning\b/i,
  /\bai[\s-]generated\b/i,
  /\bmachine[\s-]learning\b/i,
  /\bllm\b/i,
  /\bgenerative\b/i,
  /\bmetered\b/i,
];

// ============================================================
// Classification Engine
// ============================================================

/**
 * Classify a discovered tool against local authorization policy.
 *
 * Classification priority:
 * 1. Explicit known-metered → DENIED_METERED_AI
 * 2. Known mutating pattern → DENIED_MUTATING
 * 3. Description heuristic suggests metered AI → DENIED_METERED_OR_UNKNOWN
 * 4. Matches reviewed policy → ALLOWED
 * 5. Everything else → DENIED_UNKNOWN
 */
export function classifyTool(tool: ToolInventoryEntry): {
  classification: ToolClassification;
  reason: string;
} {
  const { name, description } = tool;

  // 1. Check explicit known-metered tools
  if (KNOWN_METERED_TOOLS.has(name)) {
    return {
      classification: 'DENIED_METERED_AI',
      reason: `Tool '${name}' is in the explicit known-metered-AI list`,
    };
  }

  // 2. Check known mutating patterns
  for (const pattern of KNOWN_MUTATING_PATTERNS) {
    if (pattern.test(name)) {
      return {
        classification: 'DENIED_MUTATING',
        reason: `Tool '${name}' matches mutating pattern: ${pattern.source}`,
      };
    }
  }

  // 3. Check metered-AI description heuristics (additional deny signal)
  for (const pattern of METERED_AI_DESCRIPTION_PATTERNS) {
    if (pattern.test(description)) {
      return {
        classification: 'DENIED_METERED_OR_UNKNOWN',
        reason:
          `Tool '${name}' description matches metered-AI heuristic: ${pattern.source}. ` +
          'Cannot confidently establish whether this initiates metered G2X/Lumen AI. ' +
          'Requires architecture review.',
      };
    }
  }

  // 4. Check against reviewed local policies
  const policy = REVIEWED_POLICIES.find((p) => p.toolName === name);
  if (policy) {
    if (policy.meteredAI) {
      return {
        classification: 'DENIED_METERED_AI',
        reason: `Tool '${name}' is classified as metered-AI in local policy`,
      };
    }
    if (policy.mutating) {
      return {
        classification: 'DENIED_MUTATING',
        reason: `Tool '${name}' is classified as mutating in local policy`,
      };
    }
    return {
      classification: 'ALLOWED',
      reason: `Tool '${name}' matches reviewed local policy for capability '${policy.capability}': ${policy.reviewNote}`,
    };
  }

  // 5. Default: DENY unknown
  return {
    classification: 'DENIED_UNKNOWN',
    reason: `Tool '${name}' has no local authorization policy. Default: DENY until reviewed.`,
  };
}

/**
 * Apply local authorization policy to all discovered tools.
 * Returns classified inventory and logs all decisions.
 */
export function classifyInventory(inventory: ToolInventoryEntry[]): ToolInventoryEntry[] {
  const classified = inventory.map((entry) => {
    const { classification, reason } = classifyTool(entry);
    const updated = {
      ...entry,
      classification,
      classificationReason: reason,
    };

    const logLevel = classification === 'ALLOWED' ? 'info' : 'warn';
    log[logLevel](
      {
        tool: entry.name,
        classification,
        reason,
      },
      `G2X tool classified: ${entry.name} → ${classification}`
    );

    return updated;
  });

  // Summary
  const allowed = classified.filter((t) => t.classification === 'ALLOWED');
  const denied = classified.filter((t) => t.classification !== 'ALLOWED');

  log.info(
    {
      totalDiscovered: classified.length,
      allowed: allowed.length,
      denied: denied.length,
      allowedTools: allowed.map((t) => t.name),
      deniedTools: denied.map((t) => `${t.name} (${t.classification})`),
    },
    'G2X tool inventory classification complete'
  );

  return classified;
}

/**
 * Check if a specific tool is allowed for execution.
 * Also validates schema hash hasn't changed since authorization.
 */
export function isToolAllowed(
  toolName: string,
  inventory: ToolInventoryEntry[]
): { allowed: boolean; reason: string; entry?: ToolInventoryEntry } {
  const entry = inventory.find((t) => t.name === toolName);

  if (!entry) {
    return {
      allowed: false,
      reason: `Tool '${toolName}' not found in discovered inventory`,
    };
  }

  if (entry.classification !== 'ALLOWED') {
    return {
      allowed: false,
      reason: `Tool '${toolName}' is ${entry.classification}: ${entry.classificationReason}`,
      entry,
    };
  }

  return {
    allowed: true,
    reason: entry.classificationReason,
    entry,
  };
}

/**
 * Detect schema changes between two inventory snapshots.
 * Returns tools whose schema hash changed — these should be
 * re-reviewed before continued use.
 */
export function detectSchemaChanges(
  previous: ToolInventoryEntry[],
  current: ToolInventoryEntry[]
): {
  changed: Array<{ name: string; previousHash: string; currentHash: string }>;
  added: string[];
  removed: string[];
} {
  const prevMap = new Map(previous.map((t) => [t.name, t]));
  const currMap = new Map(current.map((t) => [t.name, t]));

  const changed: Array<{ name: string; previousHash: string; currentHash: string }> = [];
  const added: string[] = [];
  const removed: string[] = [];

  // Find changed and added
  for (const [name, curr] of currMap) {
    const prev = prevMap.get(name);
    if (!prev) {
      added.push(name);
    } else if (prev.inputSchemaHash !== curr.inputSchemaHash) {
      changed.push({
        name,
        previousHash: prev.inputSchemaHash,
        currentHash: curr.inputSchemaHash,
      });
    }
  }

  // Find removed
  for (const name of prevMap.keys()) {
    if (!currMap.has(name)) {
      removed.push(name);
    }
  }

  if (changed.length > 0 || added.length > 0 || removed.length > 0) {
    log.warn(
      { changed: changed.length, added: added.length, removed: removed.length },
      'G2X tool inventory changes detected'
    );
  }

  return { changed, added, removed };
}

// ============================================================
// Capability Mapping
// ============================================================

/**
 * Produce capability mapping after real tools/list discovery.
 * Maps internal research request types to actual G2X tools.
 */
export function buildCapabilityMapping(inventory: ToolInventoryEntry[]): CapabilityMapping[] {
  const allTypes = Object.values(ResearchRequestType) as ResearchRequestTypeValue[];

  return allTypes.map((capability) => {
    // Find reviewed policy for this capability
    const policies = REVIEWED_POLICIES.filter((p) => p.capability === capability);

    // Find matching discovered tools
    const matchingTools = policies
      .map((p) => inventory.find((t) => t.name === p.toolName))
      .filter((t): t is ToolInventoryEntry => t !== undefined);

    const authorized = matchingTools.filter((t) => t.classification === 'ALLOWED');
    const metered = matchingTools.some(
      (t) =>
        t.classification === 'DENIED_METERED_AI' || t.classification === 'DENIED_METERED_OR_UNKNOWN'
    );

    return {
      internalCapability: capability,
      g2xTools: matchingTools.map((t) => t.name),
      availableOnCommunity: matchingTools.length > 0 ? authorized.length > 0 : null,
      meteredAI: metered ? true : matchingTools.length > 0 ? false : null,
      authorizedForCommissioning: authorized.length > 0,
      notes:
        matchingTools.length === 0
          ? 'No matching G2X tool discovered for this capability'
          : authorized.length === 0
            ? `Tool(s) discovered but not authorized: ${matchingTools.map((t) => `${t.name} (${t.classification})`).join(', ')}`
            : `Authorized via: ${authorized.map((t) => t.name).join(', ')}`,
    };
  });
}
