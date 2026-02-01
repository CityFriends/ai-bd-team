/**
 * Scheduled sync for company data
 * Runs website scrape and Notion import on a schedule
 *
 * Usage:
 *   npm run sync           # Run once now
 *   npm run sync:schedule  # Run on schedule (keeps running)
 */
import 'dotenv/config';
import cron from 'node-cron';
import { getSupabase } from '../integrations/supabase.js';

// ============================================
// Configuration
// ============================================
const NOTION_API_KEY = process.env.NOTION_API_KEY || 'ntn_J20547711999qfDPwjgH9DA2Tx5VbTdbQrwtdlCITYa0Fh';
const CONTRACTS_DB = '1b807a7951ff80108f3cc323f59c654a';
const CRM_DB = '1bc07a7951ff804c8426d0e3bdfc93a2';
const RATES_DB = '1e607a7951ff805fb849f7e95052b4c9';

// ============================================
// Notion API helpers
// ============================================
interface NotionPage {
  id: string;
  properties: Record<string, any>;
}

async function fetchNotionDatabase(databaseId: string): Promise<NotionPage[]> {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const data = await response.json();
  return data.results || [];
}

function getTextProperty(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === 'title' && prop.title?.[0]) return prop.title[0].plain_text;
  if (prop.type === 'rich_text' && prop.rich_text?.[0]) return prop.rich_text[0].plain_text;
  return null;
}

function getSelectProperty(prop: any): string | null {
  if (!prop || !prop.select) return null;
  return prop.select.name;
}

function getMultiSelectProperty(prop: any): string[] {
  if (!prop || !prop.multi_select) return [];
  return prop.multi_select.map((s: any) => s.name);
}

function getDateProperty(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === 'date' && prop.date?.start) return prop.date.start;
  if (prop.type === 'formula' && prop.formula?.date?.start) return prop.formula.date.start;
  return null;
}

function getNumberProperty(prop: any): number | null {
  if (!prop) return null;
  if (prop.type === 'number') return prop.number;
  if (prop.type === 'formula' && prop.formula?.type === 'number') return prop.formula.number;
  return null;
}

function getEmailProperty(prop: any): string | null {
  if (!prop || prop.type !== 'email') return null;
  return prop.email;
}

function getUrlProperty(prop: any): string | null {
  if (!prop || prop.type !== 'url') return null;
  return prop.url;
}

function inferAgency(contractName: string): string {
  const name = contractName.toLowerCase();
  if (name.includes('va ') || name.includes('veteran')) return 'Department of Veterans Affairs';
  if (name.includes('cms ') || name.includes('qpp') || name.includes('payment program')) return 'Centers for Medicare & Medicaid Services';
  if (name.includes('hhs ') || name.includes('acr-orr')) return 'Department of Health and Human Services';
  if (name.includes('irs ') || name.includes('direct file')) return 'Internal Revenue Service';
  if (name.includes('nys ') || name.includes('ny ') || name.includes('new york')) return 'New York State';
  if (name.includes('md ') || name.includes('maryland')) return 'Maryland';
  if (name.includes('nmaach') || name.includes('museum')) return 'Smithsonian Institution';
  if (name.includes('abfm') || name.includes('family medicine')) return 'American Board of Family Medicine';
  if (name.includes('icc') || name.includes('inclusive capital')) return 'Inclusive Capital Collective';
  return 'Unknown';
}

// ============================================
// Sync functions
// ============================================

async function syncContracts(): Promise<number> {
  const pages = await fetchNotionDatabase(CONTRACTS_DB);
  const supabase = getSupabase();
  let synced = 0;

  for (const page of pages) {
    const props = page.properties;
    const contractName = getTextProperty(props['Contract Name']);
    if (!contractName || contractName === 'null' || contractName.includes('Key')) continue;

    const status = getSelectProperty(props['Status']);
    if (status === 'Info Only') continue;

    const record = {
      contract_name: contractName,
      agency: inferAgency(contractName),
      contract_number: getTextProperty(props['Prime Contract Number']),
      contract_vehicle: getSelectProperty(props['Vehicle']) !== 'None' ? getSelectProperty(props['Vehicle']) : null,
      pop_start: getDateProperty(props['Base Start']),
      pop_end: getDateProperty(props['Contract End']),
      contract_value: getNumberProperty(props['Prime Contract Value']),
      our_role: 'Prime',
      relevant_naics: getSelectProperty(props['NAICS Code']) !== 'N/A' ? [getSelectProperty(props['NAICS Code'])] : null,
      tags: [
        getSelectProperty(props['Set-Aside']),
        ...getMultiSelectProperty(props['Billable Type']),
        ...getMultiSelectProperty(props['Roles']),
        getSelectProperty(props['Vehicle']),
      ].filter(t => t && t !== 'None'),
      client_contact_name: getTextProperty(props['Project POC']),
      client_contact_email: getEmailProperty(props['POC Email']),
      referenceable: status === 'Active' || status === 'Complete',
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('past_performance')
      .select('id')
      .eq('contract_name', contractName)
      .single();

    if (existing) {
      await supabase.from('past_performance').update(record).eq('id', existing.id);
    } else {
      await supabase.from('past_performance').insert(record);
    }
    synced++;
  }

  return synced;
}

async function syncTeamingPartners(): Promise<number> {
  const pages = await fetchNotionDatabase(CRM_DB);
  const supabase = getSupabase();
  let synced = 0;

  for (const page of pages) {
    const props = page.properties;
    const companyName = getTextProperty(props['Company']);
    if (!companyName || companyName === 'Internal / 1099') continue;

    const sbaDesignations = getMultiSelectProperty(props['SBA Designations']);
    const partneringStatus = getSelectProperty(props['Partnering Status']);

    let relationshipStatus = 'Prospect';
    if (partneringStatus === 'Good to Go') relationshipStatus = 'Active';
    else if (partneringStatus === 'Vetting Stage') relationshipStatus = 'Vetting';
    else if (partneringStatus === 'Black Listed') relationshipStatus = 'Inactive';

    const record = {
      company_name: companyName,
      website: getUrlProperty(props['Website URL']),
      capabilities: getMultiSelectProperty(props['Core Capabilities']),
      certifications: sbaDesignations.length > 0 ? sbaDesignations : null,
      set_asides: sbaDesignations.filter(d => ['8(a)', 'SDVOSB', 'WOSB', 'EDWOSB', 'HUBZone', 'VOSB'].includes(d)),
      relationship_status: relationshipStatus,
      relationship_notes: getTextProperty(props['Notes']),
      contact_name: getTextProperty(props['Primary Point of Contact Name ']),
      contact_email: getEmailProperty(props['POC Email']),
      strengths: getMultiSelectProperty(props['Strengths']),
      weaknesses: getMultiSelectProperty(props['Weaknesses']),
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('teaming_partners')
      .select('id')
      .eq('company_name', companyName)
      .single();

    if (existing) {
      await supabase.from('teaming_partners').update(record).eq('id', existing.id);
    } else {
      await supabase.from('teaming_partners').insert(record);
    }
    synced++;
  }

  return synced;
}

async function syncLaborRates(): Promise<number> {
  const pages = await fetchNotionDatabase(RATES_DB);
  const supabase = getSupabase();
  let synced = 0;

  for (const page of pages) {
    const props = page.properties;
    const category = getTextProperty(props['Labor Category']);
    if (!category) continue;

    const currentRate = getNumberProperty(props['Year 3 Rate (Current)']) ||
                        getNumberProperty(props['Year 2 Rate ']) ||
                        getNumberProperty(props['Year 1 Rate ']);
    if (!currentRate) continue;

    const sin = getSelectProperty(props['SIN']);

    const record = {
      labor_category: category,
      hourly_rate_low: currentRate,
      hourly_rate_high: currentRate,
      contract_vehicle: 'GSA MAS 47QTCA23D0076',
      notes: sin ? `SIN: ${sin}` : null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('labor_rates')
      .select('id')
      .eq('labor_category', category)
      .eq('contract_vehicle', 'GSA MAS 47QTCA23D0076')
      .single();

    if (existing) {
      await supabase.from('labor_rates').update(record).eq('id', existing.id);
    } else {
      await supabase.from('labor_rates').insert(record);
    }
    synced++;
  }

  return synced;
}

async function logSync(source: string, recordCount: number, status: 'success' | 'error', error?: string) {
  const supabase = getSupabase();

  // Create sync_log table if it doesn't exist (will fail silently if exists)
  await supabase.from('sync_log').insert({
    source,
    record_count: recordCount,
    status,
    error_message: error,
    synced_at: new Date().toISOString(),
  }).then(() => {}).catch(() => {});
}

// ============================================
// Main sync function
// ============================================

async function runSync() {
  const timestamp = new Date().toISOString();
  console.log(`\n[${ timestamp }] Starting sync...`);

  try {
    // Sync Notion data
    const contracts = await syncContracts();
    console.log(`  ✓ Synced ${contracts} contracts`);
    await logSync('notion_contracts', contracts, 'success');

    const partners = await syncTeamingPartners();
    console.log(`  ✓ Synced ${partners} teaming partners`);
    await logSync('notion_crm', partners, 'success');

    const rates = await syncLaborRates();
    console.log(`  ✓ Synced ${rates} labor rates`);
    await logSync('notion_rates', rates, 'success');

    console.log(`[${new Date().toISOString()}] Sync complete!`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] Sync failed:`, error);
    await logSync('sync', 0, 'error', String(error));
  }
}

// ============================================
// Scheduler
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  Company Data Sync Scheduler');
    console.log('='.repeat(60));
    console.log('\nSchedule:');
    console.log('  - Every 6 hours: Notion sync (contracts, partners, rates)');
    console.log('  - Press Ctrl+C to stop\n');

    // Run immediately on start
    await runSync();

    // Schedule: Every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      await runSync();
    });

    // Keep process running
    console.log('Scheduler running. Waiting for next sync...');

  } else {
    // One-time sync
    console.log('Running one-time sync...');
    await runSync();
    process.exit(0);
  }
}

main().catch(console.error);
