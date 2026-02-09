/**
 * Rosa's Proactive Partner Scanner
 *
 * Weekly (Monday 9am): Scans for potential teaming partners
 * - Federal contractors in complementary NAICS codes
 * - Companies with 8(a), WOSB, SDVOSB certifications
 * - Firms with past performance at target agencies
 *
 * Does NOT reach out - just identifies and reports.
 * Rosa surfaces partner landscape intelligence for human decision on outreach.
 *
 * Usage:
 *   npm run rosa:scan         # Run full scan now
 *   npm run rosa:schedule     # Run on weekly schedule (Monday 9am)
 *   npm run rosa:report       # Generate partner landscape report
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import { getAnthropic } from '../integrations/claude.js';
import {
  getSupabase,
  savePartnerCompany,
  getActivePartners,
  getTeamingHistory,
  searchPartnersByCertification,
  searchPartnersByAgency,
  formatPartnerForContext,
  type PartnerCompany,
} from '../integrations/supabase.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';
import { searchSAMEntities, type SAMEntity } from '../integrations/sam-entity.js';
import { bold, bullets, formatPartnerReport } from '../utils/slack-format.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// NAICS codes we partner on (complementary to FFTC's)
const PARTNER_NAICS_CODES = [
  // Our codes - look for companies we can team with
  '541511', // Custom Computer Programming
  '541512', // Computer Systems Design
  '541519', // Other Computer Services
  '541611', // Management Consulting
  '541430', // Graphic Design

  // Complementary codes - fill our gaps
  '541330', // Engineering Services
  '541690', // Other Scientific Consulting
  '518210', // Data Processing / Hosting
  '541715', // R&D in Physical Sciences (for AI/ML work)
  '541720', // R&D in Social Sciences (for research work)
];

// Certifications we value in partners
const TARGET_CERTIFICATIONS = [
  '8(a)',           // 8(a) Business Development
  'WOSB',           // Women-Owned Small Business
  'EDWOSB',         // Economically Disadvantaged WOSB
  'SDVOSB',         // Service-Disabled Veteran-Owned
  'HUBZone',        // Historically Underutilized Business Zone
  'SDB',            // Small Disadvantaged Business
];

// Target agencies where partner relationships matter most
const TARGET_AGENCIES = [
  'VA', 'HHS', 'CMS', 'DOL', 'ED', 'SBA', 'SSA', 'GSA',
];

// Initialize Rosa's Slack app
async function getRosaApp(): Promise<App | null> {
  const botToken = process.env.ROSA_BOT_TOKEN;
  const appToken = process.env.ROSA_APP_TOKEN;

  if (!botToken || !appToken) {
    console.log('Rosa Slack tokens not configured, running in test mode');
    return null;
  }

  const app = new App({
    token: botToken,
    appToken: appToken,
    socketMode: true,
  });

  await app.start();
  return app;
}

interface PartnerCandidate {
  name: string;
  uei?: string;
  cageCode?: string;
  certifications: string[];
  naicsCodes: string[];
  size: 'small' | 'large' | 'unknown';
  location?: string;
  capabilities?: string;
  whyRelevant: string[];
  source: string;
}

// Search SAM.gov for potential partners
async function searchSAMForPartners(): Promise<PartnerCandidate[]> {
  console.log('Searching SAM.gov for potential partners...');
  const candidates: PartnerCandidate[] = [];

  // Search by NAICS codes with small business filter
  for (const naics of PARTNER_NAICS_CODES.slice(0, 5)) { // Limit to avoid rate limits
    try {
      console.log(`  Searching NAICS ${naics}...`);

      const results = await searchSAMEntities({
        naicsCode: naics,
        businessType: 'small',
        limit: 10,
      });

      for (const entity of results.entities || []) {
        // Check if they have valuable certifications
        const certs = extractCertifications(entity);
        if (certs.length > 0 || hasTargetAgencyExperience(entity)) {
          candidates.push({
            name: entity.legalBusinessName || entity.dbaName || 'Unknown',
            uei: entity.ueiSAM,
            cageCode: entity.cageCode,
            certifications: certs,
            naicsCodes: entity.naicsCodes || [],
            size: 'small',
            location: formatLocation(entity),
            capabilities: entity.purposeOfRegistration,
            whyRelevant: determineRelevance(entity, certs),
            source: 'SAM.gov',
          });
        }
      }

      await new Promise(r => setTimeout(r, 1000)); // Rate limit
    } catch (err) {
      console.warn(`  Error searching NAICS ${naics}:`, err);
    }
  }

  // Deduplicate by UEI
  const seen = new Set<string>();
  return candidates.filter(c => {
    if (!c.uei || seen.has(c.uei)) return false;
    seen.add(c.uei);
    return true;
  });
}

function extractCertifications(entity: SAMEntity): string[] {
  const certs: string[] = [];

  // Check the structured certifications object
  if (entity.certifications) {
    if (entity.certifications.is8a) certs.push('8(a)');
    if (entity.certifications.isWOSB) certs.push('WOSB');
    if (entity.certifications.isEDWOSB) certs.push('EDWOSB');
    if (entity.certifications.isSDVOSB) certs.push('SDVOSB');
    if (entity.certifications.isHUBZone) certs.push('HUBZone');
  }

  // Also check businessTypes array for additional certifications
  if (entity.businessTypes && entity.businessTypes.length > 0) {
    const typeText = entity.businessTypes.join(' ').toLowerCase();
    for (const targetCert of TARGET_CERTIFICATIONS) {
      const normalizedCert = targetCert.replace(/[()]/g, '').toLowerCase();
      if (typeText.includes(normalizedCert) && !certs.includes(targetCert)) {
        certs.push(targetCert);
      }
    }
  }

  return certs;
}

function hasTargetAgencyExperience(entity: SAMEntity): boolean {
  // This would require additional data - for now return false
  // In future, could cross-reference with FPDS data
  return false;
}

function formatLocation(entity: SAMEntity): string {
  const addr = entity.physicalAddress || {};
  if (addr.city && addr.stateOrProvinceCode) {
    return `${addr.city}, ${addr.stateOrProvinceCode}`;
  }
  return '';
}

function determineRelevance(entity: SAMEntity, certs: string[]): string[] {
  const reasons: string[] = [];

  if (certs.includes('8(a)')) {
    reasons.push('8(a) certified - can help us access sole-source opportunities');
  }
  if (certs.includes('WOSB') || certs.includes('EDWOSB')) {
    reasons.push('WOSB certified - helps with diversity requirements');
  }
  if (certs.includes('SDVOSB')) {
    reasons.push('SDVOSB - valuable for VA set-asides');
  }
  if (certs.includes('HUBZone')) {
    reasons.push('HUBZone - price evaluation preference');
  }

  const naics = entity.naicsCodes || [];
  if (naics.includes('541330')) {
    reasons.push('Engineering capability - complements our design work');
  }
  if (naics.includes('518210')) {
    reasons.push('Hosting/cloud capability - can support our implementations');
  }

  if (reasons.length === 0) {
    reasons.push('Potential complementary capability');
  }

  return reasons;
}

// Get existing partners from database (using new relationship memory)
async function getExistingPartners(): Promise<string[]> {
  try {
    const supabase = getSupabase();

    // Check both old companies table and new partner_companies table
    const [oldData, newData] = await Promise.all([
      supabase
        .from('companies')
        .select('name')
        .in('relationship_status', ['researched', 'contacted', 'met', 'teamed']),
      supabase
        .from('partner_companies')
        .select('company_name'),
    ]);

    const oldNames = (oldData.data || []).map(c => c.name?.toLowerCase()).filter(Boolean);
    const newNames = (newData.data || []).map(c => c.company_name?.toLowerCase()).filter(Boolean);

    return [...new Set([...oldNames, ...newNames])];
  } catch {
    return [];
  }
}

// Generate partner landscape report using Claude
async function generatePartnerReport(candidates: PartnerCandidate[]): Promise<string> {
  const client = getAnthropic();

  // Group by certification
  const by8a = candidates.filter(c => c.certifications.includes('8(a)'));
  const byWOSB = candidates.filter(c => c.certifications.includes('WOSB') || c.certifications.includes('EDWOSB'));
  const bySDVOSB = candidates.filter(c => c.certifications.includes('SDVOSB'));
  const byHubzone = candidates.filter(c => c.certifications.includes('HUBZone'));

  const prompt = `You are Rosa, the connector for Friends From The City's BD team.

YOUR VOICE:
- 44, Mexican American from San Antonio
- Former Navy, warm but direct
- Relationship-focused, values fit over credentials
- Uses "y'all" occasionally

You just completed your weekly partner landscape scan. Here's what you found:

8(a) CERTIFIED FIRMS (${by8a.length}):
${by8a.slice(0, 5).map(c => `- ${c.name} (${c.location || 'Unknown'}): ${c.whyRelevant.join(', ')}`).join('\n') || 'None found this week'}

WOSB/EDWOSB FIRMS (${byWOSB.length}):
${byWOSB.slice(0, 5).map(c => `- ${c.name} (${c.location || 'Unknown'}): ${c.whyRelevant.join(', ')}`).join('\n') || 'None found this week'}

SDVOSB FIRMS (${bySDVOSB.length}):
${bySDVOSB.slice(0, 3).map(c => `- ${c.name} (${c.location || 'Unknown'}): ${c.whyRelevant.join(', ')}`).join('\n') || 'None found this week'}

HUBZONE FIRMS (${byHubzone.length}):
${byHubzone.slice(0, 3).map(c => `- ${c.name} (${c.location || 'Unknown'}): ${c.whyRelevant.join(', ')}`).join('\n') || 'None found this week'}

Write a brief weekly partner landscape report for #bd-team.

SLACK FORMATTING (use these EXACTLY):
- Bold: *text* (use for headers)
- Italic: _text_ (use for emphasis)
- Bullets: Start lines with • for lists

STRUCTURE YOUR POST LIKE THIS:

*Weekly Partner Landscape Scan*

[Brief intro in Rosa's voice - what you looked for this week]

*Interesting Finds*
• *[Company Name]* ([Location]) — [Why they're interesting, 1 sentence]
• *[Company Name]* ([Location]) — [Why they're interesting]
• *[Company Name]* ([Location]) — [Why they're interesting]

*Gaps I'm Seeing*
• [What types of partners we still need but didn't find]

*My Recommendation*
[1-2 sentences on who to prioritize. Ask for direction on next steps.]

Keep it under 300 words. Use the bullet format - it's cleaner.
End with something like "Let me know if you want me to dig deeper on any of these, or if there's a specific capability gap I should focus on next week."`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return textBlock?.type === 'text' ? textBlock.text : '';
}

// Generate quiet week message
function getQuietWeekMessage(): string {
  const messages = [
    "Did my weekly partner scan - it's quiet out there. Either folks aren't updating their SAM registrations, or we've already identified the good ones. I'll cast a wider net next week.",
    "Ran through the usual sources for partners this week. Nothing jumped out that we don't already know about. Let me know if there's a specific capability gap I should focus on.",
    "Partner landscape scan complete. Slim pickings this week - might be worth looking at industry events or GovCon conferences for fresh connections. Thoughts?",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

async function postToSlack(app: App | null, message: string): Promise<void> {
  if (app) {
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
    });
    console.log('Posted to Slack');
  } else {
    console.log('\n--- Would post to Slack ---');
    console.log(message);
    console.log('----------------------------\n');
  }
}

// Save candidates to database for future reference (using new relationship memory)
async function saveCandidates(candidates: PartnerCandidate[]): Promise<void> {
  let savedCount = 0;

  for (const candidate of candidates.slice(0, 20)) {
    try {
      await savePartnerCompany({
        company_name: candidate.name,
        cage_code: candidate.cageCode,
        certifications: candidate.certifications,
        naics_codes: candidate.naicsCodes,
        capabilities: candidate.whyRelevant, // Use relevance reasons as capabilities
        relationship_status: 'prospect',
        relationship_notes: `Auto-discovered by Rosa scanner from ${candidate.source}. ${candidate.location ? `Location: ${candidate.location}` : ''}`,
        added_by: 'rosa',
      });
      savedCount++;
    } catch (err) {
      // Ignore duplicates
    }
  }

  console.log(`Saved ${savedCount} candidates to partner database`);
}

// Get relationship memory context for opportunities
export async function getRelationshipContext(params: {
  agencyCode?: string;
  certificationNeeded?: string;
}): Promise<string> {
  const lines: string[] = ['=== RELATIONSHIP MEMORY ==='];

  // Get existing partners we've worked with
  const activePartners = await getActivePartners();
  if (activePartners.length > 0) {
    lines.push('\n*Partners We Know:*');
    for (const partner of activePartners.slice(0, 5)) {
      lines.push(formatPartnerForContext(partner));
      lines.push('');
    }
  }

  // If looking for a specific agency, find partners with that experience
  if (params.agencyCode) {
    const agencyPartners = await searchPartnersByAgency(params.agencyCode);
    if (agencyPartners.length > 0) {
      lines.push(`\n*Partners with ${params.agencyCode} Experience:*`);
      for (const partner of agencyPartners.slice(0, 3)) {
        lines.push(`• ${partner.company_name} - ${partner.certifications?.join(', ') || 'No certs'}`);
      }
    }
  }

  // If looking for a specific certification, find partners with it
  if (params.certificationNeeded) {
    const certPartners = await searchPartnersByCertification(params.certificationNeeded);
    if (certPartners.length > 0) {
      lines.push(`\n*${params.certificationNeeded} Certified Partners:*`);
      for (const partner of certPartners.slice(0, 3)) {
        lines.push(`• ${partner.company_name} (${partner.relationship_status.replace('_', ' ')})`);
      }
    }
  }

  if (lines.length === 1) {
    return ''; // No relationship data
  }

  lines.push('\n=== END RELATIONSHIP MEMORY ===');
  return lines.join('\n');
}

export async function runWeeklyPartnerScan(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`  Rosa's Weekly Partner Scan - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getRosaApp();

  // Search for potential partners
  const candidates = await searchSAMForPartners();
  console.log(`\nFound ${candidates.length} potential partner candidates`);

  // Filter out companies we already know
  const existingPartners = await getExistingPartners();
  const newCandidates = candidates.filter(c =>
    !existingPartners.includes(c.name.toLowerCase())
  );
  console.log(`${newCandidates.length} are new (not in our database)`);

  // Generate and post report
  if (newCandidates.length > 0) {
    const report = await generatePartnerReport(newCandidates);
    await postToSlack(app, report);

    // Save to database
    await saveCandidates(newCandidates);

    // Log to agent memory
    try {
      const supabase = getSupabase();
      await supabase.from('agent_memory').insert({
        agent: 'rosa',
        response_text: report,
        sources: ['sam.gov'],
        confidence_level: 'MEDIUM',
        created_at: new Date().toISOString(),
      });
    } catch {
      // Ignore logging failures
    }
  } else {
    await postToSlack(app, getQuietWeekMessage());
  }

  if (app) {
    await app.stop();
  }

  console.log('\nWeekly partner scan complete');
}

// Generate detailed partner report (on demand)
export async function generateDetailedReport(): Promise<string> {
  console.log('Generating detailed partner report...');

  try {
    const supabase = getSupabase();

    // Get all researched companies
    const { data: companies } = await supabase
      .from('companies')
      .select('*')
      .in('relationship_status', ['researched', 'contacted', 'met', 'teamed'])
      .order('updated_at', { ascending: false })
      .limit(50);

    if (!companies || companies.length === 0) {
      return 'No partner candidates in database yet. Run `npm run rosa:scan` to populate.';
    }

    const by8a = companies.filter(c => c.certifications?.includes('8(a)'));
    const byWOSB = companies.filter(c =>
      c.certifications?.includes('WOSB') || c.certifications?.includes('EDWOSB')
    );
    const bySDVOSB = companies.filter(c => c.certifications?.includes('SDVOSB'));
    const teamed = companies.filter(c => c.relationship_status === 'teamed');

    let report = '*Partner Landscape Report*\n\n';
    report += `Total companies tracked: ${companies.length}\n\n`;

    report += `*By Certification:*\n`;
    report += `• 8(a): ${by8a.length} companies\n`;
    report += `• WOSB/EDWOSB: ${byWOSB.length} companies\n`;
    report += `• SDVOSB: ${bySDVOSB.length} companies\n\n`;

    report += `*Relationship Status:*\n`;
    report += `• Researched: ${companies.filter(c => c.relationship_status === 'researched').length}\n`;
    report += `• Contacted: ${companies.filter(c => c.relationship_status === 'contacted').length}\n`;
    report += `• Met: ${companies.filter(c => c.relationship_status === 'met').length}\n`;
    report += `• Teamed: ${teamed.length}\n\n`;

    if (teamed.length > 0) {
      report += `*Active Teaming Partners:*\n`;
      for (const partner of teamed) {
        report += `• ${partner.name} - ${(partner.certifications || []).join(', ')}\n`;
      }
    }

    return report;
  } catch (err) {
    console.error('Error generating report:', err);
    return 'Error generating report.';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');
  const reportMode = args.includes('--report') || args.includes('-r');

  if (reportMode) {
    const report = await generateDetailedReport();
    console.log(report);
    return;
  }

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Rosa Partner Scanner - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nSchedule (CST):');
    console.log('  - Monday at 9:00 AM CST: Weekly partner landscape scan');
    console.log('  - Press Ctrl+C to stop\n');

    // Run immediately on start
    await runWeeklyPartnerScan();

    // Monday at 9am CST = 15:00 UTC (standard time)
    cron.schedule('0 15 * * 1', async () => {
      console.log('\n[CRON] Running weekly partner scan...');
      await runWeeklyPartnerScan();
    });

    console.log('Scheduler running...');

  } else {
    // One-time scan
    await runWeeklyPartnerScan();
  }
}

main().catch(console.error);
