/**
 * Proposal Writing Guide
 *
 * Style guide, voice/tone guidelines, and section templates
 * for Jodie (Writer) agent to reference when drafting proposal content.
 */

export const PROPOSAL_WRITING_GUIDE = `
# Friends From The City — Proposal Writing Guide

## Our Voice

We are **confident but not arrogant**. We let our work speak for itself. We write like practitioners who've been in the trenches, not consultants who've only read about it.

---

## Voice Examples — This Is What Good Looks Like

These paragraphs from our case studies show the voice we want. Study them.

> We conducted five remote moderated sessions with educators, lifelong learners, and family researchers. Each participant searched for topics that mattered to them, and we watched what happened.
>
> The problems showed up immediately. One participant searched for Harriet Tubman and got results about related topics, but nothing specifically about Harriet Tubman. The search was keyword-based and couldn't distinguish between content that mentioned a subject and content that was actually about that subject.
>
> When participants clicked a result, the page loaded somewhere in the middle. They didn't know where to start reading or how to find the specific phrase they had searched for. Participants described feeling lost.
>
> Without filters, some participants improvised. They used multi-phrase searches or tried advanced syntax to narrow results. These were workarounds for missing functionality.

---

> Alt text is how screen reader users experience images. When it's written well, a Veteran who is blind can understand what's on the page. When it's written poorly, they get noise: file names, redundant phrases, descriptions that don't describe anything.
>
> The VA's Drupal CMS had a problem. Audits showed that over 65% of alt text contained redundancies like "image of" or "photo of," phrases that screen readers already announce automatically. About 20% contained file extensions, meaning someone had uploaded an image and left the file name as the description. These patterns persisted month after month, for over a year.
>
> Editors weren't ignoring accessibility. They just didn't know the rules. Many had no prior experience writing for the web, and the CMS didn't tell them when they got it wrong.

**What makes this work:**
- **Stakes upfront**: First sentence explains why this matters to real people
- **Specific numbers**: "over 65%," "about 20%," "over a year"
- **Concrete examples**: "image of," "photo of," file extensions
- **Root cause, not blame**: "Editors weren't ignoring accessibility. They just didn't know the rules."
- **Short paragraphs**: Each makes one point
- **No jargon**: Explains "alt text" and "screen readers" without being condescending

**Patterns across both examples:**
- **Active voice**: "We conducted," "Audits showed," "Editors weren't ignoring"
- **No adverbs**: Zero in either passage
- **Specific numbers**: "five sessions," "over 65%," "about 20%"
- **Short sentences**: Direct and punchy — no run-ons
- **Show, don't tell**: Describes exactly what happened, not vague summaries
- **Human-centered**: Real users, real problems, real stakes
- **Root cause thinking**: Explains WHY problems exist, without blame
- **Plain language**: Technical when needed, never fancy

When drafting, ask yourself: **Does this read like these examples?** If not, rewrite it.

---

### Voice Principles

**Human-centered, not corporate**
- We design WITH people, not FOR them
- We talk about real users, real problems, real outcomes
- We avoid abstraction when we can point to specifics

**Direct and clear**
- Short sentences. Active voice. No hedging.
- Say what we did, why it mattered, and what changed
- If we can cut a word, cut it
- NO ADVERBS — if you need an adverb, your verb is weak. Find a stronger verb.
- Write at a 10th grade reading level — plain language, not dumbed down

**Confident through evidence**
- We don't claim we're the best — we show what we've done
- Every capability claim has a proof point
- Numbers > adjectives

**Technically credible**
- We know the difference between research and testing
- We use precise language (not "agile" when we mean "iterative")
- We reference actual methods, frameworks, and standards

---

## Tone Guidelines

| Context | Tone |
|---------|------|
| Executive Summary | Confident, strategic, outcome-focused |
| Technical Approach | Precise, methodical, practitioner-level |
| Past Performance | Factual, results-driven, specific |
| Management Approach | Organized, accountable, transparent |
| Cover Letter | Warm but professional, mission-aligned |

### Tone Adjustments by Audience

**Technical evaluators**: Go deep. Use precise terminology. Show you understand their stack, their constraints, their reality.

**Program managers**: Focus on execution, risk mitigation, communication. They want to know you won't be a headache.

**Executives / leadership**: Outcomes, mission impact, strategic value. Big picture, then proof.

---

## What We NEVER Do

### Language to Avoid

| Don't Write | Why | Write Instead |
|-------------|-----|---------------|
| "We are uniquely positioned..." | Everyone says this | "Our team has delivered [specific thing] for [specific client]..." |
| "Best-in-class" / "World-class" | Empty superlatives | Cite actual results or recognition |
| "Leverage" (as a verb) | Overused, vague | "Use," "apply," "build on" |
| "Synergy" / "Synergize" | Corporate jargon | Describe the actual collaboration |
| "Utilize" | Pretentious | "Use" |
| "In order to" | Wordy | "To" |
| "It should be noted that" | Filler | Just say the thing |
| "We believe..." | Weak | State it as fact with evidence |
| "Various" / "Numerous" | Vague | Use actual numbers |
| "Stakeholders" (alone) | Who? | Name them: "clinicians, Veterans, program staff" |
| "Robust" / "Comprehensive" | Meaningless without context | Describe what makes it robust |
| "Cutting-edge" / "Innovative" | Show, don't tell | Describe the actual innovation |
| "Move the needle" | Cliché | Describe the actual metric change |
| "Boil the ocean" | Cliché | Be specific about scope |
| "Low-hanging fruit" | Cliché | Name the quick wins |

### Structural Mistakes to Avoid

- **Wall of text**: Break into bullets, headers, short paragraphs
- **Passive voice**: "The system was designed by our team" → "Our team designed the system"
- **Burying the lead**: Put the most important point first
- **Repeating the RFP back**: Don't parrot requirements — show understanding through your approach
- **Vague claims**: "We have extensive experience" → "We've completed 12 VA contracts since 2019"
- **Future tense hedging**: "We will ensure..." → "Our approach includes..." or "We ensure..."

### Adverbs — Don't Use Them

Adverbs signal weak verbs. Replace the verb instead.

| Don't Write | Write Instead |
|-------------|---------------|
| "quickly delivered" | "delivered in 3 weeks" |
| "significantly reduced" | "reduced by 40%" |
| "carefully analyzed" | "analyzed" (or describe the rigor) |
| "successfully completed" | "completed" (success is implied) |
| "effectively managed" | "managed" (then show evidence of effectiveness) |
| "proactively identified" | "identified before launch" |
| "seamlessly integrated" | "integrated with zero downtime" |
| "highly experienced" | "10 years of experience" |

If you catch yourself reaching for an adverb, ask: "What specifically happened?" Then write that instead.

### Active Voice — Always

Every sentence should make clear WHO did WHAT.

| Passive (Don't) | Active (Do) |
|-----------------|-------------|
| "The research was conducted" | "We conducted the research" |
| "Improvements were identified" | "Our team identified 12 improvements" |
| "The system was deployed" | "We deployed the system" |
| "Testing was completed" | "We completed testing" |
| "Accessibility compliance was achieved" | "We achieved WCAG 2.1 AA compliance" |

### Plain Language (10th Grade Level)

Write for clarity, not to impress. Government evaluators read dozens of proposals — clear writing stands out.

| Complex (Don't) | Plain (Do) |
|-----------------|------------|
| "utilize" | "use" |
| "facilitate" | "help" or "run" |
| "implement" | "build" or "set up" |
| "subsequently" | "then" or "after" |
| "methodology" | "method" or "approach" |
| "in order to" | "to" |
| "at this point in time" | "now" |
| "due to the fact that" | "because" |
| "prior to" | "before" |
| "in the event that" | "if" |

### Content Mistakes to Avoid

- **Inventing past performance**: If we didn't do it, we don't claim it
- **Generic approaches**: Tailor to THIS agency, THIS problem
- **Ignoring Section M**: Structure your response to score well on evaluation criteria
- **Missing compliance**: Check every "shall" and "must" in Section L
- **Overlooking page limits**: Edit ruthlessly — evaluators stop reading at the limit

---

## Section Templates

### Past Performance (STAR+ Format)

Use this structure for each past performance example:

\`\`\`
## [Project Name]
**Client:** [Agency / Office]
**Contract:** [Contract number or vehicle]
**Period:** [Start - End]
**Value:** [$X]
**Our Role:** [Prime / Sub to X]

### Challenge
[1-2 sentences: What was the problem? What was at stake?]

### Our Approach
[2-3 sentences: What did we actually do? What methods/tools did we use?]

### Results
• [Quantified outcome #1]
• [Quantified outcome #2]
• [Quantified outcome #3]

### Relevance
[1-2 sentences: Why this matters for the current opportunity]
\`\`\`

**Example:**

## VA Debt Resolution Portal
**Client:** Department of Veterans Affairs, Debt Management Center
**Contract:** VA118-16-D-1234, TO 005
**Period:** September 2021 – August 2023
**Value:** $1.2M
**Our Role:** Prime

### Challenge
Veterans facing medical debt had no way to understand or resolve their obligations online, forcing 100% of cases through an overwhelmed call center. Many Veterans avoided engaging entirely due to confusion and stress.

### Our Approach
We conducted trauma-informed user research with 40+ Veterans, including those experiencing financial hardship. We designed and built a self-service portal using the VA Design System, integrating with existing debt management APIs.

### Results
• Reduced call center volume by 40% within 6 months of launch
• 89% of Veterans rated the portal "easy to use" in post-launch surveys
• Decreased average debt resolution time from 45 days to 12 days
• Maintained WCAG 2.1 AA compliance with 0 accessibility defects

### Relevance
This project demonstrates our ability to deliver trauma-informed, accessible digital services for VA populations — directly applicable to [current opportunity].

---

### Technical Approach Template

Structure technical approaches to show understanding, method, and proof:

\`\`\`
## [Section Header Matching PWS/SOO]

### Understanding
[Show you understand the problem, the users, the constraints. Reference the RFP/SOO directly but don't parrot it.]

### Our Approach
[Describe your actual methodology. Be specific about frameworks, tools, standards.]

**[Method/Phase 1]**
[What we do and why]

**[Method/Phase 2]**
[What we do and why]

### Differentiators
• [What we do differently and why it matters]
• [Proof point from past performance]

### Risk Mitigation
| Risk | Our Mitigation |
|------|----------------|
| [Risk 1] | [How we address it] |
| [Risk 2] | [How we address it] |
\`\`\`

---

### Capability Statement Template

For capability/qualification sections:

\`\`\`
## [Capability Area]

[One sentence overview of our capability]

**Experience:**
• [# of years] delivering [capability] for [agency types]
• [# of projects] completed involving [specific skill]
• [Specific recognition, award, or certification]

**Methods & Tools:**
• [Specific methodology we use]
• [Tools and technologies]
• [Standards we follow: WCAG, USWDS, etc.]

**Proof Points:**
• [Project 1]: [Outcome]
• [Project 2]: [Outcome]
\`\`\`

---

## Shipley Principles We Follow

1. **Action Caption**: Every section header should be an action statement ("Delivering Accessible Digital Services") not a label ("Accessibility")

2. **So What? Test**: After every sentence, ask "So what?" If you can't answer with a benefit to the government, cut or rewrite.

3. **Ghost the Competition**: Subtly highlight your strengths in areas where competitors are weak — without naming them.

4. **Proof Points**: Every claim needs evidence. "We're good at accessibility" → "We've achieved WCAG 2.1 AA compliance on 8 consecutive VA projects with 0 post-launch accessibility defects."

5. **Theme Statements**: Start sections with a bolded theme that captures your win message: **"Our team's 10-year VA partnership means faster onboarding and deeper mission understanding."**

6. **Evaluation Criteria Alignment**: Structure your response so evaluators can easily find and score each criterion. Mirror the order of Section M.

---

## Formatting Standards

- **Headers**: Use ## for main sections, ### for subsections
- **Bullets**: Use • for unordered lists
- **Bold**: Use for emphasis on key terms, theme statements, and labels
- **Tables**: Use for comparisons, risk matrices, timelines
- **Numbers**: Always use specific numbers over vague quantities
- **Acronyms**: Spell out on first use, then abbreviate

---

## Quality Checklist

Before submitting any draft:

- [ ] Every claim has a proof point
- [ ] No passive voice
- [ ] No banned words/phrases
- [ ] Numbers are specific (not "many" or "several")
- [ ] Headers are action-oriented
- [ ] Evaluation criteria are addressed in order
- [ ] Page limits are respected
- [ ] All "shall" and "must" requirements are addressed
- [ ] Past performance is real and verifiable
- [ ] Reads at 8th-grade level (clear, not dumbed down)
`;

/**
 * Get the proposal writing guide as a formatted string
 */
export function getProposalWritingGuide(): string {
  return PROPOSAL_WRITING_GUIDE;
}

/**
 * Get a specific section of the guide
 */
export function getGuideSection(
  section: 'voice' | 'tone' | 'avoid' | 'templates' | 'shipley' | 'formatting' | 'checklist'
): string {
  const guide = PROPOSAL_WRITING_GUIDE;

  const sectionMarkers: Record<string, { start: string; end: string }> = {
    voice: { start: '## Our Voice', end: '## Tone Guidelines' },
    tone: { start: '## Tone Guidelines', end: '## What We NEVER Do' },
    avoid: { start: '## What We NEVER Do', end: '## Section Templates' },
    templates: { start: '## Section Templates', end: '## Shipley Principles' },
    shipley: { start: '## Shipley Principles', end: '## Formatting Standards' },
    formatting: { start: '## Formatting Standards', end: '## Quality Checklist' },
    checklist: { start: '## Quality Checklist', end: '---END---' },
  };

  const markers = sectionMarkers[section];
  if (!markers) return guide;

  const startIndex = guide.indexOf(markers.start);
  const endIndex = markers.end === '---END---' ? guide.length : guide.indexOf(markers.end);

  if (startIndex === -1) return guide;

  return guide.slice(startIndex, endIndex !== -1 ? endIndex : undefined).trim();
}
