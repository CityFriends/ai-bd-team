/**
 * Company Onboarding Script
 * Patricia guides users through filling in company profile gaps
 */

import { getSupabase } from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';
import * as readline from 'readline';

interface ProfileGap {
  field: string;
  displayName: string;
  question: string;
  priority: 'high' | 'medium' | 'low';
  type: 'text' | 'array' | 'number';
}

const PROFILE_GAPS: ProfileGap[] = [
  { field: 'company_name', displayName: 'Company Name', question: "What's the official company name?", priority: 'high', type: 'text' },
  { field: 'tagline', displayName: 'Tagline', question: "Do you have a tagline or slogan? Something short that captures what you do.", priority: 'medium', type: 'text' },
  { field: 'elevator_pitch', displayName: 'Elevator Pitch', question: "Give me your 30-second pitch - what does the company do and why does it matter?", priority: 'high', type: 'text' },
  { field: 'capabilities', displayName: 'Core Capabilities', question: "What are your core capabilities? (list them, I'll capture each one)", priority: 'high', type: 'array' },
  { field: 'differentiators', displayName: 'Differentiators', question: "What makes you different from competitors? What's your secret sauce?", priority: 'high', type: 'array' },
  { field: 'certifications', displayName: 'Certifications', question: "Any certifications? (ISO, CMMI, clearances, etc.)", priority: 'medium', type: 'array' },
  { field: 'set_asides', displayName: 'Set-Asides', question: "What set-aside categories do you qualify for? (8(a), HUBZone, WOSB, SDVOSB, etc.)", priority: 'high', type: 'array' },
  { field: 'naics_codes', displayName: 'NAICS Codes', question: "What NAICS codes do you use? (list the ones you're registered for in SAM)", priority: 'high', type: 'array' },
  { field: 'contract_vehicles', displayName: 'Contract Vehicles', question: "What contract vehicles are you on? (GSA Schedule, CIO-SP3, Alliant, etc.)", priority: 'high', type: 'array' },
  { field: 'agency_experience', displayName: 'Agency Experience', question: "Which agencies have you worked with?", priority: 'medium', type: 'array' },
  { field: 'ideal_opportunity', displayName: 'Ideal Opportunity', question: "Describe your ideal opportunity - what's the sweet spot?", priority: 'medium', type: 'text' },
  { field: 'no_bid_criteria', displayName: 'No-Bid Criteria', question: "What makes you automatically pass on an opportunity?", priority: 'medium', type: 'array' },
  { field: 'team_size', displayName: 'Team Size', question: "How many people on the team?", priority: 'low', type: 'number' },
  { field: 'location', displayName: 'Location', question: "Where's the company based?", priority: 'low', type: 'text' },
  { field: 'website', displayName: 'Website', question: "What's your website URL?", priority: 'low', type: 'text' },
  { field: 'cage_code', displayName: 'CAGE Code', question: "What's your CAGE code?", priority: 'medium', type: 'text' },
  { field: 'uei', displayName: 'UEI', question: "What's your Unique Entity ID (UEI)?", priority: 'medium', type: 'text' },
];

async function getExistingProfile(): Promise<Record<string, any> | null> {
  const { data, error } = await getSupabase()
    .from('company_profile')
    .select('*')
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching profile:', error);
  }

  return data;
}

function findGaps(profile: Record<string, any> | null): ProfileGap[] {
  if (!profile) {
    return PROFILE_GAPS;
  }

  return PROFILE_GAPS.filter(gap => {
    const value = profile[gap.field];
    if (gap.type === 'array') {
      return !value || value.length === 0;
    }
    return !value || value === '';
  });
}

async function saveProfileField(field: string, value: any, existingId?: string): Promise<void> {
  if (existingId) {
    const { error } = await getSupabase()
      .from('company_profile')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', existingId);

    if (error) {
      console.error(`Error updating ${field}:`, error);
    }
  } else {
    const { error } = await getSupabase()
      .from('company_profile')
      .insert({ [field]: value });

    if (error) {
      console.error(`Error inserting ${field}:`, error);
    }
  }
}

function patriciaIntro(): string {
  return `
Hey! Patricia here. I'm going to help you fill in some gaps in your company profile.

This info helps the whole team:
- Maya uses it to match opportunities to your capabilities
- David checks it against past performance when researching
- Rosa knows who might be good teaming partners
- James uses it for go/no-go decisions

I'll ask you some questions. Just answer naturally - I'll capture the important stuff.
If you don't know something or want to skip, just say "skip" or "not sure".

Let's get started!
`;
}

function parseArrayResponse(response: string): string[] {
  // Handle various formats: comma-separated, newline-separated, numbered lists
  const cleaned = response
    .replace(/^\d+\.\s*/gm, '') // Remove numbered list prefixes
    .replace(/^[-*]\s*/gm, '')  // Remove bullet points
    .replace(/\n+/g, ',')       // Convert newlines to commas
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0 && item.toLowerCase() !== 'skip' && item.toLowerCase() !== 'not sure');

  return cleaned;
}

async function runOnboarding(): Promise<void> {
  console.log(patriciaIntro());

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (question: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(`\nPatricia: ${question}\n\nYou: `, resolve);
    });
  };

  // Get existing profile
  const existingProfile = await getExistingProfile();
  const gaps = findGaps(existingProfile);

  if (gaps.length === 0) {
    console.log("\nPatricia: Your profile looks complete! All the key fields are filled in.");
    console.log("If you want to update anything, you can edit directly in Supabase or ask me specific questions.");
    rl.close();
    return;
  }

  console.log(`\nPatricia: I see ${gaps.length} fields that could use some info. Let's go through the high-priority ones first.\n`);

  // Sort by priority
  const sortedGaps = gaps.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  let profileId = existingProfile?.id;
  let answeredCount = 0;

  for (const gap of sortedGaps) {
    const priorityTag = gap.priority === 'high' ? '(important)' : gap.priority === 'low' ? '(optional)' : '';

    const response = await askQuestion(`${gap.question} ${priorityTag}`);

    if (response.toLowerCase() === 'skip' || response.toLowerCase() === 'not sure' || response.trim() === '') {
      console.log("\nPatricia: Got it, we can come back to that later.");
      continue;
    }

    let value: any;
    switch (gap.type) {
      case 'array':
        value = parseArrayResponse(response);
        console.log(`\nPatricia: Got it! I captured: ${value.join(', ')}`);
        break;
      case 'number':
        value = parseInt(response, 10);
        if (isNaN(value)) {
          console.log("\nPatricia: Hmm, I couldn't parse that as a number. Let's skip for now.");
          continue;
        }
        break;
      default:
        value = response.trim();
    }

    await saveProfileField(gap.field, value, profileId);

    // If this was the first field and we didn't have a profile, get the new ID
    if (!profileId) {
      const newProfile = await getExistingProfile();
      profileId = newProfile?.id;
    }

    answeredCount++;

    // Occasional Patricia commentary
    if (answeredCount % 3 === 0 && answeredCount < sortedGaps.length) {
      const comments = [
        "Nice, making good progress!",
        "This is helpful - the team will appreciate having this info.",
        "Great, keep going!",
        "Perfect, this is exactly what we need.",
      ];
      console.log(`\nPatricia: ${comments[Math.floor(Math.random() * comments.length)]}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log("\nPatricia: Okay, we're done for now!");
  console.log(`I captured info for ${answeredCount} fields.`);

  // Show summary
  const updatedProfile = await getExistingProfile();
  if (updatedProfile) {
    console.log("\nHere's what we have now:");
    console.log(`- Company: ${updatedProfile.company_name || '(not set)'}`);
    console.log(`- Capabilities: ${updatedProfile.capabilities?.length || 0} listed`);
    console.log(`- Set-asides: ${updatedProfile.set_asides?.join(', ') || '(none)'}`);
    console.log(`- NAICS codes: ${updatedProfile.naics_codes?.length || 0} listed`);
    console.log(`- Contract vehicles: ${updatedProfile.contract_vehicles?.length || 0} listed`);
  }

  const remainingGaps = findGaps(updatedProfile);
  if (remainingGaps.length > 0) {
    console.log(`\nStill missing ${remainingGaps.length} fields - run this again anytime to fill them in.`);
  } else {
    console.log("\nProfile is complete! The agents now have full context about the company.");
  }

  rl.close();
}

// Run if called directly
runOnboarding().catch(console.error);
