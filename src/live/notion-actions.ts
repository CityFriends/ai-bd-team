// Notion Actions for Live Agents
// Allows agents to actually add items to Notion databases

// Direct connection to Friends From The City's Pipeline database
const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const NOTION_VERSION = '2022-06-28';
const NOTION_API = 'https://api.notion.com/v1';

// Friends From The City Pipeline database ID
const PIPELINE_DATABASE_ID = '1bb07a7951ff80fe9e6dfd1284f99a48';

// Helper to make Notion API requests
async function notionRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: any
): Promise<any> {
  const response = await fetch(`${NOTION_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export interface OpportunityToAdd {
  name: string;
  agency?: string;
  type?: string; // RFQ, RFP, RFI, SSN, Pre-Solicitation
  description?: string;
  source?: string;
  fitScore?: number;
  dueDate?: string;
  samLink?: string;
  agentNotes?: string;
}

/**
 * Check if an opportunity already exists in the pipeline by name or SAM link
 * Returns true if a duplicate is found
 */
export async function opportunityExistsInPipeline(
  name: string,
  samLink?: string
): Promise<boolean> {
  if (!NOTION_API_KEY) {
    return false; // Can't check, allow add
  }

  try {
    // Search for opportunities with matching name (case-insensitive)
    const response = await notionRequest(`/databases/${PIPELINE_DATABASE_ID}/query`, 'POST', {
      filter: {
        property: 'Name',
        title: {
          contains: name.substring(0, 50), // First 50 chars to match partial titles
        },
      },
      page_size: 5,
    });

    if (response.results && response.results.length > 0) {
      // Check for exact or near-exact match
      for (const page of response.results) {
        const existingName = page.properties?.Name?.title?.[0]?.plain_text || '';
        const existingUrl = page.properties?.['Solicitation URL']?.url || '';

        // Exact name match (case-insensitive)
        if (existingName.toLowerCase() === name.toLowerCase()) {
          console.log(`[Notion] Duplicate found by name: "${name}"`);
          return true;
        }

        // SAM link match (if provided)
        if (samLink && existingUrl && existingUrl === samLink) {
          console.log(`[Notion] Duplicate found by SAM link: ${samLink}`);
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.warn('[Notion] Could not check for duplicates:', error);
    return false; // Allow add if check fails
  }
}

/**
 * Add an opportunity to the Friends From The City Pipeline in Notion
 * Uses "Under Review" stage by default
 *
 * Pipeline schema:
 * - Name (title) - required
 * - Stage (status) - "Under Review"
 * - Solicitation URL (url) - SAM.gov link
 * - Sourced (select) - "Sam.gov"
 * - Solicitation Type (select) - RFQ, RFP, RFI, SSN, Pre-Solicitation
 * - Date Added (date) - today
 */
export async function addToBacklog(
  opportunity: OpportunityToAdd,
  addedBy: string
): Promise<{ success: boolean; pageId?: string; error?: string }> {
  if (!NOTION_API_KEY) {
    console.warn('[Notion] NOTION_API_KEY not set - skipping backlog add');
    return { success: false, error: 'NOTION_API_KEY not set' };
  }

  try {
    console.log(`[Notion] Adding to Pipeline: ${opportunity.name}`);

    // Build properties for the Pipeline database
    const properties: Record<string, any> = {
      // Name is required (title field)
      Name: {
        title: [{ text: { content: opportunity.name } }],
      },
      // Stage: Set to "Under Review"
      Stage: {
        status: { name: 'Under Review' },
      },
      // Sourced: Mark as coming from Sam.gov
      Sourced: {
        select: { name: 'Sam.gov' },
      },
      // Date Added: Today
      'Date Added': {
        date: { start: new Date().toISOString().split('T')[0] },
      },
    };

    // Add Solicitation URL if we have a SAM link
    if (opportunity.samLink) {
      properties['Solicitation URL'] = {
        url: opportunity.samLink,
      };
    }

    // Add Solicitation Type if specified
    if (opportunity.type) {
      // Map our internal types to their select options
      const typeMap: Record<string, string> = {
        RFI: 'RFI',
        RFP: 'RFP',
        RFQ: 'RFQ',
        'Sources Sought': 'SSN',
        SSN: 'SSN',
        'Pre-Solicitation': 'Pre-Solicitation',
        'Task Order': 'RFQ',
        'BPA Call': 'RFQ',
        BPA: 'RFQ',
        IDIQ: 'RFQ',
      };
      const mappedType = typeMap[opportunity.type] || opportunity.type;
      if (['RFQ', 'RFP', 'RFI', 'SSN', 'Pre-Solicitation'].includes(mappedType)) {
        properties['Solicitation Type'] = {
          select: { name: mappedType },
        };
      }
    }

    // Add Due Date if we have it (try to parse it)
    if (opportunity.dueDate) {
      try {
        // Try to parse various date formats
        const dateStr = opportunity.dueDate;
        let parsedDate: Date | null = null;

        // Try ISO format first (2024-03-15)
        if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
          parsedDate = new Date(dateStr);
        }
        // Try MM/DD/YYYY or M/D/YYYY
        else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(dateStr)) {
          const parts = dateStr.split('/');
          const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
          parsedDate = new Date(
            `${year}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`
          );
        }
        // Try "Month DD, YYYY" format
        else {
          parsedDate = new Date(dateStr);
        }

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          properties['Due Date'] = {
            date: { start: parsedDate.toISOString().split('T')[0] },
          };
        }
      } catch (e) {
        console.warn(`[Notion] Could not parse due date: ${opportunity.dueDate}`);
      }
    }

    // Create the page in the Pipeline database
    const result = await notionRequest('/pages', 'POST', {
      parent: { database_id: PIPELINE_DATABASE_ID },
      properties,
    });

    console.log(`[Notion] Successfully added to Pipeline: ${result.id}`);
    console.log(`[Notion] Added by: ${addedBy}`);

    return { success: true, pageId: result.id };
  } catch (error) {
    console.error('[Notion] Failed to add to Pipeline:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if user is confirming a pipeline add
 * Uses word boundaries to prevent false positives (e.g., "Yesterday" matching "yes")
 */
export function isUserConfirmation(userMessage: string): boolean {
  // Word boundary regex to prevent substring matches
  // "Yesterday's meeting" won't match "yes", but "yes please" will
  const confirmPattern =
    /\b(yes|yeah|yep|yup|sure|do it|add it|go ahead|please add|add that|add this|sounds good|let's do it|go for it|approved|confirm|absolutely|definitely)\b/i;
  return confirmPattern.test(userMessage);
}

/**
 * Check if user is declining a pipeline add
 * Uses word boundaries to prevent false positives
 */
export function isUserDecline(userMessage: string): boolean {
  // Word boundary regex to prevent substring matches
  const declinePattern =
    /\b(no|nope|nah|don't add|skip|pass|not now|hold off|wait|not yet|nevermind|never mind|cancel)\b/i;
  return declinePattern.test(userMessage);
}

/**
 * Extract opportunity details from Maya's "Add to pipeline?" message
 * Returns opportunity details if found, null otherwise
 */
export function extractOpportunityFromMessage(mayaMessage: string): OpportunityToAdd | null {
  // Must have the structured format with 📋 and "Add to pipeline?"
  const hasAskFormat =
    mayaMessage.includes('📋') &&
    /add to pipeline\??/i.test(mayaMessage) &&
    /\*\*Title[:*]/i.test(mayaMessage);

  if (!hasAskFormat) return null;

  return parseOpportunityDetails(mayaMessage);
}

/**
 * Parse opportunity details from a structured message
 */
function parseOpportunityDetails(text: string): OpportunityToAdd | null {
  let name = '';
  let agency = '';
  let type = '';
  let samLink = '';
  let dueDate = '';

  // Parse Maya's structured format: **Title:** value, **Agency:** value, etc.
  const structuredPatterns = {
    title: /\*\*(?:Title|Name|Opportunity)[:*]*\*?\s*(.+?)(?:\n|\*\*|$)/i,
    agency: /\*\*Agency[:*]*\*?\s*(.+?)(?:\n|\*\*|$)/i,
    type: /\*\*(?:Type|Solicitation Type)[:*]*\*?\s*(.+?)(?:\n|\*\*|$)/i,
    dueDate: /\*\*(?:Due|Due Date|Deadline|Response Date)[:*]*\*?\s*(.+?)(?:\n|\*\*|$)/i,
    samLink: /\*\*(?:SAM Link|Link|URL)[:*]*\*?\s*(https?:\/\/[^\s\n]+)/i,
  };

  const titleMatch = text.match(structuredPatterns.title);
  if (titleMatch) name = titleMatch[1].trim();

  const agencyMatch = text.match(structuredPatterns.agency);
  if (agencyMatch) agency = agencyMatch[1].trim();

  const typeMatch = text.match(structuredPatterns.type);
  if (typeMatch) type = typeMatch[1].trim();

  const dueDateMatch = text.match(structuredPatterns.dueDate);
  if (dueDateMatch) dueDate = dueDateMatch[1].trim();

  const samLinkMatch = text.match(structuredPatterns.samLink);
  if (samLinkMatch) samLink = samLinkMatch[1].trim();

  // Fall back to finding SAM link anywhere in text
  if (!samLink) {
    const samLinkPattern = /https?:\/\/sam\.gov\/opp\/[a-f0-9-]+\/view/i;
    const match = text.match(samLinkPattern);
    if (match) samLink = match[0];
  }

  // VALIDATION: Require a real opportunity title
  if (!name || name.length < 10) {
    console.log('[Notion] Skipping - no valid title found');
    return null;
  }

  // Clean up the name
  name = name.trim().substring(0, 200);

  // Reject generic names
  const invalidNames = ['new opportunity', 'opportunity', 'untitled', 'n/a', 'tbd'];
  if (invalidNames.includes(name.toLowerCase())) {
    console.log(`[Notion] Skipping - generic name rejected: "${name}"`);
    return null;
  }

  return {
    name,
    agency: agency || undefined,
    type: type || undefined,
    samLink: samLink || undefined,
    dueDate: dueDate || undefined,
    source: 'Slack conversation',
  };
}

/**
 * Search thread messages for Maya's "Add to pipeline?" message and extract opportunity
 */
export function findPendingOpportunityInThread(
  threadMessages: Array<{ author: string; text: string }>
): OpportunityToAdd | null {
  // Look backwards through thread for Maya's ask
  for (let i = threadMessages.length - 1; i >= 0; i--) {
    const msg = threadMessages[i];
    if (msg.author.toLowerCase() === 'maya') {
      const opportunity = extractOpportunityFromMessage(msg.text);
      if (opportunity) {
        console.log(`[Notion] Found pending opportunity in thread: "${opportunity.name}"`);
        return opportunity;
      }
    }
  }
  return null;
}

/**
 * DEPRECATED - Use the new confirmation flow instead:
 * 1. Maya asks with extractOpportunityFromMessage format
 * 2. User confirms with isUserConfirmation
 * 3. Find opportunity with findPendingOpportunityInThread
 */
export function detectBacklogIntent(
  _agentResponse: string,
  _originalMessage: string,
  _fileContent?: string
): OpportunityToAdd | null {
  // This function is deprecated - Maya now asks for confirmation
  // Keeping for backwards compatibility but always returns null
  console.log('[Notion] detectBacklogIntent is deprecated - using confirmation flow');
  return null;
}

// ============================================================
// OPPORTUNITY UPDATE FUNCTIONS
// ============================================================

/**
 * Valid stages for the Pipeline
 */
export const VALID_STAGES = [
  'Under Review',
  'Response In Progress',
  'Downselected',
  'RFI/SSN Submitted',
  'RFP Submitted',
  'Won',
  'Lost',
  'No Bid',
  'Canceled',
] as const;

export type PipelineStage = (typeof VALID_STAGES)[number];

/**
 * Valid deal health statuses
 */
export const VALID_DEAL_HEALTH = [
  '🟢 On Track',
  '🟡 At Risk',
  '🔴 Stalled',
  '⚪ Not Started',
] as const;

export type DealHealth = (typeof VALID_DEAL_HEALTH)[number];

/**
 * Valid tech review status options
 */
export const VALID_TECH_REVIEW_STATUS = ['Not Needed', 'In Progress', 'No', 'Yes'] as const;
export type TechReviewStatus = (typeof VALID_TECH_REVIEW_STATUS)[number];

/**
 * Valid compliance matrix status options
 */
export const VALID_COMPLIANCE_MATRIX_STATUS = ['Not Needed', 'In Progress', 'No', 'Yes'] as const;
export type ComplianceMatrixStatus = (typeof VALID_COMPLIANCE_MATRIX_STATUS)[number];

/**
 * Valid past performance match status options
 */
export const VALID_PAST_PERFORMANCE_STATUS = ['Not Assessed', 'Gap', 'Partial', 'Ready'] as const;
export type PastPerformanceStatus = (typeof VALID_PAST_PERFORMANCE_STATUS)[number];

/**
 * Valid expected next step options
 */
export const VALID_NEXT_STEPS = [
  'Orals',
  'Awaiting Decision',
  'Respond to RFP/RFI',
  'Sub Engagement',
  'Unknown',
  'Prime Engagement',
  'Monitoring Only',
  'Awaiting RFP',
] as const;
export type ExpectedNextStep = (typeof VALID_NEXT_STEPS)[number];

/**
 * Valid architecture concerns (multi-select)
 */
export const VALID_ARCHITECTURE_CONCERNS = [
  "Technology Stack Mismatch - Tech choices don't fit government environment",
  'Overengineering Alert - Solution more complex than problem requires',
  'Technical Debt Risk - Maintenance burden that affects timeline/budget',
  'Integration Complexity - API dependencies legacy system connections beyond scope',
  "Scalability/Performance - Architecture won't handle expected load or growth",
  'Security/Compliance - FedRAMP ATO Section 508 issues that need strategy input',
] as const;
export type ArchitectureConcern = (typeof VALID_ARCHITECTURE_CONCERNS)[number];

/**
 * Properties that agents can update on an opportunity
 */
export interface OpportunityUpdate {
  stage?: PipelineStage;
  dealHealth?: DealHealth;
  techReviewCompleted?: TechReviewStatus;
  complianceMatrixReady?: ComplianceMatrixStatus;
  pastPerformanceMatch?: PastPerformanceStatus;
  expectedNextStep?: ExpectedNextStep;
  architectureConcerns?: ArchitectureConcern[];
  researchCompleted?: boolean; // Checkbox for David
}

/**
 * Find an opportunity in the Pipeline by name (partial match)
 * Returns the page ID and current properties if found
 */
export async function findOpportunityByName(
  name: string
): Promise<{ pageId: string; name: string; stage: string; url: string } | null> {
  if (!NOTION_API_KEY) {
    console.warn('[Notion] NOTION_API_KEY not set');
    return null;
  }

  try {
    const response = await notionRequest(`/databases/${PIPELINE_DATABASE_ID}/query`, 'POST', {
      filter: {
        property: 'Name',
        title: {
          contains: name.substring(0, 50),
        },
      },
      page_size: 5,
    });

    if (response.results && response.results.length > 0) {
      // Find best match
      for (const page of response.results) {
        const existingName = page.properties?.Name?.title?.[0]?.plain_text || '';
        const existingStage = page.properties?.Stage?.status?.name || 'Unknown';
        const pageUrl = page.url || '';

        // Exact match (case-insensitive)
        if (existingName.toLowerCase() === name.toLowerCase()) {
          return { pageId: page.id, name: existingName, stage: existingStage, url: pageUrl };
        }
      }

      // Return first partial match
      const first = response.results[0];
      return {
        pageId: first.id,
        name: first.properties?.Name?.title?.[0]?.plain_text || name,
        stage: first.properties?.Stage?.status?.name || 'Unknown',
        url: first.url || '',
      };
    }

    return null;
  } catch (error) {
    console.warn('[Notion] Could not find opportunity:', error);
    return null;
  }
}

/**
 * Update an opportunity's properties in the Pipeline
 * Agents use this to update status, mark completions, add notes
 */
export async function updateOpportunity(
  pageId: string,
  updates: OpportunityUpdate,
  updatedBy: string
): Promise<{ success: boolean; error?: string }> {
  if (!NOTION_API_KEY) {
    console.warn('[Notion] NOTION_API_KEY not set');
    return { success: false, error: 'NOTION_API_KEY not set' };
  }

  try {
    const properties: Record<string, any> = {};

    // Stage update
    if (updates.stage && VALID_STAGES.includes(updates.stage)) {
      properties['Stage'] = {
        status: { name: updates.stage },
      };
    }

    // Deal Health update (select)
    if (updates.dealHealth && VALID_DEAL_HEALTH.includes(updates.dealHealth)) {
      properties['Deal Health'] = {
        select: { name: updates.dealHealth },
      };
    }

    // Tech Review Completed (select: Not Needed, In Progress, No, Yes)
    if (
      updates.techReviewCompleted &&
      VALID_TECH_REVIEW_STATUS.includes(updates.techReviewCompleted)
    ) {
      properties['Tech Review Completed'] = {
        select: { name: updates.techReviewCompleted },
      };
    }

    // Compliance Matrix Ready (select: Not Needed, In Progress, No, Yes)
    if (
      updates.complianceMatrixReady &&
      VALID_COMPLIANCE_MATRIX_STATUS.includes(updates.complianceMatrixReady)
    ) {
      properties['Compliance Matrix Ready'] = {
        select: { name: updates.complianceMatrixReady },
      };
    }

    // Past Performance Match (select: Not Assessed, Gap, Partial, Ready)
    if (
      updates.pastPerformanceMatch &&
      VALID_PAST_PERFORMANCE_STATUS.includes(updates.pastPerformanceMatch)
    ) {
      properties['Past Performance Match'] = {
        select: { name: updates.pastPerformanceMatch },
      };
    }

    // Expected Next Step (select)
    if (updates.expectedNextStep && VALID_NEXT_STEPS.includes(updates.expectedNextStep)) {
      properties['Expected Next Step'] = {
        select: { name: updates.expectedNextStep },
      };
    }

    // Architecture Concerns Flagged (multi-select)
    if (updates.architectureConcerns && updates.architectureConcerns.length > 0) {
      properties["ARCHITECTURE CONCERNS FLAGGED'"] = {
        multi_select: updates.architectureConcerns.map((concern) => ({ name: concern })),
      };
    }

    // Research Completed (checkbox - for David)
    if (updates.researchCompleted !== undefined) {
      properties['Research Completed'] = {
        checkbox: updates.researchCompleted,
      };
    }

    // Nothing to update
    if (Object.keys(properties).length === 0) {
      return { success: false, error: 'No valid updates provided' };
    }

    console.log(
      `[Notion] Updating opportunity ${pageId} by ${updatedBy}:`,
      Object.keys(properties)
    );

    await notionRequest(`/pages/${pageId}`, 'PATCH', { properties });

    console.log(`[Notion] Successfully updated opportunity`);
    return { success: true };
  } catch (error) {
    console.error('[Notion] Failed to update opportunity:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Update opportunity stage by name (convenience wrapper)
 * Returns success and the found opportunity details
 */
export async function updateOpportunityStage(
  opportunityName: string,
  newStage: PipelineStage,
  updatedBy: string
): Promise<{ success: boolean; opportunity?: { name: string; url: string }; error?: string }> {
  const found = await findOpportunityByName(opportunityName);
  if (!found) {
    return { success: false, error: `Opportunity "${opportunityName}" not found in Pipeline` };
  }

  const result = await updateOpportunity(found.pageId, { stage: newStage }, updatedBy);
  if (result.success) {
    return { success: true, opportunity: { name: found.name, url: found.url } };
  }
  return result;
}

/**
 * Get current status of an opportunity (for agents to check before updating)
 */
export async function getOpportunityStatus(opportunityName: string): Promise<{
  found: boolean;
  name?: string;
  stage?: string;
  dealHealth?: string;
  techReviewCompleted?: string;
  complianceMatrixReady?: string;
  pastPerformanceMatch?: string;
  expectedNextStep?: string;
  researchCompleted?: boolean;
  architectureConcerns?: string[];
  url?: string;
}> {
  if (!NOTION_API_KEY) {
    return { found: false };
  }

  try {
    const response = await notionRequest(`/databases/${PIPELINE_DATABASE_ID}/query`, 'POST', {
      filter: {
        property: 'Name',
        title: {
          contains: opportunityName.substring(0, 50),
        },
      },
      page_size: 1,
    });

    if (response.results && response.results.length > 0) {
      const page = response.results[0];
      const props = page.properties || {};

      // Extract multi-select architecture concerns
      const archConcerns =
        props["ARCHITECTURE CONCERNS FLAGGED'"]?.multi_select?.map(
          (item: { name: string }) => item.name
        ) || [];

      return {
        found: true,
        name: props.Name?.title?.[0]?.plain_text,
        stage: props.Stage?.status?.name,
        dealHealth: props['Deal Health']?.select?.name,
        techReviewCompleted: props['Tech Review Completed']?.select?.name,
        complianceMatrixReady: props['Compliance Matrix Ready']?.select?.name,
        pastPerformanceMatch: props['Past Performance Match']?.select?.name,
        expectedNextStep: props['Expected Next Step']?.select?.name,
        researchCompleted: props['Research Completed']?.checkbox,
        architectureConcerns: archConcerns,
        url: page.url,
      };
    }

    return { found: false };
  } catch (error) {
    console.warn('[Notion] Could not get opportunity status:', error);
    return { found: false };
  }
}
