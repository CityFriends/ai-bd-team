/**
 * Add strategic context fields to company_profile
 * and populate for FFTC
 */
import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

async function main() {
  const supabase = getSupabase();

  console.log('Adding strategic context to company_profile...\n');

  // Update company profile with strategic fields
  const { error } = await supabase
    .from('company_profile')
    .update({
      strategic_goals: [
        'Launch Innovation Lab with AI products (AI BD Team, Qori, Truebid)',
        'Build software development past performance',
        'Expand from design into full-stack digital services',
        'Position as AI-forward govcon firm',
      ],
      capability_gaps: [
        'Limited software development past performance',
        'No cloud migration contracts yet',
        'Have not primed a large development effort',
      ],
      growth_areas: [
        'Software development - want contracts to build this muscle',
        'AI/ML implementation - aligns with Innovation Lab',
        'Product management - bridge from design to delivery',
        'Data visualization and analytics',
      ],
      innovation_initiatives: [
        'AI BD Team - AI-powered business development system (this system) - potential product offering',
        'Qori - AI-powered proposal writing assistant',
        'Truebid - Automated bid/no-bid decision tool',
        'Innovation Lab - R&D and product incubation',
      ],
      risk_tolerance: `Willing to sub on development work to gain experience. Open to lower-margin contracts if they build strategic capabilities. Will bid stretch opportunities if teaming partner covers gaps.`,
    })
    .eq('company_name', 'Friends From The City');

  if (error) {
    console.error('Error updating company profile:', error);

    // If columns don't exist, we need to add them first via SQL
    console.log('\nColumns may not exist. Run this SQL in Supabase:');
    console.log(`
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS strategic_goals TEXT[];
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS capability_gaps TEXT[];
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS growth_areas TEXT[];
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS innovation_initiatives TEXT[];
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS risk_tolerance TEXT;
    `);
    return;
  }

  console.log('Strategic context added successfully!\n');

  // Verify the update
  const { data: profile } = await supabase
    .from('company_profile')
    .select('strategic_goals, capability_gaps, growth_areas, innovation_initiatives, risk_tolerance')
    .eq('company_name', 'Friends From The City')
    .single();

  if (profile) {
    console.log('Strategic Goals:');
    profile.strategic_goals?.forEach((g: string) => console.log(`  - ${g}`));

    console.log('\nCapability Gaps:');
    profile.capability_gaps?.forEach((g: string) => console.log(`  - ${g}`));

    console.log('\nGrowth Areas:');
    profile.growth_areas?.forEach((g: string) => console.log(`  - ${g}`));

    console.log('\nInnovation Initiatives:');
    profile.innovation_initiatives?.forEach((i: string) => console.log(`  - ${i}`));

    console.log('\nRisk Tolerance:');
    console.log(`  ${profile.risk_tolerance}`);
  }
}

main().catch(console.error);
