# AI BD Team - Client Onboarding Guide

This guide walks through onboarding a new company onto the AI BD Team platform.

## Overview

Onboarding involves:
1. Company profile setup
2. Past performance entry
3. Key personnel and contacts
4. Partner/competitor database
5. System testing

---

## Step 1: Company Profile Setup

### Create Company Record

Create a `company_profile` table entry (or configuration file) with:

```typescript
interface CompanyProfile {
  name: string;                    // "Friends From The City"
  legalName: string;               // Legal entity name
  uei: string;                     // Unique Entity ID
  cage: string;                    // CAGE code
  naicsCodes: string[];            // Primary NAICS codes
  setAsideStatus: string[];        // ['8(a)', 'WOSB', 'HUBZone', etc.]
  contractVehicles: string[];      // ['GSA MAS', 'CIO-SP3', etc.]
  coreCapabilities: string[];      // What you're good at
  pastPerformanceKeywords: string[]; // For matching opportunities
  geographicCoverage: string[];    // States/regions you serve
  clearanceLevels: string[];       // Security clearances held
  annualRevenue: string;           // Size standard relevance
  employeeCount: number;
}
```

### Example Configuration

```json
{
  "name": "Friends From The City",
  "legalName": "Friends From The City LLC",
  "uei": "ABC123456789",
  "cage": "12345",
  "naicsCodes": ["541512", "541611", "541519"],
  "setAsideStatus": ["8(a)", "WOSB", "EDWOSB"],
  "contractVehicles": ["GSA MAS"],
  "coreCapabilities": [
    "Human-Centered Design",
    "Digital Transformation",
    "Agile Development",
    "User Research",
    "Content Strategy"
  ],
  "pastPerformanceKeywords": [
    "modernization",
    "user experience",
    "digital services",
    "citizen engagement"
  ],
  "geographicCoverage": ["DC Metro", "Nationwide"],
  "clearanceLevels": ["Public Trust"],
  "annualRevenue": "$5-10M",
  "employeeCount": 25
}
```

### Agent Context Integration

Update agent prompts to reference company profile:

```typescript
// In agent systemPrompt:
const companyContext = `
ABOUT YOUR COMPANY:
- ${profile.name} is a ${profile.setAsideStatus.join(', ')} small business
- Core capabilities: ${profile.coreCapabilities.join(', ')}
- Vehicles: ${profile.contractVehicles.join(', ')}
- Sweet spot: $500K - $5M task orders
`;
```

---

## Step 2: Past Performance Entry

### Past Performance Table

```sql
CREATE TABLE past_performance (
  id UUID PRIMARY KEY,
  contract_name TEXT NOT NULL,
  agency TEXT NOT NULL,
  contract_number TEXT,
  period_of_performance TEXT,      -- "2021-2024"
  contract_value NUMERIC,
  role TEXT,                       -- 'Prime', 'Sub'
  description TEXT NOT NULL,
  key_capabilities TEXT[],
  poc_name TEXT,
  poc_email TEXT,
  poc_phone TEXT,
  cpar_rating TEXT,               -- 'Exceptional', 'Very Good', etc.
  relevance_keywords TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Example Entries

```sql
INSERT INTO past_performance (contract_name, agency, contract_value, role, description, key_capabilities, cpar_rating)
VALUES
  ('VA Digital Modernization', 'Department of Veterans Affairs', 2500000, 'Prime',
   'Led human-centered design and agile development for veteran-facing portal redesign',
   ARRAY['HCD', 'Agile', 'UX Design', 'Veterans'],
   'Exceptional'),
  ('HHS Content Strategy', 'Department of Health and Human Services', 800000, 'Sub',
   'Provided content strategy and plain language expertise for COVID response website',
   ARRAY['Content Strategy', 'Plain Language', 'Health'],
   'Very Good');
```

### Agent Usage

David and James can reference past performance:
- "We have VA past performance from the Digital Modernization project"
- "Our HHS work was as a sub, so it's relevant but not as strong as prime"

---

## Step 3: Key Personnel

### Personnel Table

```sql
CREATE TABLE key_personnel (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  role_type TEXT,                 -- 'Executive', 'PM', 'Technical'
  clearance_level TEXT,
  years_experience INTEGER,
  resume_summary TEXT,
  certifications TEXT[],
  agency_experience TEXT[],
  availability TEXT,              -- 'Full-time', 'Available for proposals'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Example Entry

```sql
INSERT INTO key_personnel (name, title, role_type, years_experience, certifications, agency_experience)
VALUES
  ('Jane Smith', 'Director of HCD', 'Technical', 12,
   ARRAY['PMP', 'Certified Scrum Master'],
   ARRAY['VA', 'HHS', 'GSA']);
```

---

## Step 4: Partner Database

### Partner Profiles

```sql
CREATE TABLE partners (
  id UUID PRIMARY KEY,
  company_name TEXT NOT NULL,
  uei TEXT,
  contact_name TEXT,
  contact_email TEXT,
  relationship_strength TEXT,     -- 'Strong', 'Warm', 'Cold'
  set_aside_status TEXT[],
  capabilities TEXT[],
  past_teaming TEXT[],            -- Previous projects together
  notes TEXT,
  last_contacted TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Rosa can reference partner database:
- "We've teamed with Acme Corp before on the HHS project"
- "I know the CEO from AFCEA - that's a warm relationship"

### Competitor Tracking

The `competitor_intel` table automatically captures competitor information as agents research opportunities.

---

## Step 5: Target Agency Setup

### Define Focus Agencies

```sql
CREATE TABLE target_agencies (
  agency_code TEXT PRIMARY KEY,
  agency_name TEXT NOT NULL,
  abbreviation TEXT,
  priority INTEGER,               -- 1 = highest
  notes TEXT,
  key_contacts TEXT[],
  recent_wins TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Example Setup

```sql
INSERT INTO target_agencies (agency_code, agency_name, abbreviation, priority, notes)
VALUES
  ('036', 'Department of Veterans Affairs', 'VA', 1, 'Primary target - strong past performance'),
  ('075', 'Department of Health and Human Services', 'HHS', 2, 'Growing presence'),
  ('012', 'Department of Labor', 'DOL', 3, 'Exploring opportunities');
```

---

## Step 6: Case Study Import

### Manual Entry

Create detailed case studies that agents can reference:

```sql
CREATE TABLE case_studies (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  client TEXT NOT NULL,
  challenge TEXT NOT NULL,
  solution TEXT NOT NULL,
  results TEXT NOT NULL,
  metrics TEXT[],                 -- "40% reduction in processing time"
  capabilities_demonstrated TEXT[],
  testimonial TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Web Scraping (Advanced)

If the company has case studies on their website:

```typescript
// Pseudo-code for case study scraping
async function importCaseStudies(websiteUrl: string) {
  const pages = await scrapeWebsite(websiteUrl + '/case-studies');
  for (const page of pages) {
    const caseStudy = extractCaseStudyData(page);
    await saveCaseStudy(caseStudy);
  }
}
```

---

## Step 7: Bid Criteria Configuration

### Define Go/No-Go Criteria

```sql
CREATE TABLE bid_criteria (
  id UUID PRIMARY KEY,
  criterion TEXT NOT NULL,
  category TEXT,                  -- 'must_have', 'nice_to_have', 'red_flag'
  weight INTEGER DEFAULT 5,       -- 1-10 importance
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Example Criteria

```sql
INSERT INTO bid_criteria (criterion, category, weight, description)
VALUES
  ('8(a) set-aside', 'must_have', 10, 'We must be able to compete'),
  ('VA past performance required', 'red_flag', 8, 'We have VA PP, so this is good'),
  ('Unrestricted competition', 'red_flag', 7, 'Hard to win against large primes'),
  ('HCD mentioned in requirements', 'nice_to_have', 6, 'Our sweet spot'),
  ('Less than 30 day response time', 'red_flag', 5, 'Very tight timeline');
```

---

## Step 8: System Testing

### Test Each Agent

1. **Maya (Scout)**
   ```
   @Maya what opportunities are there at VA right now?
   ```
   Expected: Searches SAM.gov, returns relevant opportunities

2. **David (Analyst)**
   ```
   @David who's the incumbent on VA IT services contracts?
   ```
   Expected: Searches FPDS, returns incumbent data

3. **Rosa (Connector)**
   ```
   @Rosa do we have any partners for an 8(a) opportunity?
   ```
   Expected: References partner database or offers to look

4. **James (Strategist)**
   ```
   @James should we go after this VA opportunity?
   ```
   Expected: Synthesizes information, gives strategic recommendation

5. **Patricia (PM)**
   ```
   @Patricia what's our current pipeline status?
   ```
   Expected: Summarizes tracked opportunities and next steps

### Test Cross-Agent Collaboration

Post a complex question that triggers multiple agents:
```
I found a VA modernization opportunity. It's an 8(a) set-aside,
due in 4 weeks. The incumbent is Booz Allen. Should we go for it?
```

Expected: Maya confirms the opp, David researches incumbent, Rosa considers teaming, James synthesizes for go/no-go.

---

## Step 9: Training Users

### Key Behaviors to Teach

1. **@mention the right agent**
   - Opportunities → Maya
   - Research → David
   - Partners → Rosa
   - Decisions → James
   - Tracking → Patricia

2. **Provide context**
   - Include opportunity name or SAM.gov ID
   - Mention relevant keywords
   - Be specific about what you need

3. **Follow threads**
   - Continue conversation in thread
   - Agents remember thread context

4. **Trust but verify**
   - Agents cite sources
   - Click links to verify
   - Ask for clarification if needed

---

## Onboarding Checklist

- [ ] Company profile configured
- [ ] Past performance entered (3+ projects)
- [ ] Key personnel added
- [ ] Partner relationships documented
- [ ] Target agencies defined
- [ ] Case studies imported
- [ ] Bid criteria configured
- [ ] All 5 agents tested
- [ ] Users trained on @mention patterns
- [ ] Slack channel permissions set
- [ ] Award monitoring enabled (optional)
