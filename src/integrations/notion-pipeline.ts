/**
 * Notion Pipeline Integration
 *
 * Typed client for reading and writing to the Opportunities Tracker (Pipeline)
 * database in Notion. Used by all agents for pipeline visibility and by
 * specific agents for writing scores, sync dates, and action logs.
 *
 * Agent write permissions:
 * - Maya: SAM.gov Synced date
 * - David: AI Confidence Score, Past Performance Match, PWIN Rationale
 * - All agents: Sourced, Last Action By/Date/Note, Status Change Date
 */

import 'dotenv/config';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const NOTION_API_KEY = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY || '';
const NOTION_VERSION = '2022-06-28';
const NOTION_API_BASE = 'https://api.notion.com/v1';

// The Pipeline database page ID (not the collection/data-source ID)
const PIPELINE_DATABASE_ID = '1bb07a7951ff80fe9e6dfd1284f99a48';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Pipeline opportunity stages
 */
export type PipelineStage =
  | 'Under Review'
  | 'Response In Progress'
  | 'Downselected'
  | 'RFI/SSN Submitted'
  | 'RFP Submitted'
  | 'Won'
  | 'Lost'
  | 'No Bid'
  | 'Canceled';

/**
 * Past performance match assessment levels
 */
export type PastPerformanceMatch = 'Ready' | 'Partial' | 'Gap' | 'Not Assessed';

/**
 * Agent names for tracking who made changes
 */
export type AgentName = 'Maya' | 'David' | 'James' | 'Patricia' | 'Rosa' | 'Marcus' | 'Jodie';

/**
 * Typed interface for Pipeline Opportunity records
 * Maps all relevant fields from the Notion database schema
 */
export interface PipelineOpportunity {
  // Notion metadata
  id: string;
  url: string;

  // Core fields (READ by all agents)
  name: string;
  stage: PipelineStage | null;
  agency: string[]; // Relation IDs - would need separate lookup for names
  setAside: string[];
  naicsSin: string[];
  lcats: string[];
  competition: string | null;
  pwin: number | null; // Percentage as decimal (0-100)
  proposalDueDate: string | null; // ISO date string
  sourced: string | null;
  pastPerformanceMatch: PastPerformanceMatch | null;
  aiConfidenceScore: number | null; // 0-100
  samGovSynced: string | null; // ISO date string
  solicitationUrl: string | null;
  incumbent: string | null;
  pwinRationale: string | null;

  // Action tracking fields (WRITE by all agents)
  lastActionBy: string | null;
  lastActionDate: string | null; // ISO date string
  lastActionNote: string | null;
  statusChangeDate: string | null; // ISO date string
}

/**
 * Filter options for querying opportunities
 */
export interface PipelineFilter {
  stage?: PipelineStage | PipelineStage[];
  sourced?: string;
  missingAiScore?: boolean; // Where AI Confidence Score is null
  samSyncedOlderThanDays?: number; // SAM.gov Synced is null OR older than N days
  pastPerformanceMatch?: PastPerformanceMatch;
  excludeTerminalStages?: boolean; // Exclude Won, Lost, No Bid, Canceled
}

/**
 * Fields that can be updated on an opportunity
 */
export interface PipelineUpdateFields {
  stage?: PipelineStage;
  sourced?: string;
  pastPerformanceMatch?: PastPerformanceMatch;
  aiConfidenceScore?: number;
  samGovSynced?: Date;
  pwinRationale?: string;
  statusChangeDate?: Date;
}

/**
 * Custom error for Notion API failures
 */
export class NotionPipelineError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public notionCode?: string
  ) {
    super(message);
    this.name = 'NotionPipelineError';
  }
}

// -----------------------------------------------------------------------------
// Notion API Helpers
// -----------------------------------------------------------------------------

/**
 * Makes a request to the Notion API with automatic retry on rate limit (429)
 *
 * @param endpoint - API endpoint (e.g., /databases/{id}/query)
 * @param method - HTTP method
 * @param body - Request body for POST/PATCH
 * @param retryCount - Current retry attempt (internal)
 */
async function notionRequest<T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
  retryCount = 0
): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle rate limiting with one retry after 1 second delay
  if (response.status === 429 && retryCount < 1) {
    console.warn('[NotionPipeline] Rate limited, retrying in 1 second...');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return notionRequest<T>(endpoint, method, body, retryCount + 1);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let notionCode: string | undefined;
    try {
      const parsed = JSON.parse(errorBody);
      notionCode = parsed.code;
    } catch {
      // Ignore parse errors
    }
    throw new NotionPipelineError(
      `Notion API error: ${response.status} - ${errorBody}`,
      response.status,
      notionCode
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Extract plain text from Notion rich text array
 */
function extractText(richText: Array<{ plain_text: string }> | undefined): string {
  if (!richText || richText.length === 0) return '';
  return richText.map((t) => t.plain_text).join('');
}

/**
 * Extract value from a select property
 */
function extractSelect(prop: { select?: { name: string } } | undefined): string | null {
  return prop?.select?.name || null;
}

/**
 * Extract value from a status property (similar to select but different API shape)
 */
function extractStatus(prop: { status?: { name: string } } | undefined): string | null {
  return prop?.status?.name || null;
}

/**
 * Extract values from a multi-select property
 */
function extractMultiSelect(
  prop: { multi_select?: Array<{ name: string }> } | undefined
): string[] {
  return prop?.multi_select?.map((s) => s.name) || [];
}

/**
 * Extract IDs from a relation property
 */
function extractRelation(prop: { relation?: Array<{ id: string }> } | undefined): string[] {
  return prop?.relation?.map((r) => r.id) || [];
}

/**
 * Extract number value
 */
function extractNumber(prop: { number?: number | null } | undefined): number | null {
  return prop?.number ?? null;
}

/**
 * Extract date start value as ISO string
 */
function extractDate(prop: { date?: { start?: string } } | undefined): string | null {
  return prop?.date?.start || null;
}

/**
 * Extract URL value
 */
function extractUrl(prop: { url?: string | null } | undefined): string | null {
  return prop?.url || null;
}

/**
 * Build Notion property value for a text/rich_text field
 */
function buildTextProperty(value: string): { rich_text: Array<{ text: { content: string } }> } {
  return {
    rich_text: [{ text: { content: value } }],
  };
}

/**
 * Build Notion property value for a select field
 */
function buildSelectProperty(value: string): { select: { name: string } } {
  return {
    select: { name: value },
  };
}

/**
 * Build Notion property value for a status field
 */
function buildStatusProperty(value: string): { status: { name: string } } {
  return {
    status: { name: value },
  };
}

/**
 * Build Notion property value for a number field
 */
function buildNumberProperty(value: number): { number: number } {
  return {
    number: value,
  };
}

/**
 * Build Notion property value for a date field
 */
function buildDateProperty(date: Date): { date: { start: string } } {
  return {
    date: { start: date.toISOString().split('T')[0] },
  };
}

// -----------------------------------------------------------------------------
// Property Name Mapping
// -----------------------------------------------------------------------------

/**
 * Maps our interface field names to actual Notion property names
 * This allows us to handle any naming differences between our code and Notion
 */
const PROPERTY_NAMES = {
  name: 'Name',
  stage: 'Stage',
  agency: 'Agency',
  setAside: 'Set-Aside',
  naicsSin: 'NAICS / SIN',
  lcats: 'LCATS',
  competition: 'Competition',
  pwin: 'PWIN (%)',
  proposalDueDate: 'Proposal Due Date',
  sourced: 'Sourced',
  pastPerformanceMatch: 'Past Performance Match',
  aiConfidenceScore: 'AI Confidence Score',
  samGovSynced: 'SAM.gov Synced',
  solicitationUrl: 'Solicitation URL',
  incumbent: 'Incumbent',
  pwinRationale: 'PWIN Rationale',
  lastActionBy: 'Last Action By',
  lastActionDate: 'Last Action Date',
  lastActionNote: 'Last Action Note',
  statusChangeDate: 'Status Change Date',
} as const;

// -----------------------------------------------------------------------------
// Response Type from Notion API
// -----------------------------------------------------------------------------

interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, unknown>;
}

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// -----------------------------------------------------------------------------
// NotionPipelineClient Class
// -----------------------------------------------------------------------------

/**
 * Client for interacting with the Pipeline (Opportunities Tracker) database in Notion.
 *
 * Provides typed methods for querying opportunities, updating fields,
 * and logging agent actions. Handles Notion property type mapping internally.
 */
export class NotionPipelineClient {
  private databaseId: string;

  constructor(databaseId: string = PIPELINE_DATABASE_ID) {
    this.databaseId = databaseId;
  }

  /**
   * Parse a Notion page into a typed PipelineOpportunity
   */
  private parseOpportunity(page: NotionPage): PipelineOpportunity {
    const props = page.properties as Record<string, unknown>;

    return {
      id: page.id,
      url: page.url,
      name: extractText(
        (props[PROPERTY_NAMES.name] as { title?: Array<{ plain_text: string }> })?.title
      ),
      stage: extractStatus(
        props[PROPERTY_NAMES.stage] as { status?: { name: string } }
      ) as PipelineStage | null,
      agency: extractRelation(props[PROPERTY_NAMES.agency] as { relation?: Array<{ id: string }> }),
      setAside: extractMultiSelect(
        props[PROPERTY_NAMES.setAside] as { multi_select?: Array<{ name: string }> }
      ),
      naicsSin: extractMultiSelect(
        props[PROPERTY_NAMES.naicsSin] as { multi_select?: Array<{ name: string }> }
      ),
      lcats: extractMultiSelect(
        props[PROPERTY_NAMES.lcats] as { multi_select?: Array<{ name: string }> }
      ),
      competition: extractSelect(
        props[PROPERTY_NAMES.competition] as { select?: { name: string } }
      ),
      pwin: extractNumber(props[PROPERTY_NAMES.pwin] as { number?: number | null }),
      proposalDueDate: extractDate(
        props[PROPERTY_NAMES.proposalDueDate] as { date?: { start?: string } }
      ),
      sourced: extractSelect(props[PROPERTY_NAMES.sourced] as { select?: { name: string } }),
      pastPerformanceMatch: extractSelect(
        props[PROPERTY_NAMES.pastPerformanceMatch] as { select?: { name: string } }
      ) as PastPerformanceMatch | null,
      aiConfidenceScore: extractNumber(
        props[PROPERTY_NAMES.aiConfidenceScore] as { number?: number | null }
      ),
      samGovSynced: extractDate(
        props[PROPERTY_NAMES.samGovSynced] as { date?: { start?: string } }
      ),
      solicitationUrl: extractUrl(props[PROPERTY_NAMES.solicitationUrl] as { url?: string | null }),
      incumbent: extractText(
        (props[PROPERTY_NAMES.incumbent] as { rich_text?: Array<{ plain_text: string }> })
          ?.rich_text
      ),
      pwinRationale: extractText(
        (props[PROPERTY_NAMES.pwinRationale] as { rich_text?: Array<{ plain_text: string }> })
          ?.rich_text
      ),
      lastActionBy: extractText(
        (props[PROPERTY_NAMES.lastActionBy] as { rich_text?: Array<{ plain_text: string }> })
          ?.rich_text
      ),
      lastActionDate: extractDate(
        props[PROPERTY_NAMES.lastActionDate] as { date?: { start?: string } }
      ),
      lastActionNote: extractText(
        (props[PROPERTY_NAMES.lastActionNote] as { rich_text?: Array<{ plain_text: string }> })
          ?.rich_text
      ),
      statusChangeDate: extractDate(
        props[PROPERTY_NAMES.statusChangeDate] as { date?: { start?: string } }
      ),
    };
  }

  /**
   * Build Notion filter conditions from our PipelineFilter
   */
  private buildFilter(filter: PipelineFilter): { and: Array<Record<string, unknown>> } | undefined {
    const conditions: Array<Record<string, unknown>> = [];

    // Filter by stage(s)
    if (filter.stage) {
      const stages = Array.isArray(filter.stage) ? filter.stage : [filter.stage];
      if (stages.length === 1) {
        conditions.push({
          property: PROPERTY_NAMES.stage,
          status: { equals: stages[0] },
        });
      } else {
        // Multiple stages: use OR condition
        conditions.push({
          or: stages.map((s) => ({
            property: PROPERTY_NAMES.stage,
            status: { equals: s },
          })),
        });
      }
    }

    // Filter by sourced agent
    if (filter.sourced) {
      conditions.push({
        property: PROPERTY_NAMES.sourced,
        select: { equals: filter.sourced },
      });
    }

    // Filter for missing AI Confidence Score
    if (filter.missingAiScore) {
      conditions.push({
        property: PROPERTY_NAMES.aiConfidenceScore,
        number: { is_empty: true },
      });
    }

    // Filter for Past Performance Match value
    if (filter.pastPerformanceMatch) {
      conditions.push({
        property: PROPERTY_NAMES.pastPerformanceMatch,
        select: { equals: filter.pastPerformanceMatch },
      });
    }

    // Exclude terminal stages (Won, Lost, No Bid, Canceled)
    if (filter.excludeTerminalStages) {
      const terminalStages: PipelineStage[] = ['Won', 'Lost', 'No Bid', 'Canceled'];
      for (const stage of terminalStages) {
        conditions.push({
          property: PROPERTY_NAMES.stage,
          status: { does_not_equal: stage },
        });
      }
    }

    // Filter for SAM.gov Synced older than N days (or null)
    // This requires post-filtering since Notion doesn't have "older than" for dates
    // We'll handle this in queryOpportunities by adding the filter condition for null
    // and then filtering results in code for the date comparison
    if (filter.samSyncedOlderThanDays !== undefined) {
      // We'll handle this in post-processing, but we can at least exclude very recent ones
      // by not adding any Notion filter here
    }

    if (conditions.length === 0) {
      return undefined;
    }

    return { and: conditions };
  }

  /**
   * Query opportunities from the Pipeline database
   *
   * @param filter - Optional filters to apply
   * @returns Array of typed PipelineOpportunity objects
   */
  async queryOpportunities(filter?: PipelineFilter): Promise<PipelineOpportunity[]> {
    const queryBody: {
      page_size: number;
      filter?: { and: Array<Record<string, unknown>> };
      sorts?: Array<{ property: string; direction: 'ascending' | 'descending' }>;
    } = {
      page_size: 100,
      sorts: [{ property: PROPERTY_NAMES.proposalDueDate, direction: 'ascending' }],
    };

    if (filter) {
      const notionFilter = this.buildFilter(filter);
      if (notionFilter) {
        queryBody.filter = notionFilter;
      }
    }

    const response = await notionRequest<NotionQueryResponse>(
      `/databases/${this.databaseId}/query`,
      'POST',
      queryBody
    );

    let opportunities = response.results.map((page) => this.parseOpportunity(page));

    // Post-filter for SAM.gov Synced older than N days
    if (filter?.samSyncedOlderThanDays !== undefined) {
      const thresholdDate = new Date();
      thresholdDate.setDate(thresholdDate.getDate() - filter.samSyncedOlderThanDays);
      const thresholdStr = thresholdDate.toISOString().split('T')[0];

      opportunities = opportunities.filter((opp) => {
        // Include if null OR older than threshold
        if (!opp.samGovSynced) return true;
        return opp.samGovSynced < thresholdStr;
      });
    }

    return opportunities;
  }

  /**
   * Update an opportunity with specified fields and log the agent action
   *
   * ALWAYS writes Last Action By, Last Action Date, and Last Action Note
   * alongside whatever fields are being updated.
   *
   * @param pageId - Notion page ID of the opportunity
   * @param updates - Fields to update
   * @param agentName - Name of the agent making the change
   * @param actionNote - Description of what changed and why
   */
  async updateOpportunity(
    pageId: string,
    updates: PipelineUpdateFields,
    agentName: AgentName,
    actionNote: string
  ): Promise<void> {
    const properties: Record<string, unknown> = {};

    // Map update fields to Notion property format
    if (updates.stage !== undefined) {
      properties[PROPERTY_NAMES.stage] = buildStatusProperty(updates.stage);
    }

    if (updates.sourced !== undefined) {
      properties[PROPERTY_NAMES.sourced] = buildSelectProperty(updates.sourced);
    }

    if (updates.pastPerformanceMatch !== undefined) {
      properties[PROPERTY_NAMES.pastPerformanceMatch] = buildSelectProperty(
        updates.pastPerformanceMatch
      );
    }

    if (updates.aiConfidenceScore !== undefined) {
      properties[PROPERTY_NAMES.aiConfidenceScore] = buildNumberProperty(updates.aiConfidenceScore);
    }

    if (updates.samGovSynced !== undefined) {
      properties[PROPERTY_NAMES.samGovSynced] = buildDateProperty(updates.samGovSynced);
    }

    if (updates.pwinRationale !== undefined) {
      properties[PROPERTY_NAMES.pwinRationale] = buildTextProperty(updates.pwinRationale);
    }

    if (updates.statusChangeDate !== undefined) {
      properties[PROPERTY_NAMES.statusChangeDate] = buildDateProperty(updates.statusChangeDate);
    }

    // ALWAYS add action tracking fields
    properties[PROPERTY_NAMES.lastActionBy] = buildTextProperty(agentName);
    properties[PROPERTY_NAMES.lastActionDate] = buildDateProperty(new Date());
    properties[PROPERTY_NAMES.lastActionNote] = buildTextProperty(actionNote);

    await notionRequest(`/pages/${pageId}`, 'PATCH', { properties });
  }

  /**
   * Log an agent action without updating data fields
   *
   * Use when an agent reads/reviews an opportunity without changing data fields.
   *
   * @param pageId - Notion page ID of the opportunity
   * @param agentName - Name of the agent
   * @param note - Description of what the agent did
   */
  async logAgentAction(pageId: string, agentName: AgentName, note: string): Promise<void> {
    const properties: Record<string, unknown> = {
      [PROPERTY_NAMES.lastActionBy]: buildTextProperty(agentName),
      [PROPERTY_NAMES.lastActionDate]: buildDateProperty(new Date()),
      [PROPERTY_NAMES.lastActionNote]: buildTextProperty(note),
    };

    await notionRequest(`/pages/${pageId}`, 'PATCH', { properties });
  }
}

// -----------------------------------------------------------------------------
// Agent-Specific Helper Functions
// -----------------------------------------------------------------------------

// Default client instance
const defaultClient = new NotionPipelineClient();

/**
 * Maya's helper: Update SAM.gov sync status
 *
 * Writes the SAM.gov Synced date and logs Maya's action.
 * Used after Maya successfully syncs/checks an opportunity against SAM.gov.
 *
 * @param pageId - Notion page ID of the opportunity
 * @param syncDate - Date of the SAM.gov sync
 * @param note - Description of what was found/synced
 */
export async function maya_syncSAMStatus(
  pageId: string,
  syncDate: Date,
  note: string
): Promise<void> {
  await defaultClient.updateOpportunity(
    pageId,
    { samGovSynced: syncDate },
    'Maya',
    `SAM.gov sync: ${note}`
  );
}

/**
 * David's helper: Score an opportunity
 *
 * Writes AI Confidence Score, Past Performance Match assessment,
 * and draft PWIN Rationale. Logs David's action.
 *
 * @param pageId - Notion page ID of the opportunity
 * @param score - AI confidence score (0-100)
 * @param pastPerfMatch - Past performance match assessment
 * @param rationale - Draft rationale explaining the score
 */
export async function david_scoreOpportunity(
  pageId: string,
  score: number,
  pastPerfMatch: PastPerformanceMatch,
  rationale: string
): Promise<void> {
  await defaultClient.updateOpportunity(
    pageId,
    {
      aiConfidenceScore: score,
      pastPerformanceMatch: pastPerfMatch,
      pwinRationale: rationale,
    },
    'David',
    `Scored opportunity: ${score}/100, Past Performance: ${pastPerfMatch}`
  );
}

/**
 * Get all unscored opportunities
 *
 * Returns active opportunities (not Won/Lost/No Bid/Canceled) where
 * AI Confidence Score is null. Used by David to find opps needing scoring.
 */
export async function getUnscoredOpportunities(): Promise<PipelineOpportunity[]> {
  return defaultClient.queryOpportunities({
    missingAiScore: true,
    excludeTerminalStages: true,
  });
}

/**
 * Get opportunities with stale SAM.gov sync
 *
 * Returns active opportunities where SAM.gov Synced is null OR older than
 * the specified threshold. Used by Maya to find opps needing a SAM.gov check.
 *
 * @param daysThreshold - Number of days after which sync is considered stale
 */
export async function getStaleSAMOpportunities(
  daysThreshold: number
): Promise<PipelineOpportunity[]> {
  return defaultClient.queryOpportunities({
    samSyncedOlderThanDays: daysThreshold,
    excludeTerminalStages: true,
  });
}

/**
 * Get opportunity by ID
 *
 * Fetches a single opportunity by its Notion page ID.
 */
export async function getOpportunityById(pageId: string): Promise<PipelineOpportunity> {
  const page = await notionRequest<NotionPage>(`/pages/${pageId}`);
  const client = new NotionPipelineClient();
  return client['parseOpportunity'](page);
}

/**
 * Generic helper for any agent to log their action
 */
export async function logAgentAction(
  pageId: string,
  agentName: AgentName,
  note: string
): Promise<void> {
  await defaultClient.logAgentAction(pageId, agentName, note);
}

/**
 * Generic helper for any agent to mark themselves as the source
 */
export async function markAsSourced(
  pageId: string,
  agentName: AgentName,
  note: string
): Promise<void> {
  await defaultClient.updateOpportunity(
    pageId,
    { sourced: agentName },
    agentName,
    `Sourced: ${note}`
  );
}

// -----------------------------------------------------------------------------
// Test Harness
// -----------------------------------------------------------------------------

/**
 * Test harness - runs when file is executed directly
 * Fetches and logs opportunities without making any writes
 */
async function runTests() {
  console.log('='.repeat(60));
  console.log('NOTION PIPELINE INTEGRATION TEST');
  console.log('='.repeat(60));
  console.log(`Database ID: ${PIPELINE_DATABASE_ID}`);
  console.log(`API Key configured: ${NOTION_API_KEY ? 'Yes' : 'NO - MISSING!'}`);
  console.log('');

  if (!NOTION_API_KEY) {
    console.error('ERROR: NOTION_TOKEN or NOTION_API_KEY environment variable not set');
    process.exit(1);
  }

  try {
    // Test 1: Fetch all unscored opportunities
    console.log('TEST 1: Unscored Opportunities');
    console.log('-'.repeat(40));
    const unscored = await getUnscoredOpportunities();
    console.log(`Found ${unscored.length} unscored opportunities:`);
    for (const opp of unscored.slice(0, 10)) {
      console.log(`  - ${opp.name}`);
      console.log(`    Stage: ${opp.stage || 'N/A'}`);
      console.log(`    Due: ${opp.proposalDueDate || 'N/A'}`);
    }
    if (unscored.length > 10) {
      console.log(`  ... and ${unscored.length - 10} more`);
    }
    console.log('');

    // Test 2: Fetch SAM.gov stale opportunities (older than 7 days)
    console.log('TEST 2: Stale SAM.gov Sync (>7 days)');
    console.log('-'.repeat(40));
    const stale = await getStaleSAMOpportunities(7);
    console.log(`Found ${stale.length} opportunities with stale/missing SAM.gov sync:`);
    for (const opp of stale.slice(0, 10)) {
      console.log(`  - ${opp.name}`);
      console.log(`    Last SAM sync: ${opp.samGovSynced || 'Never'}`);
      console.log(`    Stage: ${opp.stage || 'N/A'}`);
    }
    if (stale.length > 10) {
      console.log(`  ... and ${stale.length - 10} more`);
    }
    console.log('');

    // Test 3: Query by specific stage
    console.log('TEST 3: Opportunities "Under Review"');
    console.log('-'.repeat(40));
    const client = new NotionPipelineClient();
    const underReview = await client.queryOpportunities({ stage: 'Under Review' });
    console.log(`Found ${underReview.length} opportunities under review:`);
    for (const opp of underReview.slice(0, 5)) {
      console.log(`  - ${opp.name}`);
      console.log(`    PWIN: ${opp.pwin !== null ? `${opp.pwin}%` : 'Not set'}`);
      console.log(
        `    AI Score: ${opp.aiConfidenceScore !== null ? opp.aiConfidenceScore : 'Not scored'}`
      );
    }
    console.log('');

    console.log('='.repeat(60));
    console.log('ALL TESTS PASSED (read-only, no writes performed)');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('TEST FAILED:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
// Using import.meta.url for ES modules compatibility
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('notion-pipeline.ts') ||
    process.argv[1].endsWith('notion-pipeline.js'));

if (isMainModule) {
  runTests();
}
