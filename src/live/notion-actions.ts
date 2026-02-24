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
 */
export function isUserConfirmation(userMessage: string): boolean {
  const confirmPhrases = [
    'yes',
    'yeah',
    'yep',
    'yup',
    'sure',
    'do it',
    'add it',
    'go ahead',
    'please add',
    'add that',
    'add this',
    'sounds good',
    "let's do it",
    'go for it',
    'approved',
    'confirm',
    'absolutely',
    'definitely',
  ];
  const lower = userMessage.toLowerCase().trim();
  return confirmPhrases.some((phrase) => lower.includes(phrase));
}

/**
 * Check if user is declining a pipeline add
 */
export function isUserDecline(userMessage: string): boolean {
  const declinePhrases = [
    'no',
    'nope',
    'nah',
    "don't add",
    'skip',
    'pass',
    'not now',
    'hold off',
    'wait',
    'not yet',
    'nevermind',
    'never mind',
    'cancel',
  ];
  const lower = userMessage.toLowerCase().trim();
  return declinePhrases.some((phrase) => lower.includes(phrase));
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
