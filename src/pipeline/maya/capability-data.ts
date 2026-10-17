/**
 * FFTC Capability Reference — Offline Test Fixture
 *
 * Source: FFTC_AI_BD_Capability_Reference revision 2 (2026-10-14)
 * Status: DRAFT_PENDING_OWNER_REVIEW — used as test fixture only,
 *         NOT connected to production scoring or collector.
 *
 * Each capability includes match signals (terms indicating the capability
 * is required), exclusion signals (terms indicating NOT_ESTABLISHED scope),
 * classification, supporting engagement IDs, and scope limitations.
 */

export type CapabilityClassification =
  | 'PROVEN'
  | 'ADJACENT'
  | 'TEAMING_REQUIRED'
  | 'NOT_ESTABLISHED';

export interface CapabilityEntry {
  id: string;
  name: string;
  classification: CapabilityClassification;
  baselineArea: string;
  strength: 'Strong' | 'Moderate' | 'Limited' | null;
  matchSignals: string[];
  exclusionSignals: string[];
  engagementIds: string[];
  scopeLimitations: string[];
  teamingRequirement?: string;
}

export interface EngagementEntry {
  id: string;
  name: string;
  agency: string;
  role: 'Prime' | 'Sub';
  prime: string | null;
  status: 'Active' | 'Complete';
  fftcRoles: string[];
  evidenceConfidence: 'Low' | 'Low-Medium' | 'Medium' | 'Medium-High' | 'High';
}

export const CAPABILITIES: CapabilityEntry[] = [
  // ========== PROVEN (12) ==========
  {
    id: 'CAP-01',
    name: 'Qualitative user research',
    classification: 'PROVEN',
    baselineArea: 'UX research',
    strength: 'Strong',
    matchSignals: [
      'user research', 'usability testing', 'user interviews', 'contextual inquiry',
      'participatory design', 'co-design', 'research synthesis', 'behavioral archetypes',
      'moderator guide', 'research protocol', 'trauma-informed research',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-10', 'ENG-11', 'ENG-14', 'ENG-19', 'ENG-06', 'ENG-07', 'ENG-03', 'ENG-04'],
    scopeLimitations: [],
  },
  {
    id: 'CAP-02',
    name: 'Mixed-method and survey research',
    classification: 'PROVEN',
    baselineArea: 'UX research',
    strength: 'Moderate',
    matchSignals: [
      'survey design', 'mixed methods', 'quantitative research', 'survey research',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-10', 'ENG-19'],
    scopeLimitations: ['No documented statistical/experimental design depth'],
  },
  {
    id: 'CAP-03',
    name: 'Service design',
    classification: 'PROVEN',
    baselineArea: 'UX strategy',
    strength: 'Moderate',
    matchSignals: [
      'service design', 'journey mapping', 'service blueprint', 'experience mapping',
      'customer experience', 'cx strategy',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-10', 'ENG-19', 'ENG-11', 'ENG-21'],
    scopeLimitations: ['Mostly discovery deliverables; little evidence of service implementation'],
  },
  {
    id: 'CAP-04',
    name: 'Workshop facilitation and research synthesis',
    classification: 'PROVEN',
    baselineArea: 'UX strategy',
    strength: 'Moderate',
    matchSignals: [
      'workshop facilitation', 'design workshop', 'stakeholder workshop',
      'research synthesis', 'findings report',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-11', 'ENG-10', 'ENG-06', 'ENG-04'],
    scopeLimitations: [],
  },
  {
    id: 'CAP-05',
    name: 'Product and interaction design in federal design systems',
    classification: 'PROVEN',
    baselineArea: 'UX/UI design',
    strength: 'Strong',
    matchSignals: [
      'product design', 'interaction design', 'ui design', 'ux design',
      'design system', 'uswds', 'va design system', 'figma',
      'wireframes and', 'create wireframes', 'deliver wireframes',
      'interactive prototype', 'design prototype', 'clickable prototype',
      'high-fidelity prototype', 'lo-fi prototype', 'mockup', 'visual design',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-11', 'ENG-06', 'ENG-10', 'ENG-14', 'ENG-17'],
    scopeLimitations: [],
  },
  {
    id: 'CAP-06',
    name: 'Design-system and data-visualization pattern contribution',
    classification: 'PROVEN',
    baselineArea: 'UX/UI design',
    strength: 'Moderate',
    matchSignals: [
      'data visualization', 'design patterns', 'component library',
      'design system contribution',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-14'],
    scopeLimitations: ['Adoption outcomes are team-attributed'],
  },
  {
    id: 'CAP-07',
    name: 'Accessibility-focused research and inclusive design',
    classification: 'PROVEN',
    baselineArea: 'UX research',
    strength: 'Moderate',
    matchSignals: [
      'accessibility research', 'inclusive design', 'accessibility audit',
      'accessibility remediation', 'screen reader testing', 'assistive technology',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-14', 'ENG-05', 'ENG-06', 'ENG-04'],
    scopeLimitations: ['Research and design practice, not a 508 compliance testing service line'],
  },
  {
    id: 'CAP-08',
    name: 'Content strategy and plain language',
    classification: 'PROVEN',
    baselineArea: 'Content strategy',
    strength: 'Limited',
    matchSignals: [
      'content strategy', 'plain language', 'content design', 'information architecture',
      'content audit',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-04', 'ENG-10', 'ENG-03', 'ENG-19'],
    scopeLimitations: ['Few content-specific outcomes documented'],
  },
  {
    id: 'CAP-09',
    name: 'Embedded product management',
    classification: 'PROVEN',
    baselineArea: 'Product management',
    strength: 'Limited',
    matchSignals: [
      'product management', 'product owner', 'product strategy', 'product roadmap',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-09', 'ENG-04', 'ENG-19', 'ENG-13'],
    scopeLimitations: ['No program-scale product ownership evidence'],
  },
  {
    id: 'CAP-10',
    name: 'Front-end engineering for federal applications',
    classification: 'PROVEN',
    baselineArea: 'Software development',
    strength: 'Moderate',
    matchSignals: [
      'front-end development', 'frontend development', 'front-end engineering',
      'frontend engineering', 'react application', 'react front-end',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-07', 'ENG-05', 'ENG-18'],
    scopeLimitations: ['Typically one FE engineer at a time; key-person dependency risk'],
  },
  {
    id: 'CAP-11',
    name: 'AI product UX (design and research only)',
    classification: 'PROVEN',
    baselineArea: 'UX/UI design',
    strength: 'Moderate',
    matchSignals: [
      'ai product design', 'chatbot design', 'conversational design',
      'ai user experience', 'llm interface',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-11', 'ENG-10'],
    scopeLimitations: ['AI/ML build performed by prime, not FFTC'],
  },
  {
    id: 'CAP-12',
    name: 'Clinician-facing and healthcare-program UX',
    classification: 'PROVEN',
    baselineArea: 'Domain',
    strength: 'Moderate',
    matchSignals: [
      'clinician experience', 'healthcare ux', 'patient experience',
      'clinical workflow', 'health it usability',
    ],
    exclusionSignals: [],
    engagementIds: ['ENG-14', 'ENG-10', 'ENG-18'],
    scopeLimitations: ['UX only; not EHR or clinical IT engineering'],
  },

  // ========== ADJACENT (5) ==========
  {
    id: 'CAP-13',
    name: 'Prime contract delivery management',
    classification: 'ADJACENT',
    baselineArea: 'Program management',
    strength: 'Limited',
    matchSignals: [],
    exclusionSignals: [],
    engagementIds: ['ENG-19', 'ENG-20', 'ENG-21'],
    scopeLimitations: ['Proven only below $250K and 1-3 staff; federal prime not yet performed'],
  },
  {
    id: 'CAP-14',
    name: 'Research capacity-building and coaching',
    classification: 'ADJACENT',
    baselineArea: 'UX strategy',
    strength: 'Limited',
    matchSignals: ['research operations', 'research practice', 'capacity building'],
    exclusionSignals: [],
    engagementIds: ['ENG-19'],
    scopeLimitations: ['Single instance from closeout'],
  },
  {
    id: 'CAP-15',
    name: 'Section 508 / WCAG compliance testing and remediation service',
    classification: 'ADJACENT',
    baselineArea: 'Accessibility',
    strength: 'Limited',
    matchSignals: ['508 compliance testing', 'vpat', 'accessibility testing service'],
    exclusionSignals: [],
    engagementIds: [],
    scopeLimitations: ['No documented 508 test program, VPATs or remediation deliverables'],
  },
  {
    id: 'CAP-16',
    name: 'Multi-agency process and permitting discovery',
    classification: 'ADJACENT',
    baselineArea: 'Service design',
    strength: 'Limited',
    matchSignals: ['permitting', 'regulatory process', 'multi-agency coordination'],
    exclusionSignals: [],
    engagementIds: ['ENG-21', 'ENG-19'],
    scopeLimitations: ['ENG-21 in progress; reclassify on closeout'],
  },
  {
    id: 'CAP-26',
    name: 'Drupal CMS development and O&M',
    classification: 'ADJACENT',
    baselineArea: 'CMS',
    strength: 'Limited',
    matchSignals: ['drupal'],
    exclusionSignals: [],
    engagementIds: ['ENG-15', 'ENG-04', 'ENG-09'],
    scopeLimitations: ['Delivered via 1099 staff; no deliverables or outcomes documented'],
  },

  // ========== TEAMING_REQUIRED (5) ==========
  {
    id: 'CAP-17',
    name: 'Backend and full-stack software development',
    classification: 'TEAMING_REQUIRED',
    baselineArea: 'Software development',
    strength: null,
    matchSignals: [
      'backend development', 'api development', 'full-stack', 'full stack',
      'database development', 'microservices',
    ],
    exclusionSignals: [
      'backend development', 'api development', 'full-stack', 'full stack',
      'database development', 'microservices',
    ],
    engagementIds: [],
    scopeLimitations: [],
    teamingRequirement: 'Backend/full-stack engineering partner required',
  },
  {
    id: 'CAP-18',
    name: 'Cloud infrastructure, DevOps and SRE operations',
    classification: 'TEAMING_REQUIRED',
    baselineArea: 'Infrastructure',
    strength: null,
    matchSignals: [
      'cloud migration', 'infrastructure', 'devsecops', 'devops', 'sre',
      'hosting', 'fedramp', 'cloud native', 'ci/cd', 'aws', 'azure',
    ],
    exclusionSignals: [
      'cloud migration', 'infrastructure o&m', 'devsecops', 'sre',
      'hosting', 'fedramp',
    ],
    engagementIds: [],
    scopeLimitations: [],
    teamingRequirement: 'Cloud/DevOps partner required',
  },
  {
    id: 'CAP-19',
    name: 'Cybersecurity operations and ATO support',
    classification: 'TEAMING_REQUIRED',
    baselineArea: 'Security',
    strength: null,
    matchSignals: [
      'soc', 'cybersecurity operations', 'ato', 'fisma', 'vulnerability management',
      'penetration testing', 'security operations center',
    ],
    exclusionSignals: [
      'soc', 'cybersecurity operations', 'ato package', 'fisma',
      'vulnerability management', 'penetration testing',
    ],
    engagementIds: [],
    scopeLimitations: [],
    teamingRequirement: 'Cybersecurity partner required',
  },
  {
    id: 'CAP-20',
    name: 'AI/ML product development',
    classification: 'TEAMING_REQUIRED',
    baselineArea: 'AI/ML',
    strength: null,
    matchSignals: [
      'machine learning model', 'mlops', 'model training', 'nlp pipeline',
      'ai/ml development', 'model development',
    ],
    exclusionSignals: [
      'machine learning model development', 'mlops', 'model training',
      'nlp pipeline',
    ],
    engagementIds: [],
    scopeLimitations: [],
    teamingRequirement: 'AI/ML engineering partner required',
  },
  {
    id: 'CAP-21',
    name: 'Clinical and healthcare IT engineering',
    classification: 'TEAMING_REQUIRED',
    baselineArea: 'Healthcare IT',
    strength: null,
    matchSignals: [
      'ehr integration', 'hl7', 'fhir implementation', 'vista',
      'cerner', 'oracle health',
    ],
    exclusionSignals: [
      'ehr integration', 'hl7', 'fhir implementation', 'vista',
      'cerner', 'oracle health',
    ],
    engagementIds: [],
    scopeLimitations: [],
    teamingRequirement: 'Clinical IT / EHR integration partner required',
  },

  // ========== NOT_ESTABLISHED (4) ==========
  {
    id: 'CAP-22',
    name: 'Enterprise data management and data engineering',
    classification: 'NOT_ESTABLISHED',
    baselineArea: 'Data',
    strength: null,
    matchSignals: [],
    exclusionSignals: [
      'data management', 'data warehouse', 'etl', 'data governance',
      'master data management', 'data platform', 'data engineering',
      'data lake', 'data pipeline', 'data integration',
    ],
    engagementIds: [],
    scopeLimitations: [],
  },
  {
    id: 'CAP-23',
    name: 'Enterprise IT service desk operations',
    classification: 'NOT_ESTABLISHED',
    baselineArea: 'IT operations',
    strength: null,
    matchSignals: [],
    exclusionSignals: [
      'service desk', 'help desk', 'tier 1', 'tier 2', 'itsm',
      'servicenow administration', 'end-user support', 'it support',
    ],
    engagementIds: [],
    scopeLimitations: [],
  },
  {
    id: 'CAP-24',
    name: 'Federal acquisition support and procurement-policy documentation',
    classification: 'NOT_ESTABLISHED',
    baselineArea: 'Acquisition',
    strength: null,
    matchSignals: [],
    exclusionSignals: [
      'acquisition support', 'procurement policy', 'contract specialist',
      'far documentation', 'acquisition planning', 'contracting officer',
    ],
    engagementIds: [],
    scopeLimitations: [],
  },
  {
    id: 'CAP-25',
    name: 'Large-scale systems integration',
    classification: 'NOT_ESTABLISHED',
    baselineArea: 'Systems integration',
    strength: null,
    matchSignals: [],
    exclusionSignals: [
      'systems integration', 'systems integrator', 'cots implementation',
      'erp', 'enterprise resource planning',
    ],
    engagementIds: [],
    scopeLimitations: [],
  },
];

export const ENGAGEMENTS: EngagementEntry[] = [
  { id: 'ENG-01', name: 'VA PTEMS', agency: 'VA OCTO', role: 'Sub', prime: 'Agile Six', status: 'Complete', fftcRoles: [], evidenceConfidence: 'Low' },
  { id: 'ENG-02', name: 'ABFM', agency: 'ABFM', role: 'Sub', prime: 'Agile Six', status: 'Complete', fftcRoles: ['UXR', 'PM'], evidenceConfidence: 'Low' },
  { id: 'ENG-03', name: 'NMAAHC Searchable Museum', agency: 'Smithsonian', role: 'Sub', prime: 'Fearless', status: 'Complete', fftcRoles: ['UXR', 'Content'], evidenceConfidence: 'Medium' },
  { id: 'ENG-04', name: 'VA VFS-CMS', agency: 'VA OCTO', role: 'Sub', prime: 'Agile Six', status: 'Complete', fftcRoles: ['PM', 'Content', 'UXR'], evidenceConfidence: 'Medium' },
  { id: 'ENG-05', name: 'VA Authenticated Experience (My VA)', agency: 'VA OCTO', role: 'Sub', prime: 'Agile Six', status: 'Complete', fftcRoles: ['FE Dev'], evidenceConfidence: 'Medium' },
  { id: 'ENG-06', name: 'VA Debt Resolution', agency: 'VA OCTO', role: 'Sub', prime: 'Agile Six', status: 'Complete', fftcRoles: ['UXD', 'UXR'], evidenceConfidence: 'Medium' },
  { id: 'ENG-07', name: 'VA ABD / Disability Benefits (526EZ)', agency: 'VA OCTO', role: 'Sub', prime: 'Agile Six', status: 'Complete', fftcRoles: ['FE Dev', 'UXR'], evidenceConfidence: 'Medium-High' },
  { id: 'ENG-08', name: 'Inclusive Capital Collective', agency: 'ICC', role: 'Sub', prime: 'ARMA', status: 'Complete', fftcRoles: ['UXR'], evidenceConfidence: 'Low' },
  { id: 'ENG-09', name: 'VA Sitewide / Facilities', agency: 'VA OCTO', role: 'Sub', prime: 'Agile Six', status: 'Complete', fftcRoles: ['PM'], evidenceConfidence: 'Medium' },
  { id: 'ENG-10', name: 'CMS QPP', agency: 'CMS', role: 'Sub', prime: 'Agile Six', status: 'Complete', fftcRoles: ['UXR', 'UXD', 'Content', 'Product strategy'], evidenceConfidence: 'High' },
  { id: 'ENG-11', name: 'CMS SEAS-IT', agency: 'CMS OIT', role: 'Sub', prime: 'Skyward', status: 'Active', fftcRoles: ['UXR', 'UXD'], evidenceConfidence: 'High' },
  { id: 'ENG-12', name: 'IRS Direct File', agency: 'IRS', role: 'Sub', prime: 'Coforma', status: 'Complete', fftcRoles: ['UXD'], evidenceConfidence: 'Low' },
  { id: 'ENG-13', name: 'HHS ACF ORR OPTM', agency: 'HHS ACF ORR', role: 'Sub', prime: 'Coforma', status: 'Complete', fftcRoles: ['PM'], evidenceConfidence: 'Medium' },
  { id: 'ENG-14', name: 'VA Data Viz Design Patterns (CDSC)', agency: 'VA CDSC', role: 'Sub', prime: 'Coforma', status: 'Complete', fftcRoles: ['UXR'], evidenceConfidence: 'High' },
  { id: 'ENG-15', name: 'NYS Parks', agency: 'New York State', role: 'Sub', prime: 'ForumOne', status: 'Complete', fftcRoles: ['UXR', 'UXD', 'FE Dev', 'BE Dev'], evidenceConfidence: 'Low-Medium' },
  { id: 'ENG-16', name: 'VA Benefits & Claims PACT', agency: 'VA', role: 'Sub', prime: 'Coforma', status: 'Complete', fftcRoles: ['UXR'], evidenceConfidence: 'Low' },
  { id: 'ENG-17', name: 'VA Financial Management', agency: 'VA OCTO', role: 'Sub', prime: 'Agile Six', status: 'Active', fftcRoles: ['UXD', 'UXR'], evidenceConfidence: 'Medium' },
  { id: 'ENG-18', name: 'VA CDS Apps', agency: 'VA CDSC', role: 'Sub', prime: 'Coforma', status: 'Active', fftcRoles: ['FE Dev'], evidenceConfidence: 'Medium' },
  { id: 'ENG-19', name: 'MD DoIT State UX Research', agency: 'Maryland DoIT', role: 'Prime', prime: null, status: 'Complete', fftcRoles: ['UXR', 'PM'], evidenceConfidence: 'High' },
  { id: 'ENG-20', name: 'MD DoIT Maryland Business Express', agency: 'Maryland DoIT', role: 'Prime', prime: null, status: 'Complete', fftcRoles: ['UXR', 'PM'], evidenceConfidence: 'Medium' },
  { id: 'ENG-21', name: 'NJ Permitting Discovery', agency: 'New Jersey', role: 'Prime', prime: null, status: 'Active', fftcRoles: ['UXR', 'SD', 'RA'], evidenceConfidence: 'Medium' },
];
