/**
 * Notion Hub Integration
 *
 * Creates and manages the AI BD Team Hub in Notion:
 * - Opportunities pipeline
 * - Partners database
 * - Contacts database
 * - Past Performance database
 * - Forecasts database
 * - Activity Log
 * - Feedback Log
 * - Decisions database
 */

const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const NOTION_VERSION = '2022-06-28';

// Base URL for Notion API
const NOTION_API = 'https://api.notion.com/v1';

// Color options for selects
const COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

// Store database IDs after creation
export interface NotionHubIds {
  hubPageId: string;
  opportunitiesDbId: string;
  partnersDbId: string;
  contactsDbId: string;
  pastPerformanceDbId: string;
  forecastsDbId: string;
  activityLogDbId: string;
  feedbackLogDbId: string;
  decisionsDbId: string;
}

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

// Create a page
async function createPage(
  parentId: string,
  title: string,
  icon?: string,
  children?: any[]
): Promise<string> {
  const body: any = {
    parent: { page_id: parentId },
    properties: {
      title: {
        title: [{ text: { content: title } }],
      },
    },
  };

  if (icon) {
    body.icon = { type: 'emoji', emoji: icon };
  }

  if (children) {
    body.children = children;
  }

  const result = await notionRequest('/pages', 'POST', body);
  return result.id;
}

// Create a database
async function createDatabase(
  parentId: string,
  title: string,
  icon: string,
  properties: Record<string, any>
): Promise<string> {
  const body = {
    parent: { page_id: parentId },
    title: [{ text: { content: title } }],
    icon: { type: 'emoji', emoji: icon },
    properties,
  };

  const result = await notionRequest('/databases', 'POST', body);
  console.log(`  Created database: ${title} (${result.id})`);
  return result.id;
}

// Create select options
function selectOptions(options: string[]): any[] {
  return options.map((name, i) => ({
    name,
    color: COLORS[i % COLORS.length],
  }));
}

// Property builders
const prop = {
  title: () => ({ title: {} }),
  text: () => ({ rich_text: {} }),
  number: (format?: string) => ({ number: { format: format || 'number' } }),
  select: (options: string[]) => ({ select: { options: selectOptions(options) } }),
  multiSelect: (options: string[]) => ({ multi_select: { options: selectOptions(options) } }),
  date: () => ({ date: {} }),
  checkbox: () => ({ checkbox: {} }),
  url: () => ({ url: {} }),
  email: () => ({ email: {} }),
  phone: () => ({ phone_number: {} }),
  relation: (dbId: string) => ({ relation: { database_id: dbId, single_property: {} } }),
};

// ============================================================
// DATABASE SCHEMAS
// ============================================================

function opportunitiesProperties(
  partnersDbId?: string,
  contactsDbId?: string,
  pastPerfDbId?: string
) {
  const props: Record<string, any> = {
    Name: prop.title(),
    Status: prop.select([
      'New',
      'Researching',
      'Go',
      'No-Go',
      'Pursuing',
      'Submitted',
      'Won',
      'Lost',
    ]),
    'Fit Score': prop.number(),
    'Strategic Fit': prop.checkbox(),
    Agency: prop.select([
      'VA',
      'HHS',
      'CMS',
      'DOL',
      'DHS',
      'GSA',
      'SBA',
      'ED',
      'DOJ',
      'DOT',
      'USDA',
      'DOE',
      'EPA',
      'NASA',
      'OPM',
      'SSA',
      'Treasury',
      'State',
      'Other',
    ]),
    'Sub-Agency': prop.text(),
    'Value Low': prop.number('dollar'),
    'Value High': prop.number('dollar'),
    'Due Date': prop.date(),
    'Posted Date': prop.date(),
    NAICS: prop.text(),
    'Set-Aside': prop.select([
      'Small Business',
      '8(a)',
      'WOSB',
      'HUBZone',
      'SDVOSB',
      'Unrestricted',
    ]),
    Type: prop.select(['RFI', 'Sources Sought', 'RFP', 'Task Order', 'BPA Call', 'Other']),
    'SAM Link': prop.url(),
    "Maya's Take": prop.text(),
    "David's Analysis": prop.text(),
    "Rosa's Partners": prop.text(),
    "James's Recommendation": prop.text(),
    Decision: prop.select(['Pending', 'Go', 'No-Go']),
    'Decision Date': prop.date(),
    'Decision Rationale': prop.text(),
    Incumbent: prop.text(),
    Competitors: prop.text(),
    'Our Role': prop.select(['Prime', 'Sub', 'Undecided']),
  };

  // Add relations if database IDs are provided
  if (partnersDbId) {
    props['Teaming Partner'] = prop.relation(partnersDbId);
  }
  if (contactsDbId) {
    props['Related Contacts'] = prop.relation(contactsDbId);
  }
  if (pastPerfDbId) {
    props['Related Past Performance'] = prop.relation(pastPerfDbId);
  }

  return props;
}

function partnersProperties(opportunitiesDbId?: string) {
  const props: Record<string, any> = {
    'Company Name': prop.title(),
    Capabilities: prop.multiSelect([
      'HCD',
      'UX Research',
      'Service Design',
      'Software Development',
      'Cloud',
      'Data Analytics',
      'AI/ML',
      'Agile',
      'DevOps',
      'Cybersecurity',
      'PMO',
    ]),
    Certifications: prop.multiSelect([
      '8(a)',
      'WOSB',
      'EDWOSB',
      'SDVOSB',
      'VOSB',
      'HUBZone',
      'SDB',
      'MBE',
      'WBE',
    ]),
    'Relationship Status': prop.select(['Strong', 'Warm', 'Cold', 'New']),
    'Contact Person': prop.text(),
    'Contact Email': prop.email(),
    'Contact Phone': prop.phone(),
    'Last Contact': prop.date(),
    'Teaming History': prop.text(),
    Strengths: prop.text(),
    Weaknesses: prop.text(),
    'NDA Signed': prop.checkbox(),
    'Teaming Agreement': prop.checkbox(),
    Notes: prop.text(),
  };

  if (opportunitiesDbId) {
    props['Linked Opportunities'] = prop.relation(opportunitiesDbId);
  }

  return props;
}

function contactsProperties(opportunitiesDbId?: string) {
  const props: Record<string, any> = {
    Name: prop.title(),
    Agency: prop.select([
      'VA',
      'HHS',
      'CMS',
      'DOL',
      'DHS',
      'GSA',
      'SBA',
      'ED',
      'DOJ',
      'DOT',
      'USDA',
      'DOE',
      'EPA',
      'NASA',
      'OPM',
      'SSA',
      'Treasury',
      'State',
      'Other',
    ]),
    'Sub-Agency': prop.text(),
    Title: prop.text(),
    Email: prop.email(),
    Phone: prop.phone(),
    LinkedIn: prop.url(),
    'Relationship Strength': prop.select(['1', '2', '3', '4', '5']),
    'How We Know': prop.text(),
    'Last Contact': prop.date(),
    Notes: prop.text(),
    Tags: prop.multiSelect(['Procurement', 'Technical', 'Executive', 'Champion', 'Blocker']),
  };

  if (opportunitiesDbId) {
    props['Linked Opportunities'] = prop.relation(opportunitiesDbId);
  }

  return props;
}

function pastPerformanceProperties(opportunitiesDbId?: string) {
  const props: Record<string, any> = {
    'Contract Name': prop.title(),
    Agency: prop.select([
      'VA',
      'HHS',
      'CMS',
      'DOL',
      'DHS',
      'GSA',
      'SBA',
      'ED',
      'DOJ',
      'DOT',
      'USDA',
      'DOE',
      'EPA',
      'NASA',
      'OPM',
      'SSA',
      'Treasury',
      'State',
      'Other',
    ]),
    'Sub-Agency': prop.text(),
    'Contract Number': prop.text(),
    'Contract Vehicle': prop.text(),
    'Our Role': prop.select(['Prime', 'Sub']),
    'Prime Contractor': prop.text(),
    'Start Date': prop.date(),
    'End Date': prop.date(),
    Value: prop.number('dollar'),
    Description: prop.text(),
    'Key Accomplishments': prop.text(),
    'CPAR Rating': prop.select([
      'Exceptional',
      'Very Good',
      'Satisfactory',
      'Marginal',
      'Unsatisfactory',
    ]),
    Referenceable: prop.checkbox(),
    'Client Contact': prop.text(),
    Tags: prop.multiSelect(['HCD', 'UX', 'Research', 'Dev', 'AI', 'Agile', 'Cloud', 'Data']),
  };

  if (opportunitiesDbId) {
    props['Linked Opportunities'] = prop.relation(opportunitiesDbId);
  }

  return props;
}

function forecastsProperties() {
  return {
    Title: prop.title(),
    Agency: prop.select([
      'VA',
      'HHS',
      'CMS',
      'DOL',
      'DHS',
      'GSA',
      'SBA',
      'ED',
      'DOJ',
      'DOT',
      'USDA',
      'DOE',
      'EPA',
      'NASA',
      'FEMA',
      'State',
      'Other',
    ]),
    'Sub-Agency': prop.text(),
    Description: prop.text(),
    'Estimated Release': prop.date(),
    'Estimated Value': prop.text(),
    NAICS: prop.text(),
    'Set-Aside': prop.select([
      'Small Business',
      '8(a)',
      'WOSB',
      'HUBZone',
      'SDVOSB',
      'Unrestricted',
      'TBD',
    ]),
    'Relevance Score': prop.number(),
    'Source URL': prop.url(),
    Status: prop.select(['Upcoming', 'Released', 'Cancelled']),
    'SAM Link': prop.url(),
    Notes: prop.text(),
    'Last Checked': prop.date(),
  };
}

function activityLogProperties(opportunitiesDbId?: string) {
  const props: Record<string, any> = {
    Date: prop.title(), // Using title as date display
    Agent: prop.select(['Maya', 'David', 'Rosa', 'James', 'Patricia']),
    'Action Type': prop.select([
      'Found Opportunity',
      'Analyzed',
      'Recommended Partner',
      'Made Recommendation',
      'Decision Requested',
      'Decision Made',
    ]),
    Summary: prop.text(),
    Notes: prop.text(),
  };

  if (opportunitiesDbId) {
    props['Opportunity'] = prop.relation(opportunitiesDbId);
  }

  return props;
}

function feedbackLogProperties() {
  return {
    Date: prop.title(),
    Agent: prop.select(['Maya', 'David', 'Rosa', 'James', 'Patricia', 'System']),
    'Feedback Type': prop.select([
      'Bug',
      'Wrong Answer',
      'Great Catch',
      'Suggestion',
      'Annoying',
      'Missing Info',
    ]),
    'What Happened': prop.text(),
    'What Should Happen': prop.text(),
    Severity: prop.select(['Minor', 'Medium', 'Major']),
    Resolved: prop.checkbox(),
    Resolution: prop.text(),
  };
}

function decisionsProperties(opportunitiesDbId?: string) {
  const props: Record<string, any> = {
    Title: prop.title(),
    Decision: prop.select(['Go', 'No-Go']),
    Date: prop.date(),
    Rationale: prop.text(),
    Outcome: prop.select(['Pending', 'Won', 'Lost', 'Cancelled']),
    'Lessons Learned': prop.text(),
  };

  if (opportunitiesDbId) {
    props['Opportunity'] = prop.relation(opportunitiesDbId);
  }

  return props;
}

// ============================================================
// HUB CREATION
// ============================================================

export async function createNotionHub(parentPageId: string): Promise<NotionHubIds> {
  console.log('\n=== Creating AI BD Team Hub ===\n');

  // 1. Create main hub page
  console.log('Creating hub page...');
  const hubPageId = await createPage(parentPageId, 'AI BD Team Hub', '🎯');
  console.log(`  Hub page created: ${hubPageId}`);

  // 2. Create databases (first pass - without relations)
  console.log('\nCreating databases...');

  const opportunitiesDbId = await createDatabase(
    hubPageId,
    'Opportunities',
    '📊',
    opportunitiesProperties()
  );

  const partnersDbId = await createDatabase(hubPageId, 'Partners', '🤝', partnersProperties());

  const contactsDbId = await createDatabase(hubPageId, 'Contacts', '👥', contactsProperties());

  const pastPerformanceDbId = await createDatabase(
    hubPageId,
    'Past Performance',
    '📁',
    pastPerformanceProperties()
  );

  const forecastsDbId = await createDatabase(hubPageId, 'Forecasts', '🔮', forecastsProperties());

  const activityLogDbId = await createDatabase(
    hubPageId,
    'Activity Log',
    '📝',
    activityLogProperties()
  );

  const feedbackLogDbId = await createDatabase(
    hubPageId,
    'Feedback',
    '💬',
    feedbackLogProperties()
  );

  const decisionsDbId = await createDatabase(hubPageId, 'Decisions', '📈', decisionsProperties());

  // 3. Create sub-pages for Settings and Playbook
  console.log('\nCreating sub-pages...');

  await createPage(hubPageId, 'Settings', '⚙️', [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'Company Profile' } }] },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: 'Company settings and profile information.' } }],
      },
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'Search Filters' } }] },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: 'NAICS codes, keywords, and opportunity filters.' } }],
      },
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'Strategic Goals' } }] },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          { text: { content: 'Current strategic priorities and capability gaps to fill.' } },
        ],
      },
    },
  ]);
  console.log(`  Created: Settings page`);

  await createPage(hubPageId, 'Playbook', '📚', [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'How the System Works' } }] },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            text: {
              content:
                'The AI BD Team scans SAM.gov daily for opportunities matching our profile. Maya finds opportunities, David analyzes them, Rosa identifies partners, James makes recommendations, and Patricia tracks everything.',
            },
          },
        ],
      },
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'Agent Roles' } }] },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          {
            text: { content: 'Maya (Scout): Finds opportunities on SAM.gov, assesses initial fit' },
          },
        ],
      },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          {
            text: {
              content: 'David (Analyst): Researches incumbents, agencies, risks using USASpending',
            },
          },
        ],
      },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          {
            text: {
              content: 'Rosa (Connector): Identifies teaming partners, manages relationships',
            },
          },
        ],
      },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          {
            text: {
              content: 'James (Strategist): Synthesizes intel, makes Go/No-Go recommendations',
            },
          },
        ],
      },
    },
    {
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          { text: { content: 'Patricia (PM): Tracks decisions, deadlines, action items' } },
        ],
      },
    },
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'Decision Criteria' } }] },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            text: {
              content:
                'Go/No-Go decisions are based on: fit score, strategic value, past performance relevance, teaming options, timeline feasibility, and win probability.',
            },
          },
        ],
      },
    },
  ]);
  console.log(`  Created: Playbook page`);

  const ids: NotionHubIds = {
    hubPageId,
    opportunitiesDbId,
    partnersDbId,
    contactsDbId,
    pastPerformanceDbId,
    forecastsDbId,
    activityLogDbId,
    feedbackLogDbId,
    decisionsDbId,
  };

  console.log('\n=== Hub Creation Complete ===\n');
  console.log('Database IDs:');
  console.log(JSON.stringify(ids, null, 2));

  return ids;
}

// ============================================================
// SYNC OPERATIONS
// ============================================================

// Add an opportunity to Notion
export async function addOpportunityToNotion(
  dbId: string,
  opportunity: {
    name: string;
    status?: string;
    fitScore?: number;
    strategicFit?: boolean;
    agency?: string;
    subAgency?: string;
    valueLow?: number;
    valueHigh?: number;
    dueDate?: string;
    postedDate?: string;
    naics?: string;
    setAside?: string;
    type?: string;
    samLink?: string;
    mayasTake?: string;
    davidsAnalysis?: string;
    rosasPartners?: string;
    jamesRecommendation?: string;
    incumbent?: string;
    competitors?: string;
    ourRole?: string;
  }
): Promise<string> {
  const properties: Record<string, any> = {
    Name: { title: [{ text: { content: opportunity.name } }] },
  };

  if (opportunity.status) {
    properties['Status'] = { select: { name: opportunity.status } };
  }
  if (opportunity.fitScore !== undefined) {
    properties['Fit Score'] = { number: opportunity.fitScore };
  }
  if (opportunity.strategicFit !== undefined) {
    properties['Strategic Fit'] = { checkbox: opportunity.strategicFit };
  }
  if (opportunity.agency) {
    properties['Agency'] = { select: { name: opportunity.agency } };
  }
  if (opportunity.subAgency) {
    properties['Sub-Agency'] = { rich_text: [{ text: { content: opportunity.subAgency } }] };
  }
  if (opportunity.valueLow !== undefined) {
    properties['Value Low'] = { number: opportunity.valueLow };
  }
  if (opportunity.valueHigh !== undefined) {
    properties['Value High'] = { number: opportunity.valueHigh };
  }
  if (opportunity.dueDate) {
    properties['Due Date'] = { date: { start: opportunity.dueDate } };
  }
  if (opportunity.postedDate) {
    properties['Posted Date'] = { date: { start: opportunity.postedDate } };
  }
  if (opportunity.naics) {
    properties['NAICS'] = { rich_text: [{ text: { content: opportunity.naics } }] };
  }
  if (opportunity.setAside) {
    properties['Set-Aside'] = { select: { name: opportunity.setAside } };
  }
  if (opportunity.type) {
    properties['Type'] = { select: { name: opportunity.type } };
  }
  if (opportunity.samLink) {
    properties['SAM Link'] = { url: opportunity.samLink };
  }
  if (opportunity.mayasTake) {
    properties["Maya's Take"] = {
      rich_text: [{ text: { content: opportunity.mayasTake.slice(0, 2000) } }],
    };
  }
  if (opportunity.davidsAnalysis) {
    properties["David's Analysis"] = {
      rich_text: [{ text: { content: opportunity.davidsAnalysis.slice(0, 2000) } }],
    };
  }
  if (opportunity.rosasPartners) {
    properties["Rosa's Partners"] = {
      rich_text: [{ text: { content: opportunity.rosasPartners.slice(0, 2000) } }],
    };
  }
  if (opportunity.jamesRecommendation) {
    properties["James's Recommendation"] = {
      rich_text: [{ text: { content: opportunity.jamesRecommendation.slice(0, 2000) } }],
    };
  }
  if (opportunity.incumbent) {
    properties['Incumbent'] = { rich_text: [{ text: { content: opportunity.incumbent } }] };
  }
  if (opportunity.competitors) {
    properties['Competitors'] = { rich_text: [{ text: { content: opportunity.competitors } }] };
  }
  if (opportunity.ourRole) {
    properties['Our Role'] = { select: { name: opportunity.ourRole } };
  }

  const result = await notionRequest('/pages', 'POST', {
    parent: { database_id: dbId },
    properties,
  });

  return result.id;
}

// Update an opportunity in Notion
export async function updateOpportunityInNotion(
  pageId: string,
  updates: Record<string, any>
): Promise<void> {
  const properties: Record<string, any> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'status') {
      properties['Status'] = { select: { name: value } };
    } else if (key === 'davidsAnalysis') {
      properties["David's Analysis"] = { rich_text: [{ text: { content: value.slice(0, 2000) } }] };
    } else if (key === 'rosasPartners') {
      properties["Rosa's Partners"] = { rich_text: [{ text: { content: value.slice(0, 2000) } }] };
    } else if (key === 'jamesRecommendation') {
      properties["James's Recommendation"] = {
        rich_text: [{ text: { content: value.slice(0, 2000) } }],
      };
    } else if (key === 'decision') {
      properties['Decision'] = { select: { name: value } };
    } else if (key === 'decisionDate') {
      properties['Decision Date'] = { date: { start: value } };
    } else if (key === 'decisionRationale') {
      properties['Decision Rationale'] = { rich_text: [{ text: { content: value } }] };
    } else if (key === 'incumbent') {
      properties['Incumbent'] = { rich_text: [{ text: { content: value } }] };
    } else if (key === 'competitors') {
      properties['Competitors'] = { rich_text: [{ text: { content: value } }] };
    }
  }

  await notionRequest(`/pages/${pageId}`, 'PATCH', { properties });
}

// Add activity log entry
export async function logActivityToNotion(
  dbId: string,
  activity: {
    agent: string;
    actionType: string;
    summary: string;
    notes?: string;
    opportunityId?: string;
  }
): Promise<string> {
  const date = new Date().toISOString().split('T')[0];

  const properties: Record<string, any> = {
    Date: { title: [{ text: { content: date } }] },
    Agent: { select: { name: activity.agent } },
    'Action Type': { select: { name: activity.actionType } },
    Summary: { rich_text: [{ text: { content: activity.summary.slice(0, 2000) } }] },
  };

  if (activity.notes) {
    properties['Notes'] = { rich_text: [{ text: { content: activity.notes } }] };
  }

  // Note: Opportunity relation may not exist if database was created without it
  // Skip the relation field - it can be added manually in Notion later

  const result = await notionRequest('/pages', 'POST', {
    parent: { database_id: dbId },
    properties,
  });

  return result.id;
}

// Add feedback to Notion
export async function logFeedbackToNotion(
  dbId: string,
  feedback: {
    agent: string;
    feedbackType: string;
    whatHappened: string;
    whatShouldHappen?: string;
    severity: string;
  }
): Promise<string> {
  const date = new Date().toISOString().split('T')[0];

  const properties: Record<string, any> = {
    Date: { title: [{ text: { content: date } }] },
    Agent: { select: { name: feedback.agent } },
    'Feedback Type': { select: { name: feedback.feedbackType } },
    'What Happened': { rich_text: [{ text: { content: feedback.whatHappened } }] },
    Severity: { select: { name: feedback.severity } },
    Resolved: { checkbox: false },
  };

  if (feedback.whatShouldHappen) {
    properties['What Should Happen'] = {
      rich_text: [{ text: { content: feedback.whatShouldHappen } }],
    };
  }

  const result = await notionRequest('/pages', 'POST', {
    parent: { database_id: dbId },
    properties,
  });

  return result.id;
}

// Query a Notion database
export async function queryNotionDatabase(
  dbId: string,
  filter?: any,
  sorts?: any[]
): Promise<any[]> {
  const body: any = {};
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;

  const result = await notionRequest(`/databases/${dbId}/query`, 'POST', body);
  return result.results || [];
}

// Get text from Notion property
export function getNotionText(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === 'title' && prop.title?.[0]) {
    return prop.title[0].plain_text;
  }
  if (prop.type === 'rich_text' && prop.rich_text?.[0]) {
    return prop.rich_text[0].plain_text;
  }
  return null;
}

// Get select value from Notion property
export function getNotionSelect(prop: any): string | null {
  if (!prop || !prop.select) return null;
  return prop.select.name;
}
