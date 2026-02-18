/**
 * Update company data in Supabase with scraped website content
 */
import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

async function updateCompanyData() {
  const supabase = getSupabase();

  console.log('Updating Friends From The City data in Supabase...\n');

  // ============================================
  // 1. Update Company Profile
  // ============================================
  console.log('1. Updating company profile...');

  const companyProfile = {
    company_name: 'Friends From The City',
    tagline: 'For Government That Works.',
    elevator_pitch:
      'A civic tech company working with state and federal partners to make public services easier to use.',
    capabilities: [
      'Strategy',
      'Design',
      'Development',
      'Product',
      'Research',
      'Prototyping',
      'Content Strategy',
      'Design Systems',
      'Service Design',
      'Frontend Development',
      'Information Architecture',
      'Backend Development',
      'Accessibility',
      'Product Management',
      'Human-Centered Design',
      'Digital Transformation',
    ],
    differentiators: [
      'Human-centered design approach',
      'Deep federal experience (VA, CMS, IRS, HHS)',
      'Accessibility expertise',
      'Service design methodology',
      'Small agile team with senior talent',
    ],
    certifications: [
      'SBA 8(a) Business Development',
      'SBA Women-Owned Small Business (WOSB)',
      'Service-Disabled Veteran-Owned Small Business (SDVOSB)',
      'NYS M/WBE',
      'NYS SDVOB',
      'NYC M/WBE',
      'NJ M/WBE',
      'IL W/MBE',
      'MA SDVOBE',
    ],
    set_asides: ['8(a)', 'WOSB', 'SDVOSB'],
    naics_codes: ['541511', '541512', '541519'],
    contract_vehicles: ['GSA MAS Schedule 47QTCA23D0076'],
    agency_experience: [
      'Department of Veterans Affairs',
      'Centers for Medicare & Medicaid Services (CMS)',
      'Internal Revenue Service (IRS)',
      'Department of Health and Human Services (HHS)',
      'Maryland Digital Service',
      'New York State Parks, Recreation & Historic Preservation',
      'American Board of Family Medicine',
      'National Museum of African American History & Culture',
    ],
    ideal_opportunity:
      'Human-centered design, UX research, digital service delivery, accessibility, and product management for federal health and benefits agencies. Sweet spot is $500K-$5M task orders on existing vehicles.',
    no_bid_criteria: [
      'Requires Top Secret clearance',
      'Hardware procurement focus',
      'Primarily staffing augmentation without design/product scope',
      'Unrealistic timelines (less than 30 days for complex work)',
      'Agencies with no commitment to user research',
    ],
    team_size: 12,
    location: 'Chicago, IL (distributed team)',
    website: 'https://www.friendsfromthecity.com',
    cage_code: '8T0K1',
    uei: 'RA62AG44CFZ8',
  };

  // Check if profile exists
  const { data: existingProfile } = await supabase
    .from('company_profile')
    .select('id')
    .limit(1)
    .single();

  if (existingProfile) {
    const { error } = await supabase
      .from('company_profile')
      .update({ ...companyProfile, updated_at: new Date().toISOString() })
      .eq('id', existingProfile.id);
    if (error) console.error('Error updating profile:', error);
    else console.log('   Updated existing profile');
  } else {
    const { error } = await supabase.from('company_profile').insert(companyProfile);
    if (error) console.error('Error inserting profile:', error);
    else console.log('   Created new profile');
  }

  // ============================================
  // 2. Add Team Members (Key Personnel)
  // ============================================
  console.log('\n2. Adding team members...');

  const teamMembers = [
    {
      name: 'Lapedra Tolson',
      role: 'Chief Executive Officer',
      specialties: ['Business Development', 'Strategic Leadership', 'Federal Contracting'],
    },
    {
      name: 'Tamara Tolson',
      role: 'Chief Operations Officer',
      specialties: ['Operations', 'Project Management', 'Contract Management'],
    },
    {
      name: 'Andrew Morgan',
      role: 'Director of Product & UX',
      specialties: ['Product Management', 'UX Strategy', 'Design Leadership'],
    },
    {
      name: 'Ben Nguyen',
      role: 'UX Researcher',
      specialties: ['User Research', 'Usability Testing', 'Research Synthesis'],
    },
    {
      name: 'Christine Cereca',
      role: 'Senior Frontend Developer',
      specialties: ['Frontend Development', 'Accessibility', 'Design Systems'],
    },
    {
      name: 'Evelyn Hilbrich Davis',
      role: 'Senior UX Researcher',
      specialties: ['User Research', 'Service Design', 'Qualitative Research'],
    },
    {
      name: 'Joann Agnitti',
      role: 'Senior UX Researcher',
      specialties: ['User Research', 'Journey Mapping', 'Stakeholder Research'],
    },
    {
      name: 'Joseph Lee',
      role: 'Senior Product Designer',
      specialties: ['Product Design', 'UI Design', 'Prototyping'],
    },
    {
      name: 'Marcia Ortiz',
      role: 'Senior Product Manager',
      specialties: ['Product Management', 'Agile', 'Roadmapping'],
    },
    {
      name: 'Mayene Kim',
      role: 'Senior Product Designer',
      specialties: ['Product Design', 'Design Systems', 'Accessibility'],
    },
    {
      name: 'Paulina Fisher',
      role: 'Senior UX Researcher',
      specialties: ['User Research', 'Content Strategy', 'Information Architecture'],
    },
    {
      name: 'Victoria Suwardiman',
      role: 'Senior UX Researcher',
      specialties: ['User Research', 'Service Design', 'Workshop Facilitation'],
    },
  ];

  for (const member of teamMembers) {
    // Check if exists
    const { data: existing } = await supabase
      .from('key_personnel')
      .select('id')
      .eq('name', member.name)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('key_personnel')
        .update({ ...member, available: true, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) console.error(`   Error updating ${member.name}:`, error);
      else console.log(`   Updated: ${member.name}`);
    } else {
      const { error } = await supabase.from('key_personnel').insert({ ...member, available: true });
      if (error) console.error(`   Error inserting ${member.name}:`, error);
      else console.log(`   Added: ${member.name}`);
    }
  }

  // ============================================
  // 3. Add All Case Studies
  // ============================================
  console.log('\n3. Adding case studies...');

  const caseStudies = [
    {
      title: "When Search Doesn't Find",
      agency: 'Department of Veterans Affairs',
      source_url: 'https://www.friendsfromthecity.com/work/case-study/when-search-doesnt-find',
      methods_used: ['User Research', 'Search UX', 'Content Strategy'],
      public_releasable: true,
    },
    {
      title: 'Making Accessibility Harder to Miss',
      agency: 'Department of Veterans Affairs',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/making-accessibility-harder-to-miss',
      methods_used: ['Accessibility', 'Design Systems', 'Frontend Development'],
      outcomes: ['Improved accessibility compliance across VA.gov'],
      public_releasable: true,
    },
    {
      title: 'Translating the 526ez for PACT Act',
      agency: 'Department of Veterans Affairs',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/translating-the-526ez-for-pact-act',
      methods_used: ['Content Strategy', 'Plain Language', 'Form Design'],
      outcomes: ['2M+ veterans served'],
      public_releasable: true,
    },
    {
      title: 'A Dot That Changed Behavior',
      agency: 'Department of Veterans Affairs',
      source_url: 'https://www.friendsfromthecity.com/work/case-study/a-dot-that-changed-behavior',
      methods_used: ['Behavioral Design', 'UX Research', 'A/B Testing'],
      public_releasable: true,
    },
    {
      title: 'Faster Decisions for Clinicians',
      agency: 'Centers for Medicare & Medicaid Services',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/faster-decisions-for-clinicians',
      methods_used: ['Product Design', 'User Research', 'Dashboard Design'],
      outcomes: ['570K+ clinicians served'],
      public_releasable: true,
    },
    {
      title: 'Learning How to Watch',
      agency: 'Centers for Medicare & Medicaid Services',
      source_url: 'https://www.friendsfromthecity.com/work/case-study/learning-how-to-watch',
      methods_used: ['User Research', 'Observational Studies', 'Research Synthesis'],
      public_releasable: true,
    },
    {
      title: 'Untangling QPP for Clinicians',
      agency: 'Centers for Medicare & Medicaid Services',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/untangling-qpp-for-clinicians',
      methods_used: ['Information Architecture', 'Content Strategy', 'Service Design'],
      public_releasable: true,
    },
    {
      title: 'Resolving Veteran Debt in Minutes',
      agency: 'Department of Veterans Affairs',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/resolving-veteran-debt-in-minutes',
      methods_used: ['Service Design', 'Product Design', 'Debt Resolution'],
      outcomes: ['30K+ veterans helped resolve debt'],
      public_releasable: true,
    },
    {
      title: "Maryland's First User Research",
      agency: 'Maryland Digital Service',
      client: 'State of Maryland',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/marylands-first-user-research',
      methods_used: ['User Research', 'Research Operations', 'Capacity Building'],
      public_releasable: true,
    },
    {
      title: 'Designing Policy Through Workshops',
      agency: 'Centers for Medicare & Medicaid Services',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/designing-policy-through-workshops',
      methods_used: ['Workshop Facilitation', 'Policy Design', 'Stakeholder Engagement'],
      public_releasable: true,
    },
  ];

  // Clear existing case studies and re-add
  await supabase.from('case_studies').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  for (const cs of caseStudies) {
    const { error } = await supabase.from('case_studies').insert(cs);
    if (error) console.error(`   Error adding ${cs.title}:`, error);
    else console.log(`   Added: ${cs.title}`);
  }

  // ============================================
  // 4. Add News/Awards to proposal_content
  // ============================================
  console.log('\n4. Adding news items as proposal content...');

  const newsItems = [
    {
      content_type: 'news',
      title: 'Friends Qualified for New Jersey Resident Experience Initiative',
      content:
        'Friends From The City qualified for the New Jersey Resident Experience Initiative, expanding our state government portfolio.',
      tags: ['news', 'state', 'new-jersey', 'qualification'],
    },
    {
      content_type: 'news',
      title: 'Friends Joins CMS Enterprise AI Initiative',
      content:
        'Friends From The City joined the CMS Enterprise AI Initiative, bringing human-centered design to AI implementation in healthcare.',
      tags: ['news', 'federal', 'cms', 'ai', 'healthcare'],
    },
    {
      content_type: 'news',
      title: 'Friends Joins VA.gov Financial Management Team',
      content:
        'Friends From The City joined the VA.gov Financial Management Team, helping veterans resolve debt and manage benefits.',
      tags: ['news', 'federal', 'va', 'financial-management'],
    },
    {
      content_type: 'news',
      title: 'Friends Leads First User Research for Maryland Digital Service',
      content:
        'Friends From The City led the first user research initiative for Maryland Digital Service, establishing research operations for the state.',
      tags: ['news', 'state', 'maryland', 'user-research'],
    },
  ];

  for (const news of newsItems) {
    const { data: existing } = await supabase
      .from('proposal_content')
      .select('id')
      .eq('title', news.title)
      .single();

    if (!existing) {
      const { error } = await supabase.from('proposal_content').insert(news);
      if (error) console.error(`   Error adding ${news.title}:`, error);
      else console.log(`   Added: ${news.title}`);
    } else {
      console.log(`   Already exists: ${news.title}`);
    }
  }

  // ============================================
  // Summary
  // ============================================
  console.log('\n' + '='.repeat(60));
  console.log('UPDATE COMPLETE');
  console.log('='.repeat(60));

  const { data: profileCount } = await supabase
    .from('company_profile')
    .select('id', { count: 'exact' });
  const { data: personnelCount } = await supabase
    .from('key_personnel')
    .select('id', { count: 'exact' });
  const { data: caseStudyCount } = await supabase
    .from('case_studies')
    .select('id', { count: 'exact' });
  const { data: newsCount } = await supabase
    .from('proposal_content')
    .select('id', { count: 'exact' })
    .eq('content_type', 'news');

  console.log(`\nCompany Profile: ${profileCount?.length || 0} record`);
  console.log(`Key Personnel: ${personnelCount?.length || 0} team members`);
  console.log(`Case Studies: ${caseStudyCount?.length || 0} projects`);
  console.log(`News Items: ${newsCount?.length || 0} articles`);

  console.log('\nData ready for agents to use!');
}

updateCompanyData().catch(console.error);
