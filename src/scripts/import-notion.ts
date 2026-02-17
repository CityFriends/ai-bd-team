/**
 * Import data from Notion databases into Supabase
 * - Contracts Overview → past_performance
 * - CRM → teaming_partners
 */
import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const CONTRACTS_DB = '1b807a7951ff80108f3cc323f59c654a';
const CRM_DB = '1bc07a7951ff804c8426d0e3bdfc93a2';
const RATES_DB = '1e607a7951ff805fb849f7e95052b4c9';

interface NotionPage {
  id: string;
  properties: Record<string, any>;
}

async function fetchNotionDatabase(databaseId: string): Promise<NotionPage[]> {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  const data = (await response.json()) as { results?: any[] };
  return data.results || [];
}

function getTextProperty(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === 'title' && prop.title?.[0]) {
    return prop.title[0].plain_text;
  }
  if (prop.type === 'rich_text' && prop.rich_text?.[0]) {
    return prop.rich_text[0].plain_text;
  }
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
  if (prop.type === 'date' && prop.date?.start) {
    return prop.date.start;
  }
  if (prop.type === 'formula' && prop.formula?.date?.start) {
    return prop.formula.date.start;
  }
  return null;
}

function getNumberProperty(prop: any): number | null {
  if (!prop) return null;
  if (prop.type === 'number') return prop.number;
  if (prop.type === 'formula' && prop.formula?.type === 'number') {
    return prop.formula.number;
  }
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
  if (name.includes('cms ') || name.includes('qpp') || name.includes('payment program'))
    return 'Centers for Medicare & Medicaid Services';
  if (name.includes('hhs ') || name.includes('acr-orr'))
    return 'Department of Health and Human Services';
  if (name.includes('irs ') || name.includes('direct file')) return 'Internal Revenue Service';
  if (name.includes('nys ') || name.includes('ny ') || name.includes('new york'))
    return 'New York State';
  if (name.includes('md ') || name.includes('maryland')) return 'Maryland';
  if (name.includes('nmaach') || name.includes('museum')) return 'Smithsonian Institution';
  if (name.includes('abfm') || name.includes('family medicine'))
    return 'American Board of Family Medicine';
  if (name.includes('icc') || name.includes('inclusive capital'))
    return 'Inclusive Capital Collective';
  return 'Unknown';
}

async function importContracts() {
  console.log('\n=== Importing Contracts to past_performance ===\n');

  const pages = await fetchNotionDatabase(CONTRACTS_DB);
  const supabase = getSupabase();

  let imported = 0;
  let skipped = 0;

  for (const page of pages) {
    const props = page.properties;

    const contractName = getTextProperty(props['Contract Name']);
    if (!contractName || contractName === 'null' || contractName.includes('Key')) {
      skipped++;
      continue;
    }

    const status = getSelectProperty(props['Status']);
    if (status === 'Info Only') {
      skipped++;
      continue;
    }

    const agency = inferAgency(contractName);
    const contractNumber = getTextProperty(props['Prime Contract Number']);
    const contractValue = getNumberProperty(props['Prime Contract Value']);
    const vehicle = getSelectProperty(props['Vehicle']);
    const setAside = getSelectProperty(props['Set-Aside']);
    const naicsCode = getSelectProperty(props['NAICS Code']);
    const popStart = getDateProperty(props['Base Start']);
    const popEnd = getDateProperty(props['Contract End']);
    const billableTypes = getMultiSelectProperty(props['Billable Type']);
    const roles = getMultiSelectProperty(props['Roles']);
    const fteCount = getNumberProperty(props['FTE Count']);
    const projectPoc = getTextProperty(props['Project POC']);
    const pocEmail = getEmailProperty(props['POC Email']);
    const notes = getTextProperty(props['Notes']);

    // Build tags
    const tags: string[] = [];
    if (setAside && setAside !== 'None') tags.push(setAside);
    if (billableTypes.length) tags.push(...billableTypes);
    if (roles.length) tags.push(...roles);
    if (vehicle && vehicle !== 'None') tags.push(vehicle);

    // Determine our role
    let ourRole = 'Prime';
    if (contractName.toLowerCase().includes('sub') || (fteCount && fteCount <= 2)) {
      ourRole = 'Subcontractor';
    }

    const record = {
      contract_name: contractName,
      agency: agency,
      contract_number: contractNumber,
      contract_vehicle: vehicle !== 'None' ? vehicle : null,
      pop_start: popStart,
      pop_end: popEnd,
      contract_value: contractValue,
      our_role: ourRole,
      relevant_naics: naicsCode && naicsCode !== 'N/A' ? [naicsCode] : null,
      tags: tags.length > 0 ? tags : null,
      client_contact_name: projectPoc,
      client_contact_email: pocEmail,
      description: notes || `${contractName} - ${agency}`,
      referenceable: status === 'Active' || status === 'Complete',
    };

    // Check if already exists
    const { data: existing } = await supabase
      .from('past_performance')
      .select('id')
      .eq('contract_name', contractName)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('past_performance')
        .update({ ...record, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) {
        console.error(`  Error updating ${contractName}:`, error.message);
      } else {
        console.log(`  Updated: ${contractName}`);
        imported++;
      }
    } else {
      const { error } = await supabase.from('past_performance').insert(record);
      if (error) {
        console.error(`  Error inserting ${contractName}:`, error.message);
      } else {
        console.log(`  Added: ${contractName}`);
        imported++;
      }
    }
  }

  console.log(`\nContracts: ${imported} imported, ${skipped} skipped`);
}

async function importTeamingPartners() {
  console.log('\n=== Importing CRM to teaming_partners ===\n');

  const pages = await fetchNotionDatabase(CRM_DB);
  const supabase = getSupabase();

  let imported = 0;
  let skipped = 0;

  for (const page of pages) {
    const props = page.properties;

    const companyName = getTextProperty(props['Company']);
    if (!companyName || companyName === 'Internal / 1099') {
      skipped++;
      continue;
    }

    const capabilities = getMultiSelectProperty(props['Core Capabilities']);
    const sbaDesignations = getMultiSelectProperty(props['SBA Designations']);
    const strengths = getMultiSelectProperty(props['Strengths']);
    const weaknesses = getMultiSelectProperty(props['Weaknesses']);
    const clients = getMultiSelectProperty(props['Federal, State, & Commercial Clients']);
    const partneringStatus = getSelectProperty(props['Partnering Status']);
    const website = getUrlProperty(props['Website URL']);
    const pocName = getTextProperty(props['Primary Point of Contact Name ']);
    const pocEmail = getEmailProperty(props['POC Email']);
    const pocTitle = getTextProperty(props['POC Title']);
    const notes = getTextProperty(props['Notes']);
    const additionalCapabilities = getTextProperty(props['Additional Capabilities or specialties']);

    // Map partnering status
    let relationshipStatus = 'Prospect';
    if (partneringStatus === 'Good to Go') relationshipStatus = 'Active';
    else if (partneringStatus === 'Vetting Stage') relationshipStatus = 'Vetting';
    else if (partneringStatus === 'Black Listed') relationshipStatus = 'Inactive';

    // Extract set-asides from SBA designations
    const setAsides = sbaDesignations.filter((d) =>
      ['8(a)', 'SDVOSB', 'WOSB', 'EDWOSB', 'HUBZone', 'VOSB'].includes(d)
    );

    const record = {
      company_name: companyName,
      website: website,
      capabilities: capabilities.length > 0 ? capabilities : null,
      certifications: sbaDesignations.length > 0 ? sbaDesignations : null,
      set_asides: setAsides.length > 0 ? setAsides : null,
      relationship_status: relationshipStatus,
      relationship_notes: notes,
      contact_name: pocName ? `${pocName}${pocTitle ? ` (${pocTitle})` : ''}` : null,
      contact_email: pocEmail,
      strengths: strengths.length > 0 ? strengths : null,
      weaknesses: weaknesses.length > 0 ? weaknesses : null,
      notes:
        additionalCapabilities || (clients.length > 0 ? `Clients: ${clients.join(', ')}` : null),
    };

    // Check if already exists
    const { data: existing } = await supabase
      .from('teaming_partners')
      .select('id')
      .eq('company_name', companyName)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('teaming_partners')
        .update({ ...record, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) {
        console.error(`  Error updating ${companyName}:`, error.message);
      } else {
        console.log(`  Updated: ${companyName}`);
        imported++;
      }
    } else {
      const { error } = await supabase.from('teaming_partners').insert(record);
      if (error) {
        console.error(`  Error inserting ${companyName}:`, error.message);
      } else {
        console.log(`  Added: ${companyName}`);
        imported++;
      }
    }
  }

  console.log(`\nTeaming Partners: ${imported} imported, ${skipped} skipped`);
}

async function importLaborRates() {
  console.log('\n=== Importing GSA MAS Labor Rates ===\n');

  const pages = await fetchNotionDatabase(RATES_DB);
  const supabase = getSupabase();

  let imported = 0;
  let skipped = 0;

  for (const page of pages) {
    const props = page.properties;

    const category = getTextProperty(props['Labor Category']);
    if (!category) {
      skipped++;
      continue;
    }

    const year1 = getNumberProperty(props['Year 1 Rate ']);
    const year2 = getNumberProperty(props['Year 2 Rate ']);
    const year3 = getNumberProperty(props['Year 3 Rate (Current)']);
    // Year 4 and Year 5 rates are captured in Notion but not currently used
    // as we only use Year 3 (current) rate for labor rate calculations
    const sin = getSelectProperty(props['SIN']);
    const notes = getTextProperty(props['Notes']);

    // Use year 3 as current rate (or fallback)
    const currentRate = year3 || year2 || year1;
    if (!currentRate) {
      skipped++;
      continue;
    }

    const record = {
      labor_category: category,
      hourly_rate_low: currentRate,
      hourly_rate_high: currentRate,
      contract_vehicle: 'GSA MAS 47QTCA23D0076',
      notes: sin ? `SIN: ${sin}${notes ? ' - ' + notes : ''}` : notes,
    };

    // Check if exists
    const { data: existing } = await supabase
      .from('labor_rates')
      .select('id')
      .eq('labor_category', category)
      .eq('contract_vehicle', 'GSA MAS 47QTCA23D0076')
      .single();

    if (existing) {
      const { error } = await supabase
        .from('labor_rates')
        .update({ ...record, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) {
        console.error(`  Error updating ${category}:`, error.message);
      } else {
        console.log(`  Updated: ${category} - $${currentRate}/hr`);
        imported++;
      }
    } else {
      const { error } = await supabase.from('labor_rates').insert(record);
      if (error) {
        console.error(`  Error inserting ${category}:`, error.message);
      } else {
        console.log(`  Added: ${category} - $${currentRate}/hr`);
        imported++;
      }
    }
  }

  console.log(`\nLabor Rates: ${imported} imported, ${skipped} skipped`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Importing Notion Data to Supabase');
  console.log('='.repeat(60));

  await importContracts();
  await importTeamingPartners();
  await importLaborRates();

  console.log('\n' + '='.repeat(60));
  console.log('  Import Complete!');
  console.log('='.repeat(60));

  // Show summary
  const supabase = getSupabase();
  const { data: ppCount } = await supabase
    .from('past_performance')
    .select('id', { count: 'exact' });
  const { data: tpCount } = await supabase
    .from('teaming_partners')
    .select('id', { count: 'exact' });
  const { data: lrCount } = await supabase.from('labor_rates').select('id', { count: 'exact' });

  console.log(`\nDatabase now has:`);
  console.log(`  - ${ppCount?.length || 0} past performance records`);
  console.log(`  - ${tpCount?.length || 0} teaming partners`);
  console.log(`  - ${lrCount?.length || 0} labor rates`);
}

main().catch(console.error);
