// Test FPDS API directly (bypass cache)
import 'dotenv/config';

const FPDS_BASE_URL = 'https://www.fpds.gov/ezsearch/fpdsportal';

interface FPDSContract {
  contractId: string;
  vendorName: string;
  agencyName: string;
  contractDescription: string;
  obligatedAmount: number;
  signedDate: string;
  contractType?: string;
}

function extractXMLValue(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : undefined;
}

function extractCDATA(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const match = xml.match(regex);
  if (match) return match[1].trim();
  return extractXMLValue(xml, tag);
}

function parseRSSFeed(xml: string, limit: number): FPDSContract[] {
  const contracts: FPDSContract[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && contracts.length < limit) {
    const entry = match[1];
    const title = extractCDATA(entry, 'title') || '';
    const pubDate = extractXMLValue(entry, 'pubDate') || '';
    const link = extractXMLValue(entry, 'link') || '';

    // Parse vendor name
    let vendorName = 'Unknown Vendor';
    const vendorMatch = title.match(/awarded to ([^,]+?)(?:,| for | was )/i);
    if (vendorMatch) vendorName = vendorMatch[1].trim();

    // Parse amount
    let amount = 0;
    const amountMatch = title.match(
      /(?:for the amount of |for |amount of )\$?([-\d,]+(?:\.\d{2})?)/i
    );
    if (amountMatch) amount = parseFloat(amountMatch[1].replace(/,/g, ''));

    // Parse contract ID
    let contractId = `fpds-${contracts.length}`;
    const contractMatch = title.match(/(?:CONTRACT|ORDER|AGREEMENT)\s+([A-Z0-9]+)/i);
    if (contractMatch) contractId = contractMatch[1];

    // Parse agency
    let agencyName = 'Unknown Agency';
    const agencyMatch = link.match(/AGENCY_CODE%3A%22(\d+)%22/);
    if (agencyMatch) agencyName = `Agency ${agencyMatch[1]}`;

    // Parse date
    const signedDate = pubDate.split('T')[0] || '';

    contracts.push({
      contractId,
      vendorName,
      agencyName,
      contractDescription: title,
      obligatedAmount: amount,
      signedDate,
    });
  }

  return contracts;
}

async function searchFPDS(query: string): Promise<FPDSContract[]> {
  const url = new URL(FPDS_BASE_URL);
  url.searchParams.set('s', 'FPDS.GOV');
  url.searchParams.set('indexName', 'awardfull');
  url.searchParams.set('templateName', '1.5.3');
  url.searchParams.set('q', query);
  url.searchParams.set('rss', '1');

  console.log(`Searching: ${query}`);
  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/xml',
      'User-Agent': 'BD-Team/1.0',
    },
  });

  const xml = await response.text();
  return parseRSSFeed(xml, 10);
}

async function test() {
  console.log('=== Testing FPDS API (fresh, no cache) ===\n');

  // Test 1: Agile Six
  console.log('Test 1: "Agile Six"');
  const agileResults = await searchFPDS('Agile Six');
  console.log(`Found ${agileResults.length} contracts`);
  agileResults.slice(0, 5).forEach((c) => {
    console.log(
      `  - ${c.vendorName}: $${(c.obligatedAmount / 1000000).toFixed(2)}M (${c.signedDate})`
    );
  });

  // Test 2: Quality Payment Program
  console.log('\nTest 2: "Quality Payment Program"');
  const qppResults = await searchFPDS('Quality Payment Program');
  console.log(`Found ${qppResults.length} contracts`);
  qppResults.slice(0, 5).forEach((c) => {
    console.log(`  - ${c.vendorName}: $${(c.obligatedAmount / 1000000).toFixed(2)}M`);
  });

  // Test 3: VA contracts
  console.log('\nTest 3: "VA veterans modernization"');
  const vaResults = await searchFPDS('VA veterans modernization');
  console.log(`Found ${vaResults.length} contracts`);
  vaResults.slice(0, 5).forEach((c) => {
    console.log(`  - ${c.vendorName}: $${(c.obligatedAmount / 1000000).toFixed(2)}M`);
  });
}

test().catch(console.error);
