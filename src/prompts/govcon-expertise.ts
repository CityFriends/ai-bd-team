/**
 * GovCon Domain Expertise
 *
 * Deep knowledge blocks injected into agent prompts to make them genuinely useful
 * for government contracting business development. This isn't generic advice -
 * it's the specific expertise a real BD team would have.
 */

// ============================================================
// Maya (Scout) - Opportunity Identification Expertise
// ============================================================

export const MAYA_EXPERTISE = {
  rfpReading: `
## RFP ANALYSIS EXPERTISE

### Set-Aside Interpretation
- "Total Small Business Set-Aside" = Only small businesses compete
- "Partial Set-Aside" = Small business reserve, but large can compete for rest
- 8(a) thresholds: $4.5M for services, $7M for manufacturing, $9M for construction
- SDVOSB verification: VA requires CVE verification, other agencies may accept self-cert
- HUBZone: 10% price evaluation preference is HUGE advantage
- WOSB/EDWOSB: Growing pool, especially at HHS, ED, DOL

### Wired Opportunity Red Flags
These suggest incumbent advantage or pre-determined winner:

1. **Overly specific requirements**
   - "Must have exactly 3 contracts of $10M+ in last 5 years" = sized for incumbent
   - Named technology stack that only incumbent uses
   - Geographic requirements matching incumbent office locations

2. **Timeline manipulation**
   - <15 days for complex RFP = incumbent wrote it, already drafting
   - No Q&A period or minimal Q&A = agency not interested in competition
   - Amendment extending only due date (not scope) = waiting for incumbent

3. **Language tells**
   - "Bridge contract" or "follow-on" in title = incumbent territory
   - J&A (Justification & Approval) language = sole source disguised
   - "Maintain current service levels" = describe incumbent's solution

4. **Process signals**
   - Pre-solicitation notice but no RFI = already know who they want
   - Industry day with very low attendance = competitors gave up
   - Multiple delays with no explanation = political issues, avoid

### What GOOD Opportunities Look Like
- New requirement or new program office
- Incumbent recompete with CPAR issues
- Agency leadership change wanting fresh start
- Protest history on prior award (agency wants clean process)
- Long Q&A period with substantive answers
- Pre-solicitation RFI with genuine questions
`,

  fitScoring: `
## FIT SCORING METHODOLOGY (0-100)

### Core Fit (40 points max)
| Criterion | Points | Evaluation |
|-----------|--------|------------|
| Primary NAICS match | 20 | Is this our bread and butter? |
| Set-aside qualification | 10 | Do we meet ALL requirements? |
| Geographic alignment | 5 | Right location or remote OK? |
| Clearance availability | 5 | Do we have cleared staff? |

### Capability Match (30 points max)
| Criterion | Points | Evaluation |
|-----------|--------|------------|
| Direct past performance | 15 | Same scope, same size, recent? |
| Technical approach ready | 10 | Can we write this solution today? |
| Key personnel available | 5 | Named staff committed? |

### Strategic Value (30 points max)
| Criterion | Points | Evaluation |
|-----------|--------|------------|
| Agency relationship builder | 10 | New door or existing relationship? |
| Past performance gap filler | 10 | Does this credential help us? |
| Capability expander | 5 | Learn something new? |
| Revenue threshold | 5 | Meaningful contract value? |

### Red Flag Deductions
| Red Flag | Deduction |
|----------|-----------|
| Wired signals present | -20 |
| Unrealistic timeline | -15 |
| Requires capability we lack | -10 |
| Incumbent has 5+ year relationship | -10 |
| Contract value too small (<$500K) | -5 |

### Score Interpretation
| Score | Recommendation |
|-------|----------------|
| 80-100 | Strong pursue - invest heavily |
| 60-79 | Pursue with mitigation plan |
| 40-59 | Selective pursuit or teaming |
| <40 | No-bid unless strategic override |
`,
};

// ============================================================
// David (Analyst) - Research & Intelligence Expertise
// ============================================================

export const DAVID_EXPERTISE = {
  incumbentAnalysis: `
## INCUMBENT VULNERABILITY ASSESSMENT

### CPAR (Contractor Performance Assessment Reporting) Mining
CPARs are goldmine for competitive intelligence:

| Rating | What It Means | Vulnerability |
|--------|---------------|---------------|
| Exceptional | Exceeding requirements | Low - they're safe |
| Very Good | Requirements met, some exceeded | Low |
| Satisfactory | Meets requirements | Medium - commodity play |
| Marginal | Below requirements | High - agency frustrated |
| Unsatisfactory | Failing | Very High - agency desperate |

**Key CPAR factors to check:**
- Quality of Product/Service
- Schedule/Timeliness
- Cost Control (were they on budget?)
- Management/Business Relations
- Small Business Subcontracting (did they meet goals?)

### Contract Modification Analysis
Pull FPDS data and analyze modifications:

| Modification Type | What It Signals |
|-------------------|-----------------|
| Funding increase only | Normal execution |
| Scope expansion | Incumbent trusted, or scope creep |
| DE-SCOPE | Budget problems or performance issues |
| No-cost extension | Incumbent accommodating delay |
| Change in CO | New relationship opportunity |
| Termination for convenience | Major red flag - avoid this contract |

### Protest History
Check GAO and COFC for protests:
- Incumbent filed protest = desperate, may be losing
- Sustained protest = agency made procedural error (good for challengers)
- Agency corrective action = agency willing to redo, may be more careful

### Agency Relationship Signals
| Signal | Implication |
|--------|-------------|
| Same CO on recompete | Incumbent advantage |
| New program office | Level playing field |
| Recent IG findings | Pressure to change contractors |
| Leadership turnover | Fresh start opportunity |
| Congressional scrutiny | Agency wants clean process |
`,

  redFlagChecklist: `
## RED FLAG DETECTION CHECKLIST

### Organizational Conflicts of Interest (OCI)
OCI will get you disqualified. Check for:
- Did incumbent write the PWS/SOW? (Unequal access)
- Does incumbent have advisory role? (Biased ground rules)
- Will winner evaluate competitor work? (Impaired objectivity)
- Does incumbent access competitor pricing? (Unequal access)

**OCI mitigation is HARD - often better to no-bid than fight it.**

### Unrealistic Requirements
| Red Flag | Reality Check |
|----------|---------------|
| Clearance requirements that take 18+ months | Do they really need TS/SCI? |
| Certifications that don't exist | Typo or barrier? |
| Experience only incumbent could have | Challenge in Q&A |
| Impossible timeline | Ask for extension in Q&A |

### Budget Reality Checks
| Signal | Meaning |
|--------|---------|
| Ceiling doesn't match scope | Either underfunded or placeholder |
| All option years unfunded | May not exercise options |
| Requirements beyond budget | Agency shopping for ideas |
| No IDV ceiling | Risk of unfunded work |

### Process Red Flags
| Signal | Risk Level |
|--------|------------|
| Canceled and reissued 3+ times | High - something wrong |
| No industry day for complex work | High - predetermined |
| Unusual evaluation factors | Medium - understand why |
| Oral presentations required | Medium - resource intensive |
| Extremely short page limits | Low - but prepare carefully |
`,

  agencyIntelligence: `
## AGENCY INTELLIGENCE FRAMEWORK

### Budget Cycle Awareness
| Period | Activity |
|--------|----------|
| Oct-Dec (Q1) | New fiscal year, spending cautious |
| Jan-Mar (Q2) | Budget clarity, procurement planning |
| Apr-Jun (Q3) | Awards accelerate, use-or-lose pressure |
| Jul-Sep (Q4) | Year-end rush, may get bad deals |

### Agency Spending Patterns
Use USASpending to understand:
- Total agency obligations by year (growing or shrinking?)
- Top contractors (who's winning here?)
- Average contract size (are we right-sized?)
- Contract type preference (FFP vs T&M vs cost-plus)
- Set-aside utilization (meeting small business goals?)

### Agency-Specific Intelligence
Different agencies have different cultures:

**DoD**: Formal, process-heavy, clearances matter, incumbents entrenched
**VA**: Veteran-owned preference, healthcare expertise valued
**HHS**: Mission-driven, research and healthcare focus
**DHS**: Security focus, newer agency, more flexible
**GSA**: Procurement experts, value efficiency
**Civilian CFO Act**: Generally more accessible than DoD
`,
};

// ============================================================
// Rosa (Connector) - Teaming & Partnerships Expertise
// ============================================================

export const ROSA_EXPERTISE = {
  teamingStrategy: `
## TEAMING ARRANGEMENT EXPERTISE

### Prime vs Sub Decision Matrix
| Factor | Prime If... | Sub If... |
|--------|-------------|-----------|
| Set-aside | We have required certification | Partner has it, we don't |
| Past performance | We have direct relevant PP | Need to borrow PP |
| Relationship | We know the CO/COR | Partner knows them |
| Capacity | We can manage the contract | Learning opportunity |
| Risk tolerance | Willing to own delivery | Want limited exposure |
| Long-term value | Strategic customer | One-off opportunity |

### Joint Venture Considerations
JVs are complex but powerful:
- Mentor-Protege JV: 8(a) or small business + large company
- Standard JV: Two companies pooling resources
- Populated JV: Actual employees (more credible)
- Unpopulated JV: Administrative entity only

**JV decision factors:**
- Multiple opportunities with same partner? Consider JV
- Need to demonstrate management experience? Populate the JV
- Short-term need? Standard teaming is simpler

### Partner Red Flags
| Red Flag | Risk |
|----------|------|
| Cash flow problems (check SAM exclusions) | May not perform |
| High employee turnover | Key personnel risk |
| Multiple active JVs | Spread too thin |
| Competing on same opportunities | Conflict of interest |
| No recent federal wins | May not be competitive |
| Pricing significantly different from market | Either low-balling or overpriced |

### Teaming Agreement Essentials
Every TA should address:
1. **Work share**: Who does what percentage? (Track for set-aside maintenance)
2. **Exclusivity**: Are we exclusive for this pursuit? (6 months is reasonable)
3. **IP ownership**: Who owns the solution? The proposal content?
4. **Key personnel**: What if they leave? Substitution rights?
5. **Termination**: What triggers exit? What's the wind-down?
6. **Pricing**: How do we handle pricing? Pass-through or negotiated?
7. **Certifications**: Who maintains what certifications?
`,

  partnerEvaluation: `
## PARTNER EVALUATION CRITERIA

### Certification Value Stack
| Certification | Value | Notes |
|---------------|-------|-------|
| 8(a) with 5+ years remaining | Very High | Sole source up to threshold |
| 8(a) graduating soon (<2 years) | Medium | Limited runway |
| SDVOSB (CVE verified) | High | VA set-asides require this |
| SDVOSB (self-certified) | Medium | Other agencies accept |
| HUBZone | High | 10% price evaluation preference |
| WOSB/EDWOSB | Medium | Growing set-aside pool |
| Small Business (general) | Base | Minimum qualification |

### Capability Validation Checklist
Don't take claims at face value:
- [ ] Past performance on similar scope (check FPDS)
- [ ] Key personnel actually available (not "can provide")
- [ ] Financial capacity for their work share
- [ ] Geographic presence if contract requires
- [ ] Clearances if needed (verify, don't assume)
- [ ] Current workload (can they actually staff this?)

### Relationship Temperature Assessment
| Level | Characteristics | Approach |
|-------|-----------------|----------|
| Cold | Never met, no connection | Formal outreach, expect skepticism |
| Warm | Met at conference, mutual contact | Leverage connection for intro |
| Established | Worked together before | Quick alignment call |
| Strong | Multiple successful teaming | Strategic partnership discussion |

### Partner Capability Matrix
For each partner candidate, assess:
| Capability | We Have | They Have | Gap Status |
|------------|---------|-----------|------------|
| Technical delivery | ✓/✗ | ✓/✗ | Filled/Open |
| Past performance | ✓/✗ | ✓/✗ | Filled/Open |
| Certifications | ✓/✗ | ✓/✗ | Filled/Open |
| Key personnel | ✓/✗ | ✓/✗ | Filled/Open |
| Clearances | ✓/✗ | ✓/✗ | Filled/Open |
| Agency relationship | ✓/✗ | ✓/✗ | Filled/Open |
`,
};

// ============================================================
// James (Strategist) - Capture & Win Strategy Expertise
// ============================================================

export const JAMES_EXPERTISE = {
  captureStrategy: `
## CAPTURE STRATEGY FRAMEWORK

### Win Theme Development
A win theme answers: "Why should the government choose us?"

**Strong Win Theme Structure:**
"Because of [OUR UNIQUE STRENGTH], we will deliver [SPECIFIC BENEFIT] that [ADDRESSES AGENCY PAIN POINT], unlike competitors who [COMPETITOR WEAKNESS]."

**Example:**
"Because of our five successful VA cloud migrations, we will deliver on-time transition with zero veteran service disruption, unlike competitors who lack VA-specific experience and risk learning on your dime."

### Discriminator Types
| Type | Example | Strength |
|------|---------|----------|
| Technical | Proprietary tool, unique methodology | High if validated |
| Past Performance | Directly relevant recent work | Very High |
| Key Personnel | Named expert, agency relationships | High |
| Price | Lower cost with same quality | Medium (careful here) |
| Small Business | Certification, community ties | Medium in set-asides |
| Innovation | New approach to old problem | Medium-High if proven |

### Competitive Positioning (Ghosting)
Ghost competitors without naming them:
- "Unlike solutions that require 18-month implementation..." (when incumbent is slow)
- "With cleared staff ready day one..." (when competitor lacks clearances)
- "Proven at your agency..." (when competitor only has other agency experience)
- "Stable team with low turnover..." (when competitor has retention issues)

### Evaluation Factor Alignment
| Factor Weight | Your Investment |
|---------------|-----------------|
| Most Important | 50% of effort, strongest discriminators |
| Important | 30% of effort, solid approach |
| Somewhat Important | 15% of effort, compliant |
| Acceptable/Pass-Fail | 5% of effort, just meet threshold |

**Never over-invest in pass/fail factors.**
`,

  pwinAssessment: `
## PWIN (Probability of Win) ASSESSMENT MODEL

### Scoring Framework (0-100%)

**Customer Intimacy (30% weight)**
| Factor | Score |
|--------|-------|
| Met with decision-makers in last 6 months | +10% |
| Understand unstated requirements | +10% |
| Shaped the requirement/RFI influence | +5% |
| Know the evaluation team | +5% |

**Solution Fit (30% weight)**
| Factor | Score |
|--------|-------|
| Technical approach validated with customer | +15% |
| Past performance directly relevant | +10% |
| Reference customer will vouch | +5% |

**Price Competitiveness (25% weight)**
| Factor | Score |
|--------|-------|
| Rates competitive with market | +10% |
| Understand ceiling constraints | +10% |
| Can demonstrate cost savings | +5% |

**Team Strength (15% weight)**
| Factor | Score |
|--------|-------|
| Key personnel committed and available | +10% |
| Teaming partners locked and aligned | +5% |

### PWIN Interpretation
| PWIN | Action |
|------|--------|
| 70%+ | Pursue aggressively, full capture investment |
| 50-70% | Pursue with risk mitigation, selective investment |
| 30-50% | Pursue selectively, may be learning opportunity |
| <30% | No-bid unless strategic override justified |

### PWIN Adjustments
| Event | Adjustment |
|-------|------------|
| Incumbent with strong CPARs | -15% |
| Incumbent with CPAR issues | +10% |
| We shaped the requirement | +15% |
| No customer contact | -20% |
| Protest on prior award | +5% |
| Short response time (<20 days) | -10% |
`,

  goNoGo: `
## GO/NO-GO DECISION FRAMEWORK

### Mandatory GO Criteria (All must be YES)
- [ ] We are eligible (size, certification, capability)
- [ ] We can deliver if we win
- [ ] Contract is profitable at realistic pricing
- [ ] We have resources to pursue

### GO Indicators (More = Better)
- [ ] PWIN > 50%
- [ ] Strategic value (new agency, new capability, key credential)
- [ ] Strong teaming partner committed
- [ ] Customer relationship exists
- [ ] Incumbent is vulnerable
- [ ] We have discriminating past performance
- [ ] Timeline is achievable

### NO-GO Indicators (Any one may disqualify)
- [ ] PWIN < 30% with no strategic value
- [ ] Wired for incumbent (strong evidence)
- [ ] Unacceptable risk (clearance, technology, delivery)
- [ ] Price point is unsustainable
- [ ] No teaming path for gaps
- [ ] Conflicting priorities (other higher-value pursuits)
- [ ] OCI issues we cannot mitigate

### HOLD Criteria
Use HOLD when:
- Need more information to decide (and can get it)
- Waiting for Q&A answers
- Teaming discussions in progress
- Internal resource availability unclear

**HOLD should have a deadline and decision criteria.**
`,
};

// ============================================================
// Jodie (Writer) - Proposal & Compliance Expertise
// ============================================================

export const JODIE_EXPERTISE = {
  complianceMatrix: `
## COMPLIANCE MATRIX CONSTRUCTION

### Section L/M Analysis
Section L = Instructions to Offerors (what to submit)
Section M = Evaluation Factors (how they'll score it)

**Critical alignment:**
- Every L requirement must have a response location
- Every M factor must be addressed with discriminators
- Hidden priorities often in M that aren't in L (watch for these)

### Compliance Matrix Template
| Req # | Requirement Text | Section L Ref | Our Response | Vol/Page | Status | Owner |
|-------|------------------|---------------|--------------|----------|--------|-------|
| 1.1 | Shall provide... | L.4.2.1 | [Approach] | Tech/p.5 | Draft | [Name] |

### Compliance Status Codes
| Code | Meaning | Action |
|------|---------|--------|
| Compliant | Fully meets requirement | Strengthen discriminators |
| Partial | Meets some, gaps exist | Identify mitigation |
| Exception | Cannot comply, must explain | Rare - use carefully |
| TBD | Awaiting information | Assign owner, deadline |

### Common Compliance Failures
| Failure | Prevention |
|---------|------------|
| Missing "shall" statement | Use automated shall search |
| Wrong volume structure | Follow L precisely |
| Font/margin violations | Template enforcement |
| Missing required sections | Checklist review |
| Unsigned forms | Final assembly check |
| Page count exceeded | Build in buffer, track daily |
`,

  writingStandards: `
## PROPOSAL WRITING STANDARDS

### Executive Summary Pattern (1-2 pages typical)
1. **Opening**: Echo agency mission/challenge (show you understand)
2. **Understanding**: Demonstrate you grasp the requirement
3. **Solution**: Introduce your approach (discriminator forward)
4. **Benefits**: Quantify what agency gains
5. **Proof**: Reference relevant past performance
6. **Call to action**: Confident close

### Technical Approach Pattern
For each requirement section:
1. **Requirement restatement** (shows compliance)
2. **Our approach** (methodology, tools, process)
3. **Why this works** (evidence, logic)
4. **Key personnel role** (who does what)
5. **Risk mitigation** (anticipated challenges, solutions)
6. **Deliverable/outcome** (tangible result)

### Past Performance Write-Up Pattern
1. **Context**: Agency, contract type, value, period
2. **Scope**: What we did (similar to this requirement)
3. **Challenge**: Specific problem we solved
4. **Our approach**: How we solved it
5. **Result**: Quantified outcome ($$, %, time saved)
6. **Relevance**: Why this matters for your requirement

### Writing Quality Standards
| Do | Don't |
|----|-------|
| Active voice | Passive voice |
| Specific numbers | Vague claims |
| "We will" | "We would" or "We could" |
| Short sentences | Run-on sentences |
| Agency's terminology | Our jargon |
| Results focus | Process focus |

### Common Writing Failures
| Issue | Fix |
|-------|-----|
| "World-class" "Best-in-class" | Replace with specific evidence |
| "We have experience" | "We delivered X for Y agency" |
| "Our team is qualified" | "[Name] has [credential] and led [project]" |
| Dense paragraphs | Break up, use bullets, add white space |
| Missing compliance | Start each section with requirement |
`,
};

// ============================================================
// Marcus (Tech Lead) - Technical & Compliance Expertise
// ============================================================

export const MARCUS_EXPERTISE = {
  technicalAssessment: `
## TECHNICAL FEASIBILITY ASSESSMENT

### Requirements Analysis
For each technical requirement, assess:

| Category | Questions to Answer |
|----------|---------------------|
| Capability | Can we build/deliver this today? |
| Complexity | Standard build or R&D effort? |
| Risk | What could go wrong technically? |
| Resources | What skills/tools do we need? |
| Timeline | Can we deliver in required timeframe? |

### Technology Stack Evaluation
| Factor | Assessment |
|--------|------------|
| Current state | What does agency have today? |
| Required state | What does SOW require? |
| Our capability | What can we deliver? |
| Gap analysis | What's missing? |
| Migration path | How do we get there? |

### Build vs Buy Decision
| Factor | Build | Buy/Reuse |
|--------|-------|-----------|
| Unique requirements | Custom solution | Doesn't fit COTS |
| Standard requirements | Over-engineering | COTS + config |
| Timeline pressure | High risk | Faster deployment |
| Long-term maintenance | Full control | Vendor dependency |
| Cost structure | Higher upfront | Licensing ongoing |
`,

  complianceRequirements: `
## FEDERAL COMPLIANCE REQUIREMENTS

### FedRAMP Levels
| Level | Data Types | Timeline to ATO |
|-------|------------|-----------------|
| Low | Public data, minimal PII | 3-6 months |
| Moderate | Controlled data, PII, financial | 6-12 months |
| High | Highly sensitive, law enforcement, DoD | 12-18 months |

**FedRAMP Realities:**
- Most civilian agencies require Moderate
- High is primarily DoD and intelligence
- Agency ATO can supplement FedRAMP JAB authorization
- Existing FedRAMP products are much faster than new ATOs

### Impact Levels (DoD)
| IL | Data Types | Cloud Requirements |
|----|------------|---------------------|
| IL2 | Non-CUI, public | FedRAMP Moderate equivalent |
| IL4 | CUI, controlled | FedRAMP High + DoD requirements |
| IL5 | CUI, higher sensitivity | Dedicated/isolated infrastructure |
| IL6 | Classified | Air-gapped, special handling |

### Security Clearance Requirements
| Clearance | Timeline | Sponsorship |
|-----------|----------|-------------|
| Public Trust | 2-4 months | Any federal contract |
| Secret | 4-8 months | Requires classified work |
| Top Secret | 8-14 months | Requires TS work |
| TS/SCI | 12-18 months | Intelligence community |

**Clearance Realities:**
- Clearances are NOT transferable between contractors
- Interim clearances possible for Secret
- TS requires polygraph in many cases
- Clearance maintenance requires continuous evaluation

### Other Compliance Considerations
| Requirement | What It Means |
|-------------|---------------|
| Section 508 | Accessibility (affects all user-facing) |
| FISMA | Security controls (moderate or high baseline) |
| SOC 2 Type II | Audit of security controls (often required) |
| ISO 27001 | Security management framework |
| CMMC | DoD cybersecurity maturity (replacing NIST 800-171) |
`,

  resourcePlanning: `
## RESOURCE & STAFFING ASSESSMENT

### Key Personnel Considerations
| Role | Criticality | Substitution Risk |
|------|-------------|-------------------|
| Program Manager | High | Must be named, hard to replace |
| Technical Lead | High | Named, specific skills required |
| Subject Matter Expert | Medium | May need multiple options |
| Developer/Analyst | Lower | Pool-based staffing acceptable |

### Staffing Ramp Planning
| Phase | Timeline | Staffing Level |
|-------|----------|----------------|
| Transition | Month 1-2 | Key personnel + core team |
| Steady State | Month 3+ | Full staffing per task order |
| Surge | As needed | Defined surge capacity |

### Labor Category Alignment
Government contracts use specific labor categories (LCATs):
- Match your staff to the LCAT requirements
- Verify education/experience requirements per LCAT
- Price at appropriate rates per LCAT
- Don't under-bid LCATs (you'll lose money)

### Subcontractor Staffing
| Consideration | Impact |
|---------------|--------|
| Work share percentage | Must track for set-aside compliance |
| Key personnel from sub | Need commitment letters |
| Sub transition risk | What if sub exits? |
| Rate alignment | Sub rates must support your pricing |
`,
};

// ============================================================
// Export All Expertise
// ============================================================

export const GOVCON_EXPERTISE = {
  maya: MAYA_EXPERTISE,
  david: DAVID_EXPERTISE,
  rosa: ROSA_EXPERTISE,
  james: JAMES_EXPERTISE,
  jodie: JODIE_EXPERTISE,
  marcus: MARCUS_EXPERTISE,
};

/**
 * Get expertise context for an agent
 */
export function getExpertiseContext(agent: string): string {
  const expertise = GOVCON_EXPERTISE[agent as keyof typeof GOVCON_EXPERTISE];
  if (!expertise) return '';

  return Object.values(expertise).join('\n\n');
}

/**
 * Get specific expertise block
 */
export function getExpertiseBlock(agent: string, block: string): string {
  const expertise = GOVCON_EXPERTISE[agent as keyof typeof GOVCON_EXPERTISE];
  if (!expertise) return '';

  return expertise[block as keyof typeof expertise] || '';
}
