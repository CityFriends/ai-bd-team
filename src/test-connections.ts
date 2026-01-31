import 'dotenv/config';

async function testSupabase(): Promise<boolean> {
  console.log('\n🔌 Testing Supabase connection...');
  try {
    const { getSupabase } = await import('./integrations/supabase.js');
    const supabase = getSupabase();

    // Try to query the opportunities table (even if empty)
    const { data, error } = await supabase
      .from('opportunities')
      .select('id')
      .limit(1);

    if (error) {
      console.log('   ❌ Supabase error:', error.message);
      return false;
    }

    console.log('   ✅ Supabase connected! Found', data?.length || 0, 'opportunities');
    return true;
  } catch (err) {
    console.log('   ❌ Supabase failed:', (err as Error).message);
    return false;
  }
}

async function testSlack(): Promise<boolean> {
  console.log('\n💬 Testing Slack connection...');
  try {
    const { App } = await import('@slack/bolt');

    const app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET,
      appToken: process.env.SLACK_APP_TOKEN,
      socketMode: true,
    });

    // Post a test message
    const result = await app.client.chat.postMessage({
      channel: process.env.SLACK_CHANNEL_ID!,
      text: '🧪 *Connection Test*\n\nBD Team AI Agents checking in. All systems operational.',
    });

    if (result.ok) {
      console.log('   ✅ Slack connected! Test message posted (ts:', result.ts, ')');
      return true;
    } else {
      console.log('   ❌ Slack error:', result.error);
      return false;
    }
  } catch (err) {
    console.log('   ❌ Slack failed:', (err as Error).message);
    return false;
  }
}

async function testClaude(): Promise<boolean> {
  console.log('\n🤖 Testing Claude API...');
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say "Connection successful!" in exactly 2 words.' }],
    });

    const text = response.content[0];
    if (text.type === 'text') {
      console.log('   ✅ Claude connected! Response:', text.text.trim());
      return true;
    }
    return false;
  } catch (err) {
    console.log('   ❌ Claude failed:', (err as Error).message);
    return false;
  }
}

async function testSamGov(): Promise<boolean> {
  console.log('\n🏛️  Testing SAM.gov API...');
  try {
    const apiKey = process.env.SAM_API_KEY;
    if (!apiKey) {
      console.log('   ❌ SAM_API_KEY not set');
      return false;
    }

    // Simple search for recent opportunities
    const today = new Date();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const formatDate = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

    const params = new URLSearchParams({
      api_key: apiKey,
      postedFrom: formatDate(weekAgo),
      postedTo: formatDate(today),
      limit: '5',
    });

    const url = `https://api.sam.gov/opportunities/v2/search?${params}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      console.log('   ❌ SAM.gov error:', response.status, text.substring(0, 100));
      return false;
    }

    const data = await response.json() as { totalRecords?: number };
    console.log('   ✅ SAM.gov connected! Found', data.totalRecords || 0, 'opportunities in last 7 days');
    return true;
  } catch (err) {
    console.log('   ❌ SAM.gov failed:', (err as Error).message);
    return false;
  }
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  BD Team AI Agents - Connection Tests  ');
  console.log('═══════════════════════════════════════');

  const results = {
    supabase: await testSupabase(),
    slack: await testSlack(),
    claude: await testClaude(),
    samGov: await testSamGov(),
  };

  console.log('\n═══════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════');
  console.log('  Supabase:', results.supabase ? '✅ PASS' : '❌ FAIL');
  console.log('  Slack:   ', results.slack ? '✅ PASS' : '❌ FAIL');
  console.log('  Claude:  ', results.claude ? '✅ PASS' : '❌ FAIL');
  console.log('  SAM.gov: ', results.samGov ? '✅ PASS' : '❌ FAIL');
  console.log('═══════════════════════════════════════\n');

  const allPassed = Object.values(results).every(r => r);
  process.exit(allPassed ? 0 : 1);
}

main();
