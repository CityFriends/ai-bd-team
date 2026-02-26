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
    // Strategic context for agent decision-making
    strategic_goals: [
      'Build Innovation Lab into revenue-generating service',
      'Develop 3+ dev-focused past performance contracts',
      'Expand HHS and VA presence',
      'Establish AI/ML capabilities in government space',
    ],
    capability_gaps: [
      'Limited cloud migration past performance',
      'No large-scale DevSecOps contracts yet',
      'Engineering team capacity for surge work',
      'No ATO/FedRAMP experience as prime',
    ],
    growth_areas: [
      'AI/ML in government',
      'Cloud modernization',
      'Data analytics and visualization',
      'DevSecOps and CI/CD',
    ],
    innovation_initiatives: [
      'AI BD Team - Autonomous BD agents',
      'Qori - Proposal automation',
      'Truebid - Win probability analysis',
      'Innovation Lab - Internal R&D',
    ],
    risk_tolerance:
      'Moderate - willing to sub for strategic experience, take lower margins on capability-building work, but avoid high-risk primes without strong teaming',
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

  // Enriched case studies with full context, approach, and outcomes from FFTC website
  const caseStudies = [
    {
      title: "When Search Doesn't Find",
      agency: 'Department of Veterans Affairs',
      source_url: 'https://www.friendsfromthecity.com/work/case-study/when-search-doesnt-find',
      challenge:
        "VA.gov's search function wasn't helping veterans find what they needed. Search results often failed to surface relevant content, leaving veterans unable to locate critical information about their benefits and services.",
      approach:
        'Conducted extensive user research to understand how veterans actually search for information. Analyzed search logs to identify patterns in failed searches and content gaps. Worked with content teams to improve searchability of key pages.',
      solution:
        'Redesigned search experience with improved relevance ranking, better content tagging, and clearer search result displays. Implemented search analytics to continuously monitor and improve results.',
      methods_used: ['User Research', 'Search UX', 'Content Strategy', 'Analytics'],
      outcomes: ['Improved search success rates', 'Better content discoverability for veterans'],
      public_releasable: true,
    },
    {
      title: 'Making Accessibility Harder to Miss',
      agency: 'Department of Veterans Affairs',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/making-accessibility-harder-to-miss',
      challenge:
        "The VA's Drupal CMS had significant alt text quality issues. Over 65% of alt text contained redundancies like 'image of' or 'photo of'. About 20% contained file extensions from unedited filenames. Editors lacked knowledge of proper alt text conventions and received no real-time guidance.",
      approach:
        'Embedded guidance directly into the creation process rather than relying on training. Proposed error messaging during image uploads to alert editors to redundancies, file extensions, and text exceeding 150 characters. Prototyped in Figma and conducted usability testing with five VAMC editors. Developed Knowledge Base articles explaining why alt text matters.',
      solution:
        'Built real-time feedback into the CMS that catches accessibility violations during upload. Created Knowledge Base documentation for editors. Feature launched in February 2024.',
      methods_used: [
        'Accessibility Audits',
        'Usability Testing',
        'Error Messaging Design',
        'CMS Integration',
      ],
      outcomes: [
        '65% of alt text had redundancies before launch',
        'Real-time feedback now built into CMS',
        'Editors can immediately correct accessibility violations',
      ],
      public_releasable: true,
    },
    {
      title: 'Translating the 526ez for PACT Act',
      agency: 'Department of Veterans Affairs',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/translating-the-526ez-for-pact-act',
      challenge:
        "The VA needed to integrate toxic exposure questions into the 526ez digital form following the PACT Act expansion. Paper forms and digital forms follow different logic—paper crams multiple questions per page to save costs, digital follows 'One Thing per Page' guidance. The team faced a non-1:1 mapping problem plus downstream integration with PDFs and Lighthouse API.",
      approach:
        'Used collaborative visualization in Mural to compare paper forms, API structure, and design mocks side-by-side to identify gaps before coding. Engaged end-users beyond veterans—specifically VSRs and RVSRs (claims processors)—to understand information needs. Partnered with VA platform team to develop the "Checkbox and Loop Flow," a new pattern maintaining One Thing per Page principles while handling multiple responses.',
      solution:
        'Delivered paper-to-digital form mapping, cross-team coordination with VA Forms Platform, toggle-aware end-to-end testing, Lighthouse API integration, and Checkbox and Loop Flow implementation. Feature launched fall 2024.',
      methods_used: [
        'Content Strategy',
        'Plain Language',
        'Form Design',
        'API Integration',
        'Cross-Team Coordination',
      ],
      outcomes: [
        '2M+ veterans served',
        'Digital form captures better data than paper version',
        'Veterans can file toxic exposure claims online with more detail',
      ],
      public_releasable: true,
    },
    {
      title: 'A Dot That Changed Behavior',
      agency: 'Department of Veterans Affairs',
      source_url: 'https://www.friendsfromthecity.com/work/case-study/a-dot-that-changed-behavior',
      challenge:
        'Veterans were not completing critical tasks on VA.gov, often abandoning forms or missing important notifications. The team needed to find subtle design interventions that would improve completion rates without adding complexity.',
      approach:
        'Applied behavioral design principles to identify friction points in the user journey. Tested small UI interventions like visual indicators and progress markers. Ran A/B tests to measure impact of design changes on user behavior.',
      solution:
        'Implemented targeted visual cues and behavioral nudges that guided veterans through task completion. Small UI changes led to measurable improvements in engagement and completion rates.',
      methods_used: ['Behavioral Design', 'UX Research', 'A/B Testing', 'UI Design'],
      outcomes: ['Improved task completion rates', 'Better user engagement with key features'],
      public_releasable: true,
    },
    {
      title: 'Faster Decisions for Clinicians',
      agency: 'Centers for Medicare & Medicaid Services',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/faster-decisions-for-clinicians',
      challenge:
        'Clinicians participating in CMS quality payment programs struggled to understand their performance data and make informed decisions. Complex dashboards and overwhelming data made it difficult to identify actionable insights.',
      approach:
        'Conducted user research with clinicians to understand their decision-making processes and information needs. Redesigned dashboards to surface the most important metrics first. Simplified data visualizations and added contextual guidance.',
      solution:
        'Delivered redesigned performance dashboards with clearer data hierarchy, actionable insights, and user-friendly navigation. Clinicians can now quickly understand their standing and take appropriate action.',
      methods_used: ['Product Design', 'User Research', 'Dashboard Design', 'Data Visualization'],
      outcomes: [
        '570K+ clinicians served',
        'Faster decision-making for quality program participants',
      ],
      public_releasable: true,
    },
    {
      title: 'Learning How to Watch',
      agency: 'Centers for Medicare & Medicaid Services',
      source_url: 'https://www.friendsfromthecity.com/work/case-study/learning-how-to-watch',
      challenge:
        'CMS needed to understand how clinicians actually used their digital tools in real-world settings. Traditional research methods were not capturing the nuances of day-to-day usage patterns and pain points.',
      approach:
        'Developed observational research protocols that could capture authentic user behavior. Conducted field studies in clinical settings. Synthesized findings into actionable insights for product teams.',
      solution:
        'Established observational research methodology for CMS digital products. Delivered detailed behavioral insights that informed product roadmap priorities and design decisions.',
      methods_used: [
        'User Research',
        'Observational Studies',
        'Research Synthesis',
        'Field Studies',
      ],
      outcomes: [
        'New research methodology established',
        'Authentic user insights captured',
        'Product roadmap informed by real-world behavior',
      ],
      public_releasable: true,
    },
    {
      title: 'Untangling QPP for Clinicians',
      agency: 'Centers for Medicare & Medicaid Services',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/untangling-qpp-for-clinicians',
      challenge:
        'The Quality Payment Program (QPP) was complex and confusing for participating clinicians. Information was scattered across multiple systems and documents, making it difficult for clinicians to understand their obligations and options.',
      approach:
        'Mapped the entire clinician journey through QPP to identify pain points and information gaps. Reorganized content architecture to match how clinicians think about the program. Created clearer pathways through program requirements.',
      solution:
        'Delivered restructured information architecture, improved content organization, and clearer navigation. Clinicians can now find the information they need to participate successfully in QPP.',
      methods_used: [
        'Information Architecture',
        'Content Strategy',
        'Service Design',
        'Journey Mapping',
      ],
      outcomes: ['Simplified program navigation', 'Clearer understanding of QPP requirements'],
      public_releasable: true,
    },
    {
      title: 'Resolving Veteran Debt in Minutes',
      agency: 'Department of Veterans Affairs',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/resolving-veteran-debt-in-minutes',
      challenge:
        "Veterans who fell behind on VA debt faced a system designed to lose them. The process required completing a Financial Status Report, printing it, mailing it, and submitting a separate waiver request. Veterans couldn't track progress, and errors meant starting over. Many abandoned the process, resulting in wage garnishments and penalty fees.",
      approach:
        'Identified 66 issues in the existing digital form. Conducted co-design sessions directly with Veterans, including those with PTSD and cognitive impairments. Developed trauma-informed research protocols with VA clinicians. Eight studies produced behavioral archetypes that guided design decisions.',
      solution:
        'Delivered heuristic evaluation and behavioral archetypes, trauma-informed research protocols, co-design sessions, web/mobile prototypes, plain language content, accessibility remediation, and integration with VA Debt Management Center, Health Resource Center, and VBMS.',
      methods_used: [
        'Service Design',
        'Product Design',
        'Trauma-Informed Research',
        'Co-Design',
        'Accessibility',
      ],
      outcomes: [
        '88% increase in waiver submissions',
        '95% instant approval rate for Streamlined Waiver',
        'Veterans resolve debt in minutes instead of weeks',
        '30K+ veterans helped',
      ],
      public_releasable: true,
    },
    {
      title: "Maryland's First User Research",
      agency: 'Maryland Digital Service',
      client: 'State of Maryland',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/marylands-first-user-research',
      challenge:
        'Maryland Digital Service needed to establish user research capabilities but had no existing research operations, methodology, or culture of user-centered design in state government.',
      approach:
        'Built research operations from the ground up. Trained state employees on research methods. Conducted foundational research studies to demonstrate value and establish best practices.',
      solution:
        'Established first formal user research practice for Maryland state government. Delivered training, methodology documentation, and initial research studies that informed digital service improvements.',
      methods_used: ['User Research', 'Research Operations', 'Capacity Building', 'Training'],
      outcomes: [
        'First user research practice established in Maryland government',
        'State employees trained on research methods',
        'Research-informed improvements to state services',
      ],
      public_releasable: true,
    },
    {
      title: 'Designing Policy Through Workshops',
      agency: 'Centers for Medicare & Medicaid Services',
      source_url:
        'https://www.friendsfromthecity.com/work/case-study/designing-policy-through-workshops',
      challenge:
        'CMS needed to develop new policies but traditional policy-making processes were disconnected from the people they would affect. There was a gap between policy intent and real-world implementation.',
      approach:
        'Facilitated workshops that brought together policy makers, implementers, and affected stakeholders. Used design thinking methods to explore policy options and their implications. Created feedback loops between policy development and user impact.',
      solution:
        'Delivered collaborative workshop methodology for policy development. Enabled CMS to incorporate diverse perspectives into policy making. Created templates and facilitation guides for future policy workshops.',
      methods_used: [
        'Workshop Facilitation',
        'Policy Design',
        'Stakeholder Engagement',
        'Design Thinking',
      ],
      outcomes: [
        'More inclusive policy development process',
        'Better alignment between policy and implementation',
        'Reusable workshop methodology for CMS',
      ],
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
