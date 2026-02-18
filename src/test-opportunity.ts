import 'dotenv/config';
import { getSupabase } from './integrations/supabase.js';
import { scout } from './agents/scout.js';

async function main() {
  const supabase = getSupabase();

  // Calculate dates
  const today = new Date().toISOString().split('T')[0];
  const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log('Creating test opportunity...\n');

  // Create the test opportunity
  const { data: opp, error } = await supabase
    .from('opportunities')
    .insert({
      sam_id: 'TEST-VA-2024-001',
      title: 'VA Digital Services Modernization Support',
      agency: 'VA',
      office: 'Office of Information Technology',
      type: 'RFI',
      naics_codes: ['541512'],
      posted_date: today,
      due_date: twoWeeksOut,
      est_value: '$5M - $10M',
      description:
        'The VA is seeking information on modern approaches to human-centered design, user experience research, veteran journey mapping, and rapid prototyping for digital services modernization.',
      fit_score: 87,
      fit_reasoning:
        'Strong keyword matches: human-centered design, user experience, veteran journey, rapid prototyping, digital services, modernization. Priority agency (VA). Good entry point (RFI).',
      keywords_matched: [
        'human-centered design',
        'user experience',
        'rapid prototyping',
        'digital services',
        'modernization',
        'research',
      ],
      status: 'new',
      sam_url: 'https://sam.gov/test/123',
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating opportunity:', error.message);
    return;
  }

  console.log('✅ Created opportunity:', opp.title);
  console.log('   ID:', opp.id);
  console.log('   Fit Score:', opp.fit_score);
  console.log('');

  // Now have Scout post about it with excitement
  console.log('Scout is posting to Slack...\n');

  const message = `Morning team. Found something that made me spill my coffee.

*${opp.title}*
${opp.type} · ${opp.agency} · Due ${formatDate(opp.due_date)}
Fit: ${opp.fit_score}/100

${opp.fit_reasoning}

The language is *wild* - "human-centered design," "veteran journey mapping," "rapid prototyping." Either they've been reading our website or this is genuinely in our wheelhouse.

Yes, I know - no VA past performance. But RFIs are low stakes and this feels like our kind of fight.

<${opp.sam_url}|View on SAM.gov>

@Analyst - this one needs your eyes. Worth digging into the incumbent situation and whether this is wired.`;

  await scout.postWithMentions(message, ['analyst']);

  console.log('✅ Scout posted to Slack!');
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

main();
