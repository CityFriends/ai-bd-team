/**
 * GSA eBuy Email Parser
 *
 * Parses GSA eBuy notification emails to extract opportunities.
 * Works with Gmail API to fetch and process alert emails.
 *
 * Email format:
 * - Request ID, Status, Date/Buyer, Quote/Bid Due By, Request Title
 * - Statuses: NEW REQUEST, Q&A ADDED, AMENDED, CANCELED
 */

import { google } from 'googleapis';
import { getSupabase } from './supabase.js';

export interface EBuyOpportunity {
  requestId: string;
  status: 'NEW REQUEST' | 'Q&A ADDED' | 'AMENDED' | 'CANCELED';
  datePosted: string;
  dueDate: string;
  title: string;
  ebuyUrl: string;
}

// GSA eBuy base URL for opportunities
const EBUY_BASE_URL = 'https://www.ebuy.gsa.gov/ebuy/';

/**
 * Parse GSA eBuy notification email content (HTML format)
 * Email format is HTML with tables:
 * <tr><td>RFI1795807</td><td>NEW REQUEST</td><td>date<br>buyer info</td><td>due date</td><td>title</td></tr>
 */
export function parseEBuyEmail(emailBody: string): EBuyOpportunity[] {
  const opportunities: EBuyOpportunity[] = [];

  // Find the Request Notices table - look for rows after the header row
  // The table has: Request ID, Status, Date/Buyer, Quote/Bid Due By, Request Title
  const tableRowRegex =
    /<tr><td>(RFQ?\d+|RFI\d+)<\/td><td>(NEW REQUEST|Q&A ADDED|AMENDED|CANCELED)<\/td><td>([^<]+)(?:<br>[^<]*)*<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/gi;

  let match;
  while ((match = tableRowRegex.exec(emailBody)) !== null) {
    const [, requestId, status, datePosted, dueDate, title] = match;

    opportunities.push({
      requestId: requestId.toUpperCase(),
      status: status.toUpperCase() as EBuyOpportunity['status'],
      datePosted: datePosted.trim(),
      dueDate: dueDate.trim(),
      title: title.trim(),
      ebuyUrl: `${EBUY_BASE_URL}?id=${requestId}`,
    });
  }

  // If HTML parsing didn't work, try plain text fallback
  if (opportunities.length === 0) {
    console.log('[eBuy] HTML parsing found nothing, trying plain text fallback...');

    const lines = emailBody.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const textMatch = trimmed.match(
        /^(RFQ?\d+|RFI\d+)\s+(NEW REQUEST|Q&A ADDED|AMENDED|CANCELED)\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s+[AP]M\s+[A-Z]+)\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s+[AP]M\s+[A-Z]+)\s+(.+)$/i
      );

      if (textMatch) {
        const [, requestId, status, datePosted, dueDate, title] = textMatch;
        opportunities.push({
          requestId: requestId.toUpperCase(),
          status: status.toUpperCase() as EBuyOpportunity['status'],
          datePosted,
          dueDate,
          title: title.trim(),
          ebuyUrl: `${EBUY_BASE_URL}?id=${requestId}`,
        });
      }
    }
  }

  console.log(`[eBuy] Parsed ${opportunities.length} opportunities from email`);
  return opportunities;
}

/**
 * Initialize Gmail API client
 * Requires OAuth2 credentials in environment
 */
export async function getGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Gmail OAuth credentials not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN'
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Fetch eBuy notification emails from Gmail
 * @param maxResults - Maximum number of emails to fetch
 * @param unreadOnly - If true, only fetch unread emails (default: false to catch all)
 */
export async function fetchEBuyEmails(
  maxResults = 10,
  unreadOnly = false
): Promise<{ id: string; body: string }[]> {
  const gmail = await getGmailClient();

  // Search for eBuy emails - from GSA eBuy
  const query = unreadOnly
    ? 'from:ebuy_admin@gsa.gov subject:eBuy is:unread'
    : 'from:ebuy_admin@gsa.gov subject:eBuy';

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  });

  const messages = response.data.messages || [];
  console.log(`[eBuy] Found ${messages.length} unread eBuy emails`);

  const emails: { id: string; body: string }[] = [];

  for (const msg of messages) {
    if (!msg.id) continue;

    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'full',
    });

    // Extract body text
    let body = '';
    const payload = detail.data.payload;

    if (payload?.body?.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload?.parts) {
      // Multipart email - find text/plain part
      const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    }

    if (body) {
      emails.push({ id: msg.id, body });
    }
  }

  return emails;
}

/**
 * Mark email as read after processing
 */
export async function markEmailAsRead(messageId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });

  console.log(`[eBuy] Marked email ${messageId} as read`);
}

/**
 * Check if we've already seen this eBuy opportunity
 */
export async function isEBuyOpportunitySeen(requestId: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('seen_ebuy_opportunities')
      .select('request_id')
      .eq('request_id', requestId)
      .single();

    return !!data;
  } catch {
    return false;
  }
}

/**
 * Record that we've seen/posted an eBuy opportunity
 */
export async function recordEBuyOpportunity(opp: EBuyOpportunity): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.from('seen_ebuy_opportunities').upsert({
      request_id: opp.requestId,
      title: opp.title,
      status: opp.status,
      due_date: opp.dueDate,
      ebuy_url: opp.ebuyUrl,
      seen_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[eBuy] Could not record opportunity:', err);
  }
}

/**
 * Filter eBuy opportunities for relevance
 * Uses similar logic to SAM.gov scoring but simpler
 */
export function scoreEBuyOpportunity(opp: EBuyOpportunity): {
  score: number;
  dominated: boolean;
  reasons: string[];
} {
  const title = opp.title.toLowerCase();
  const reasons: string[] = [];
  let score = 50; // Start at baseline

  // Skip canceled
  if (opp.status === 'CANCELED') {
    return { score: 0, reasons: ['Canceled'], dominated: false };
  }

  // Boost for relevant keywords
  const relevantKeywords = [
    'software',
    'development',
    'web',
    'application',
    'app',
    'design',
    'ux',
    'user experience',
    'human-centered',
    'hcd',
    'digital',
    'modernization',
    'agile',
    'cloud',
    'ai',
    'artificial intelligence',
    'machine learning',
    'portal',
    'website',
    'mobile',
    'it services',
    'technology',
    'data',
  ];

  const matched = relevantKeywords.filter((kw) => title.includes(kw));
  if (matched.length > 0) {
    score += matched.length * 10;
    reasons.push(`Keywords: ${matched.slice(0, 3).join(', ')}`);
  }

  // Penalty for likely non-fits
  const excludeKeywords = [
    'furniture',
    'janitorial',
    'construction',
    'vehicle',
    'fleet',
    'security guard',
    'moving services',
    'office supplies',
    'hvac',
    'electrical',
    'plumbing',
    'landscaping',
  ];

  const excluded = excludeKeywords.filter((kw) => title.includes(kw));
  if (excluded.length > 0) {
    score -= 40;
    reasons.push(`Not our space: ${excluded[0]}`);
  }

  // Check if this is a new opportunity vs update
  if (opp.status === 'NEW REQUEST') {
    score += 10;
    reasons.push('New opportunity');
  } else if (opp.status === 'AMENDED') {
    reasons.push('Updated/amended');
  }

  // Cap score
  score = Math.max(0, Math.min(100, score));

  return { score, reasons, dominated: score >= 60 };
}

/**
 * Main function: Scan eBuy emails and return new opportunities
 * Scans both read and unread emails, uses database to deduplicate
 */
export async function scanEBuyEmails(): Promise<EBuyOpportunity[]> {
  console.log('[eBuy] Starting email scan (read + unread)...');

  // Fetch both read and unread emails - database handles deduplication
  const emails = await fetchEBuyEmails(20, false);
  const allOpportunities: EBuyOpportunity[] = [];
  const processedEmailIds: string[] = [];

  for (const email of emails) {
    const opportunities = parseEBuyEmail(email.body);

    for (const opp of opportunities) {
      // Check if already seen
      const seen = await isEBuyOpportunitySeen(opp.requestId);
      if (seen) {
        console.log(`[eBuy] Already seen: ${opp.requestId}`);
        continue;
      }

      // Score for relevance
      const { score, reasons, dominated } = scoreEBuyOpportunity(opp);

      if (dominated) {
        console.log(`[eBuy] Relevant (${score}): ${opp.requestId} - ${opp.title}`);
        allOpportunities.push(opp);
      } else {
        console.log(
          `[eBuy] Low relevance (${score}): ${opp.requestId} - ${opp.title.slice(0, 40)}...`
        );
      }

      // Record that we've seen it regardless of score
      await recordEBuyOpportunity(opp);
    }

    processedEmailIds.push(email.id);
  }

  // Mark emails as read after processing
  for (const emailId of processedEmailIds) {
    await markEmailAsRead(emailId);
  }

  console.log(`[eBuy] Found ${allOpportunities.length} new relevant opportunities`);
  return allOpportunities;
}
