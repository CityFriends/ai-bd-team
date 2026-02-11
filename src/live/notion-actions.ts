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
 * Parse agent response to detect if they want to add something to backlog
 * Returns opportunity details if detected, null otherwise
 *
 * Enhanced to extract structured data from Maya's formatted backlog entries:
 * 📋 **Adding to Pipeline**
 * **Title:** [name]
 * **Agency:** [agency]
 * **Type:** [RFP/RFQ/etc]
 * **Due:** [date]
 * **Link:** [url]
 */
export function detectBacklogIntent(
  agentResponse: string,
  originalMessage: string,
  fileContent?: string
): OpportunityToAdd | null {
  const lowerResponse = agentResponse.toLowerCase();

  // Check for backlog/tracking intent
  const trackingPhrases = [
    'add this to',
    'adding to',
    'track this',
    'tracking this',
    'put this in',
    'adding it to',
    'flag this',
    'flagging this',
    'worth tracking',
    'backlog',
    'pipeline',
    'adding it to the backlog',
    'add to our pipeline',
    '📋', // Maya uses this emoji when logging
    'adding to pipeline',
  ];

  const hasIntent = trackingPhrases.some((phrase) => lowerResponse.includes(phrase));
  if (!hasIntent) return null;

  const combinedText = `${agentResponse} ${originalMessage} ${fileContent || ''}`;

  // Try to extract opportunity details
  let name = '';
  let agency = '';
  let type = '';
  let samLink = '';
  let dueDate = '';

  // First, try to parse Maya's structured format (if she used it)
  // Format: **Title:** value or **Agency:** value
  const structuredPatterns = {
    title: /\*\*(?:Title|Name|Opportunity)[:*]*\*?\s*(.+?)(?:\n|\*\*|$)/i,
    agency: /\*\*Agency[:*]*\*?\s*(.+?)(?:\n|\*\*|$)/i,
    type: /\*\*(?:Type|Solicitation Type)[:*]*\*?\s*(.+?)(?:\n|\*\*|$)/i,
    dueDate: /\*\*(?:Due|Due Date|Deadline|Response Date)[:*]*\*?\s*(.+?)(?:\n|\*\*|$)/i,
    samLink: /\*\*(?:SAM Link|Link|URL)[:*]*\*?\s*(https?:\/\/[^\s\n]+)/i,
  };

  // Try structured extraction first
  const titleMatch = agentResponse.match(structuredPatterns.title);
  if (titleMatch) name = titleMatch[1].trim();

  const agencyMatch = agentResponse.match(structuredPatterns.agency);
  if (agencyMatch) agency = agencyMatch[1].trim();

  const typeMatch = agentResponse.match(structuredPatterns.type);
  if (typeMatch) type = typeMatch[1].trim();

  const dueDateMatch = agentResponse.match(structuredPatterns.dueDate);
  if (dueDateMatch) dueDate = dueDateMatch[1].trim();

  const samLinkMatch = agentResponse.match(structuredPatterns.samLink);
  if (samLinkMatch) samLink = samLinkMatch[1].trim();

  // Fall back to general extraction if structured didn't work
  if (!samLink) {
    const samLinkPattern = /https?:\/\/sam\.gov\/opp\/[a-f0-9-]+\/view/i;
    const match = combinedText.match(samLinkPattern);
    if (match) samLink = match[0];
  }

  // Extract opportunity type if not found
  if (!type) {
    const typePatterns = [/\b(RFP|RFQ|RFI|BPA|IDIQ|Task Order|Sources Sought|Pre-Solicitation)\b/i];
    for (const pattern of typePatterns) {
      const match = combinedText.match(pattern);
      if (match) {
        type = match[1].toUpperCase();
        if (type === 'SOURCES SOUGHT') type = 'SSN';
        if (type === 'TASK ORDER') type = 'RFQ';
        break;
      }
    }
  }

  // Extract name if not found from structured
  if (!name) {
    const namePatterns = [
      // GSA TTS specific patterns
      /GSA\s+TTS\s+[\w\s-]+(?:BPA|RFP|RFI|contract|solicitation)/i,
      /TTS\s+[\w\s-]+(?:BPA|IDIQ)/i,
      // General patterns
      /this is (?:the |a )?([A-Z][A-Za-z0-9\s-]+(?:BPA|RFP|RFI|contract|solicitation|opportunity))/i,
      /([A-Z][A-Z\s-]+(?:BPA|IDIQ|contract))/,
      /([A-Z]{2,}\s+[A-Za-z\s-]+(?:modernization|services|support))/i,
      // Title-like patterns from documents
      /title[:\s]+["']?([^"'\n]+)["']?/i,
      /subject[:\s]+["']?([^"'\n]+)["']?/i,
    ];

    for (const pattern of namePatterns) {
      const match = combinedText.match(pattern);
      if (match) {
        name = match[1] || match[0];
        break;
      }
    }
  }

  // Extract agency if not found
  if (!agency) {
    const agencyPatterns = [
      /\b(GSA|VA|HHS|DOL|DHS|DOD|DOE|DOT|HUD|USDA|DOJ|State|Treasury|Commerce|Interior|EPA|NASA|SBA|OPM|CMS|ED|SSA)\b/i,
    ];

    for (const pattern of agencyPatterns) {
      const match = combinedText.match(pattern);
      if (match) {
        agency = match[1].toUpperCase();
        break;
      }
    }
  }

  // Try to extract due date from various formats if not found
  if (!dueDate) {
    const datePatterns = [
      /(?:due|deadline|closes?|response date)[:\s]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /(?:due|deadline|closes?|response date)[:\s]+(\w+\s+\d{1,2},?\s+\d{4})/i,
      /(?:due|deadline|closes?|response date)[:\s]+(\d{4}-\d{2}-\d{2})/i,
    ];
    for (const pattern of datePatterns) {
      const match = combinedText.match(pattern);
      if (match) {
        dueDate = match[1];
        break;
      }
    }
  }

  // If we still don't have a name, create one from agency and type
  if (!name) {
    if (agency && type) {
      name = `${agency} ${type}`;
    } else if (agency) {
      name = `${agency} Opportunity`;
    } else {
      name = 'New Opportunity';
    }
  }

  // Clean up the name
  name = name.trim().substring(0, 200);

  return {
    name,
    agency: agency || undefined,
    type: type || undefined,
    samLink: samLink || undefined,
    dueDate: dueDate || undefined,
    description: agentResponse.substring(0, 500),
    source: 'Slack conversation',
  };
}
