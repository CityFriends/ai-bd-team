// Scrape Friends From The City website to populate company knowledge base
import 'dotenv/config';
import { getSupabase } from '../integrations/supabase.js';

const BASE_URL = 'https://www.friendsfromthecity.com';

interface CaseStudy {
  title: string;
  client?: string;
  agency?: string;
  challenge?: string;
  approach?: string;
  solution?: string;
  outcomes: string[];
  methods_used: string[];
  client_quotes: string[];
  source_url: string;
}

interface TeamMember {
  name: string;
  role?: string;
  bio?: string;
  specialties: string[];
}

interface CompanyInfo {
  capabilities: string[];
  services: string[];
  tagline?: string;
  elevator_pitch?: string;
}

// Fetch and parse HTML from a URL
async function fetchPage(url: string): Promise<string> {
  console.log(`Fetching: ${url}`);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; FFTC-Bot/1.0)',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

// Extract text content between tags (simple regex-based)
function extractText(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? match[1].trim().replace(/<[^>]+>/g, '').trim() : null;
}

// Extract all matches
function extractAllText(html: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  let match;
  const globalPattern = new RegExp(pattern.source, 'gi');
  while ((match = globalPattern.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text && text.length > 5) {
      matches.push(text);
    }
  }
  return matches;
}

// Extract links matching a pattern
function extractLinks(html: string, pattern: RegExp): string[] {
  const links: string[] = [];
  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = linkPattern.exec(html)) !== null) {
    if (pattern.test(match[1])) {
      links.push(match[1]);
    }
  }
  return [...new Set(links)]; // Dedupe
}

// Scrape case studies from /work page
async function scrapeCaseStudies(): Promise<CaseStudy[]> {
  const caseStudies: CaseStudy[] = [];

  try {
    // First, get the work page to find case study links
    const workPageHtml = await fetchPage(`${BASE_URL}/work`);

    // Find links to individual case studies
    const caseStudyLinks = extractLinks(workPageHtml, /\/work\//);
    console.log(`Found ${caseStudyLinks.length} case study links`);

    // Also try to extract case studies directly from the work page
    // Look for project cards/sections
    const projectPattern = /<article[^>]*class="[^"]*project[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    const cardPattern = /<div[^>]*class="[^"]*card[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

    // Try multiple patterns to find case study content
    const patterns = [
      /<h2[^>]*>([\s\S]*?)<\/h2>/gi,
      /<h3[^>]*>([\s\S]*?)<\/h3>/gi,
      /<div[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    ];

    // Scrape each case study link
    for (const link of caseStudyLinks) {
      try {
        const fullUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;
        const html = await fetchPage(fullUrl);

        const caseStudy: CaseStudy = {
          title: '',
          outcomes: [],
          methods_used: [],
          client_quotes: [],
          source_url: fullUrl,
        };

        // Extract title
        const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (titleMatch) {
          caseStudy.title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        // Extract agency/client from meta or content
        const agencyPatterns = [
          /(?:client|agency|for|partner):\s*([^<\n]+)/i,
          /<span[^>]*class="[^"]*client[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        ];
        for (const p of agencyPatterns) {
          const m = html.match(p);
          if (m) {
            caseStudy.client = m[1].replace(/<[^>]+>/g, '').trim();
            break;
          }
        }

        // Extract challenge/problem
        const challengePatterns = [
          /(?:challenge|problem|opportunity)[:\s]*([\s\S]*?)(?:<\/(?:p|div|section)>|(?:solution|approach|our work))/i,
          /<div[^>]*class="[^"]*challenge[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ];
        for (const p of challengePatterns) {
          const m = html.match(p);
          if (m) {
            caseStudy.challenge = m[1].replace(/<[^>]+>/g, '').trim().slice(0, 1000);
            break;
          }
        }

        // Extract approach/solution
        const approachPatterns = [
          /(?:approach|solution|our work|what we did)[:\s]*([\s\S]*?)(?:<\/(?:p|div|section)>|(?:outcome|result|impact))/i,
          /<div[^>]*class="[^"]*approach[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ];
        for (const p of approachPatterns) {
          const m = html.match(p);
          if (m) {
            caseStudy.approach = m[1].replace(/<[^>]+>/g, '').trim().slice(0, 1000);
            break;
          }
        }

        // Extract outcomes/results
        const outcomePatterns = [
          /(?:outcome|result|impact|achievement)[s]?[:\s]*([\s\S]*?)(?:<\/(?:ul|div|section)>)/i,
        ];
        for (const p of outcomePatterns) {
          const m = html.match(p);
          if (m) {
            // Try to split into bullet points
            const items = m[1].match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
            caseStudy.outcomes = items.map(i => i.replace(/<[^>]+>/g, '').trim()).filter(i => i.length > 5);
          }
        }

        // Extract methods/services used
        const methodKeywords = [
          'human-centered design', 'hcd', 'user research', 'usability testing',
          'journey mapping', 'content strategy', 'agile', 'scrum', 'design thinking',
          'prototyping', 'user experience', 'ux', 'service design', 'digital transformation',
          'accessibility', 'section 508', 'plain language', 'stakeholder engagement',
        ];
        const lowerHtml = html.toLowerCase();
        caseStudy.methods_used = methodKeywords.filter(m => lowerHtml.includes(m));

        // Extract quotes
        const quotePattern = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
        let quoteMatch;
        while ((quoteMatch = quotePattern.exec(html)) !== null) {
          const quote = quoteMatch[1].replace(/<[^>]+>/g, '').trim();
          if (quote.length > 20) {
            caseStudy.client_quotes.push(quote);
          }
        }

        if (caseStudy.title) {
          caseStudies.push(caseStudy);
          console.log(`  Scraped: ${caseStudy.title}`);
        }
      } catch (err) {
        console.warn(`  Failed to scrape ${link}:`, err);
      }
    }

    // If no individual links, try to extract from main page
    if (caseStudies.length === 0) {
      console.log('No individual case study links found, parsing main work page...');
      // Extract project sections from main page
      const sectionPattern = /<section[^>]*>([\s\S]*?)<\/section>/gi;
      let sectionMatch;
      while ((sectionMatch = sectionPattern.exec(workPageHtml)) !== null) {
        const section = sectionMatch[1];
        const titleMatch = section.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
        if (titleMatch) {
          const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
          if (title && title.length > 5 && title.length < 100) {
            caseStudies.push({
              title,
              outcomes: [],
              methods_used: [],
              client_quotes: [],
              source_url: `${BASE_URL}/work`,
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to scrape case studies:', err);
  }

  return caseStudies;
}

// Scrape team members from /about or /team page
async function scrapeTeam(): Promise<TeamMember[]> {
  const teamMembers: TeamMember[] = [];

  const teamUrls = [
    `${BASE_URL}/about`,
    `${BASE_URL}/team`,
    `${BASE_URL}/our-team`,
  ];

  for (const url of teamUrls) {
    try {
      const html = await fetchPage(url);

      // Look for team member patterns
      const memberPatterns = [
        /<div[^>]*class="[^"]*(?:team-member|person|staff)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        /<article[^>]*class="[^"]*(?:team|person)[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
      ];

      for (const pattern of memberPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          const memberHtml = match[1];

          // Extract name
          const nameMatch = memberHtml.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i);
          if (!nameMatch) continue;

          const name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
          if (!name || name.length < 3) continue;

          const member: TeamMember = {
            name,
            specialties: [],
          };

          // Extract role/title
          const roleMatch = memberHtml.match(/<(?:p|span)[^>]*class="[^"]*(?:title|role|position)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|span)>/i);
          if (roleMatch) {
            member.role = roleMatch[1].replace(/<[^>]+>/g, '').trim();
          }

          // Extract bio
          const bioMatch = memberHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
          if (bioMatch) {
            member.bio = bioMatch[1].replace(/<[^>]+>/g, '').trim();
          }

          // Extract specialties from bio
          const specialtyKeywords = [
            'user research', 'content strategy', 'design', 'development',
            'project management', 'strategy', 'accessibility', 'agile',
            'product', 'engineering', 'ux', 'human-centered',
          ];
          const lowerBio = (member.bio || '').toLowerCase();
          member.specialties = specialtyKeywords.filter(s => lowerBio.includes(s));

          teamMembers.push(member);
          console.log(`  Found team member: ${member.name}`);
        }
      }

      if (teamMembers.length > 0) break; // Stop if we found members

    } catch (err) {
      // Page might not exist, try next
      continue;
    }
  }

  return teamMembers;
}

// Scrape company info from homepage and services page
async function scrapeCompanyInfo(): Promise<CompanyInfo> {
  const info: CompanyInfo = {
    capabilities: [],
    services: [],
  };

  try {
    // Scrape homepage
    const homeHtml = await fetchPage(BASE_URL);

    // Extract tagline (usually in hero section)
    const taglinePatterns = [
      /<h1[^>]*class="[^"]*(?:hero|tagline)[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
      /<div[^>]*class="[^"]*hero[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i,
    ];
    for (const p of taglinePatterns) {
      const m = homeHtml.match(p);
      if (m) {
        info.tagline = m[1].replace(/<[^>]+>/g, '').trim();
        break;
      }
    }

    // Extract services/capabilities
    const serviceKeywords = [
      'human-centered design', 'user research', 'content strategy',
      'digital transformation', 'service design', 'agile development',
      'accessibility', 'plain language', 'stakeholder engagement',
      'journey mapping', 'usability testing', 'design thinking',
      'product strategy', 'ux design', 'ui design', 'prototyping',
    ];

    const lowerHtml = homeHtml.toLowerCase();
    info.capabilities = serviceKeywords.filter(s => lowerHtml.includes(s));

    // Try services page
    try {
      const servicesHtml = await fetchPage(`${BASE_URL}/services`);
      const lowerServices = servicesHtml.toLowerCase();
      const moreCapabilities = serviceKeywords.filter(s => lowerServices.includes(s));
      info.capabilities = [...new Set([...info.capabilities, ...moreCapabilities])];

      // Extract service titles
      const serviceTitlePattern = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
      let match;
      while ((match = serviceTitlePattern.exec(servicesHtml)) !== null) {
        const title = match[1].replace(/<[^>]+>/g, '').trim();
        if (title && title.length > 5 && title.length < 50) {
          info.services.push(title);
        }
      }
    } catch {
      // Services page might not exist
    }

  } catch (err) {
    console.error('Failed to scrape company info:', err);
  }

  return info;
}

// Save scraped data to Supabase
async function saveToDatabase(
  caseStudies: CaseStudy[],
  teamMembers: TeamMember[],
  companyInfo: CompanyInfo
): Promise<void> {
  const supabase = getSupabase();

  // Save case studies
  if (caseStudies.length > 0) {
    console.log(`\nSaving ${caseStudies.length} case studies...`);
    for (const cs of caseStudies) {
      try {
        await supabase.from('case_studies').upsert({
          title: cs.title,
          client: cs.client,
          agency: cs.agency || cs.client,
          challenge: cs.challenge,
          approach: cs.approach,
          solution: cs.approach, // Use approach as solution if not separate
          outcomes: cs.outcomes,
          methods_used: cs.methods_used,
          client_quotes: cs.client_quotes,
          source_url: cs.source_url,
          public_releasable: true,
        }, { onConflict: 'title' });
        console.log(`  Saved: ${cs.title}`);
      } catch (err) {
        console.warn(`  Failed to save ${cs.title}:`, err);
      }
    }
  }

  // Save team members
  if (teamMembers.length > 0) {
    console.log(`\nSaving ${teamMembers.length} team members...`);
    for (const tm of teamMembers) {
      try {
        await supabase.from('key_personnel').upsert({
          name: tm.name,
          role: tm.role,
          bio: tm.bio,
          specialties: tm.specialties,
          available: true,
        }, { onConflict: 'name' });
        console.log(`  Saved: ${tm.name}`);
      } catch (err) {
        console.warn(`  Failed to save ${tm.name}:`, err);
      }
    }
  }

  // Save company profile
  console.log(`\nSaving company profile...`);
  try {
    await supabase.from('company_profile').upsert({
      company_name: 'Friends From The City',
      tagline: companyInfo.tagline,
      capabilities: companyInfo.capabilities,
      website: BASE_URL,
      set_asides: ['8(a)', 'WOSB', 'EDWOSB'], // Known from context
      naics_codes: ['541512', '541611', '541519'], // Design/consulting
    }, { onConflict: 'company_name' });
    console.log('  Saved company profile');
  } catch (err) {
    console.warn('  Failed to save company profile:', err);
  }
}

// Main scraping function
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Scraping Friends From The City Website');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Scrape all content
  console.log('1. Scraping case studies from /work...');
  const caseStudies = await scrapeCaseStudies();

  console.log('\n2. Scraping team members...');
  const teamMembers = await scrapeTeam();

  console.log('\n3. Scraping company info...');
  const companyInfo = await scrapeCompanyInfo();

  // Save to database
  console.log('\n4. Saving to database...');
  await saveToDatabase(caseStudies, teamMembers, companyInfo);

  // Print summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  SCRAPING SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Case Studies Found: ${caseStudies.length}`);
  if (caseStudies.length > 0) {
    caseStudies.forEach(cs => {
      console.log(`  - ${cs.title} (${cs.client || cs.agency || 'Unknown client'})`);
    });
  }

  console.log(`\nTeam Members Found: ${teamMembers.length}`);
  if (teamMembers.length > 0) {
    teamMembers.forEach(tm => {
      console.log(`  - ${tm.name} (${tm.role || 'No role'})`);
    });
  }

  console.log(`\nCapabilities Identified: ${companyInfo.capabilities.length}`);
  if (companyInfo.capabilities.length > 0) {
    console.log(`  ${companyInfo.capabilities.join(', ')}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  TABLES WITH DATA');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ✓ case_studies: ${caseStudies.length} records`);
  console.log(`  ✓ key_personnel: ${teamMembers.length} records`);
  console.log(`  ✓ company_profile: 1 record`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  TABLES NEEDING MANUAL ENTRY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ○ past_performance - Contract details with CPARs');
  console.log('  ○ contacts - Agency and industry contacts');
  console.log('  ○ teaming_partners - Partner companies');
  console.log('  ○ labor_rates - Labor category pricing');
  console.log('  ○ proposal_content - Reusable proposal text');
  console.log('  ○ lessons_learned - Bid lessons');
  console.log('  ○ documents - Proposals, resumes, etc.');
  console.log('\nUse "Patricia, let\'s update company info" to fill gaps conversationally.\n');
}

main().catch(console.error);
