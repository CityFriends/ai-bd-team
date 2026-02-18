// Test FPDS API raw response
import 'dotenv/config';

const FPDS_BASE_URL = 'https://www.fpds.gov/ezsearch/fpdsportal';

async function testRaw() {
  console.log('=== Testing FPDS Raw API ===\n');

  const query = 'Agile Six';
  const url = new URL(FPDS_BASE_URL);
  url.searchParams.set('s', 'FPDS.GOV');
  url.searchParams.set('indexName', 'awardfull');
  url.searchParams.set('templateName', '1.5.3');
  url.searchParams.set('q', query);
  url.searchParams.set('rss', '1');

  console.log('URL:', url.toString());

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/atom+xml, application/xml, text/xml',
      'User-Agent': 'BD-Team-Research-Bot/1.0',
    },
  });

  console.log('Status:', response.status);
  console.log('Content-Type:', response.headers.get('content-type'));

  const text = await response.text();
  console.log('\nResponse length:', text.length);
  console.log('\nFirst 2000 chars:');
  console.log(text.slice(0, 2000));

  // Check for entries
  const entryCount = (text.match(/<entry>/g) || []).length;
  console.log('\n\nEntry count:', entryCount);
}

testRaw().catch(console.error);
