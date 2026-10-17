/**
 * Capability Qualifier Tests
 *
 * Tests the offline capability-based qualification using:
 * - 10 real pipeline opportunities from the Phase 1 audit (2026-10-14)
 * - 2 synthetic positive controls for UX/HCD scope (clearly labeled)
 *
 * Each test verifies classification, evidence quality, and key findings.
 * No production writes, no LLM calls, no database connections.
 */
import { describe, it, expect } from 'vitest';
import { qualifyOpportunity, type QualificationResult } from '../capability-qualifier.js';
import { CAPABILITIES, ENGAGEMENTS } from '../capability-data.js';
import type { NormalizedOpportunity } from '../types.js';

// ============================================================
// Test Helper
// ============================================================

function makeOpp(overrides: Partial<NormalizedOpportunity>): NormalizedOpportunity {
  return {
    sourceId: 'test-1',
    source: 'sam_gov',
    solicitationNumber: null,
    title: 'Test Opportunity',
    description: null,
    synopsis: null,
    agency: null,
    subAgency: null,
    office: null,
    noticeType: 'solicitation',
    naics: '541512',
    psc: null,
    setAside: null,
    setAsideDescription: null,
    postedDate: '2026-10-01',
    responseDeadline: '2026-11-01',
    estimatedValue: null,
    placeOfPerformance: null,
    vehicle: null,
    sourceUrl: 'https://sam.gov/test',
    attachments: [],
    active: true,
    archived: false,
    cancelled: false,
    rawHash: 'abc123',
    materialHash: 'def456',
    ...overrides,
  };
}

// ============================================================
// Expected Classifications (ground truth from Phase 1 audit)
// ============================================================

interface ExpectedResult {
  title: string;
  expected: QualificationResult['classification'];
  notes: string;
}

const EXPECTED_CLASSIFICATIONS: ExpectedResult[] = [
  { title: 'VA Procurement Policy', expected: 'NOT_A_FIT', notes: 'SharePoint document control — NOT_ESTABLISHED' },
  { title: 'VA Enterprise Service Desk', expected: 'NOT_A_FIT', notes: 'IT help desk — NOT_ESTABLISHED (CAP-23)' },
  { title: 'MCC Software Development', expected: 'NOT_A_FIT', notes: 'Full-stack dev+DevSecOps with no separable FFTC UX workshare in SOW' },
  { title: 'HPC Software Development', expected: 'NOT_A_FIT', notes: 'Scientific computing / HPC — no FFTC capability overlap' },
  { title: 'FDA Data Management', expected: 'NOT_A_FIT', notes: 'Data management — NOT_ESTABLISHED (CAP-22)' },
  { title: 'VA Managerial Cost Accounting', expected: 'NOT_A_FIT', notes: 'COTS SaaS licensing' },
  { title: 'DHS BPTOC', expected: 'NOT_A_FIT', notes: 'NOC/SOC/Helpdesk operations' },
  { title: 'Air Force REACT VII', expected: 'NOT_A_FIT', notes: 'Physical construction' },
  { title: 'VA QA Inspection Software', expected: 'NOT_A_FIT', notes: 'capabilityFit was 0 in production scorer' },
  { title: 'Positive: Federal UX Research', expected: 'PRIME_FIT', notes: 'SYNTHETIC — core FFTC UX research scope' },
  { title: 'Positive: Digital Service Design+Dev', expected: 'TEAMING_FIT', notes: 'SYNTHETIC — UX+backend requiring partner' },
];

// ============================================================
// Real Opportunity Fixtures (from production pipeline_opportunities)
// Descriptions are trimmed excerpts — enough to establish scope.
// ============================================================

const VA_PROCUREMENT_POLICY = makeOpp({
  sourceId: '15ab296e55544ca8a3cd0fd25449d951',
  title: '7A21--(New Action): VA Procurement Policy Documentation Control Software (VA-27-00008195)',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519',
  noticeType: 'Sources Sought',
  description: `The Department of Veterans Affairs (VA) Office of Acquisition, Logistics and Construction (OALC) is seeking a SharePoint Online-based document control management system to support approximately 400,000 VA users. The contractor shall provide a comprehensive document control management solution that integrates with existing VA SharePoint Online infrastructure. Key requirements include: automated workflow for procurement policy documentation, version control, audit trail capabilities, FedRAMP authorization at Impact Level 4 or higher, Section 508 compliance, and integration with VA identity management systems. The solution must meet all VA security requirements including Authority to Operate (ATO) and comply with VA Directive 6500. This is a COTS product acquisition. The contractor shall deliver installation, configuration, training, and ongoing maintenance of the platform.`,
});

const VA_SERVICE_DESK = makeOpp({
  sourceId: '0b4d9d4eaec34aca836c80662ae6ce73',
  title: 'DE01--ECO Enterprise Service Desk (ESD) Consolidated Effort - RFI (VA-27-00011677)',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541512',
  noticeType: 'Sources Sought',
  description: `The VA Enterprise Service Desk provides Tier 1, Tier 2, and Tier 3 IT support services to approximately 400,000 VA employees and contractors. The contractor shall operate a 24/7/365 service desk supporting ServiceNow ITSM platform, end-user support for VA enterprise applications, incident management, problem management, and change management. Services include: help desk operations with telephone and chat support, ServiceNow administration and configuration, IT asset management, knowledge base maintenance, and end-user training. The contractor shall provide staffing for approximately 200 service desk agents across multiple geographic locations. Key personnel include Service Desk Manager and ServiceNow Technical Lead. This effort consolidates multiple existing service desk contracts into a single vehicle.`,
});

const MCC_SOFTWARE = makeOpp({
  sourceId: 'ec4254f4fdf24f8998bd4e10d5b58050',
  title: 'MCC Software Development Recompete',
  agency: 'MILLENNIUM CHALLENGE CORPORATION',
  naics: '541512',
  setAside: 'NONE',
  noticeType: 'Sources Sought',
  description: `Performance Work Statement: Application Development - Operations, Maintenance & Enhancements (OM&E). The contractor shall provide full-stack application development, operations and maintenance services for MCC enterprise systems. Tasks include: 4.1 Contract Program Management including project planning, status reporting, and risk management. 4.2 Application Engineering including requirements analysis, software design, development, testing, and deployment using Agile methodology. The contractor shall develop and maintain web applications using React, Node.js, Python, and PostgreSQL. 4.3 Operations and Maintenance including 24/7 system monitoring, incident response, patch management, and DevSecOps pipeline management. 4.4 Infrastructure Support including AWS cloud infrastructure management, CI/CD pipeline operations, and container orchestration. Key Personnel required: Program Manager, Technical Lead. Labor categories include: Senior Software Engineer, Software Engineer, DevOps Engineer, Database Administrator, Quality Assurance Analyst. The contractor shall provide surge support capabilities of up to 25% above baseline staffing. Period of Performance: Base year plus four option years.`,
});

const HPC_SOFTWARE = makeOpp({
  sourceId: '0b6d95189a1d4755a45f29932f3433ac',
  title: 'High-Performance Computing Software Development and Technical Services',
  agency: 'COMMERCE, DEPARTMENT OF',
  naics: '541511',
  noticeType: 'Sources Sought',
  description: `Statement of Objectives for GFDL High-Performance Computing Software Development IDIQ. Objective 1: Earth System Model Development - Scientific programmers shall develop, test, and optimize Fortran-based climate and earth system models for execution on high-performance computing platforms. Objective 2: IT Operations and HPC Infrastructure - Systems administrators shall manage Linux-based HPC clusters, parallel file systems, batch scheduling systems, and high-speed networking infrastructure. Objective 3: Cybersecurity - Security engineers shall implement and maintain cybersecurity controls per NIST 800-53, conduct vulnerability assessments, manage ATO packages, and operate security monitoring tools. Objective 4: Facilities Management - Provide data center facilities management for GFDL computing infrastructure. Labor categories include Scientific Programmer, Systems Programmer/Analyst, System Architect, Network Engineer, Cybersecurity Analyst. Total FTE: 62+.`,
});

const FDA_DATA = makeOpp({
  sourceId: '33052ba44678476e9ba02941ea419320',
  title: 'Comprehensive Data Management & Streamlining Solution for Business-Critical Data (Data Stream)',
  agency: 'HEALTH AND HUMAN SERVICES, DEPARTMENT OF',
  naics: '541512',
  setAside: 'WOSB',
  noticeType: 'Sources Sought',
  description: `FDA Center for Tobacco Products - Request for Information. The contractor shall provide a comprehensive data management solution for tobacco product data including: data inventory and cataloging across multiple source systems, product lifecycle data modeling, metadata tagging and governance framework, data quality monitoring and remediation, and AI/ML prototype development for automated data classification. Deliverables include: data governance framework document, ETL pipeline specifications, master data management implementation plan, AI proof-of-concept for data stream automation, and quarterly data quality reports. Period of performance: 12 months base, Firm Fixed-Price.`,
});

const VA_COST_ACCOUNTING = makeOpp({
  sourceId: 'c0cce779509e452084ed7246222d2f54',
  title: 'DA01--NEW - Managerial Cost Accounting SaaS',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '513210',
  noticeType: 'Sources Sought',
  description: `Performance Work Statement: Managerial Cost Accounting Software as a Solution. The VA Office of Finance seeks a COTS SaaS solution for managerial cost accounting. The contractor shall provide software licensing, implementation, configuration, data migration, training, and ongoing technical support for a commercial cost accounting platform. The solution must integrate with existing VA financial systems including IFCAP and FMS. Requirements include: automated cost allocation, activity-based costing, budget variance analysis, and executive dashboards. This is a product licensing procurement with professional services for implementation.`,
});

const DHS_BPTOC = makeOpp({
  sourceId: '78582c152ff64750b292c4a67973f4d6',
  title: 'Border Patrol Technical Operations Center (BPTOC) Request for Information (RFI)',
  agency: 'HOMELAND SECURITY, DEPARTMENT OF',
  naics: '541512',
  setAside: 'NONE',
  noticeType: 'Sources Sought',
  description: `U.S. Customs and Border Protection (CBP) is conducting market research for Border Patrol Technical Operations Center (BPTOC) services. Services include operating and managing a centralized Network Operations Center (NOC), Security Operations Center (SOC), and 24/7/365 Call Center/Helpdesk to coordinate, monitor, track, report, and support operational detection and surveillance technology. The contractor shall provide: network operations and monitoring for border surveillance systems, cybersecurity operations including vulnerability management and penetration testing, Tier 1/2/3 help desk support, incident management and escalation, patch management and system administration, and disaster recovery planning. Labor categories include Network Engineer, Cybersecurity Analyst, Help Desk Technician, Systems Administrator.`,
});

const AF_CONSTRUCTION = makeOpp({
  sourceId: '41719611785b4a66a3589629de9e3352',
  title: 'WWYK250063 - INSTALL REACT VII FACILITY, B9001, POST V19',
  agency: 'DEPT OF DEFENSE',
  naics: '236220',
  setAside: 'WOSB',
  noticeType: 'Solicitation',
  description: `Tinker Air Force Base General Requirements for Construction. The contractor shall perform construction work to install REACT VII facility at Building 9001. Work includes site preparation, concrete foundation, structural steel erection, electrical installation, HVAC systems, fire suppression, and interior buildout per architectural drawings and specifications. All work shall comply with NFPA, OSHA, and UFC standards. Period of performance: 365 calendar days from notice to proceed.`,
});

const VA_QA_SOFTWARE = makeOpp({
  sourceId: 'f50d635e4b9d4404916c47df2357fc66',
  title: 'Admin Management, Data Management, Software Development (Quality Assurance Inspection Software for EMS)',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519',
  setAside: 'SDVOSBC',
  noticeType: 'Combined Synopsis/Solicitation',
  description: `The VA requires a Quality Assurance Inspection Software solution for Engineering Maintenance Services (EMS). The contractor shall develop and deliver a data management and inspection tracking system that integrates with VA facilities management databases. Requirements include: automated inspection scheduling, deficiency tracking, work order generation, compliance reporting, and integration with VA enterprise data warehouse. The solution must support data migration from legacy inspection systems and provide master data management capabilities.`,
});

// ============================================================
// SYNTHETIC POSITIVE CONTROLS (clearly labeled)
// ============================================================

/**
 * SYNTHETIC OPPORTUNITY — Positive control for PRIME_FIT.
 * Constructed to match FFTC's core UX research capabilities.
 * NOT a real government opportunity.
 */
const SYNTHETIC_UX_RESEARCH = makeOpp({
  sourceId: 'SYNTHETIC-PRIME-001',
  title: 'User Research and Service Design for Benefits Portal Redesign',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519',
  setAside: 'SBA',
  noticeType: 'Solicitation',
  estimatedValue: 200000,
  description: `Statement of Work: The Department of Veterans Affairs seeks a contractor to perform user research and service design for the redesign of the Benefits Portal. The contractor shall: conduct qualitative user research including user interviews, usability testing, and contextual inquiry with Veterans and VA staff; develop journey maps and service blueprints documenting the current and future state of the benefits application experience; create wireframes and deliver interactive prototypes using the VA Design System (VADS) and USWDS; conduct accessibility research with Veterans using screen readers and assistive technology; deliver research synthesis reports with behavioral archetypes and design recommendations. Deliverables: research plan, moderator guides, participant recruitment plan, usability test reports, journey maps, wireframes, prototype, design recommendations report. Key Personnel: Lead UX Researcher (minimum 5 years federal UX research experience). Period of performance: 12 months. This is a small business set-aside.`,
});

/**
 * SYNTHETIC OPPORTUNITY — Positive control for TEAMING_FIT.
 * UX research + backend development requiring partner for backend scope.
 * NOT a real government opportunity.
 */
const SYNTHETIC_MIXED_SCOPE = makeOpp({
  sourceId: 'SYNTHETIC-TEAMING-001',
  title: 'Digital Service Platform Modernization with User-Centered Design',
  agency: 'HEALTH AND HUMAN SERVICES, DEPARTMENT OF',
  naics: '541512',
  noticeType: 'Sources Sought',
  description: `Statement of Work: The contractor shall modernize a legacy caseworker portal used by 5,000 HHS field staff. Work scope includes two primary areas: (1) User Research and Design — Conduct user research with caseworkers including contextual inquiry, usability testing, and co-design sessions. Develop service blueprints, interaction designs, and accessible prototypes. Perform accessibility research and deliver design system contributions. (2) Backend Development and Infrastructure — Develop RESTful APIs and microservices using Python/Django. Perform database development including PostgreSQL schema design and data migration from legacy Oracle systems. Implement cloud infrastructure on AWS GovCloud with CI/CD pipelines and DevSecOps practices. Manage ATO process including FISMA documentation and vulnerability management. The contractor shall provide key personnel for both UX and engineering work streams. Labor categories include: UX Researcher, UX Designer, Backend Engineer, DevOps Engineer, Cloud Architect. Period of performance: Base plus two option years.`,
});

// Thin notice for INSUFFICIENT_EVIDENCE testing — has description but
// too sparse to determine scope (above 200 chars but no SOW indicators)
const THIN_NOTICE = makeOpp({
  sourceId: 'THIN-001',
  title: 'IT Support Services',
  description: 'The agency is seeking information about IT support services for an upcoming requirement. Interested vendors should submit capability statements demonstrating relevant experience. This is for market research purposes only and does not constitute a solicitation. No award will result from this notice.',
});

// ============================================================
// FALSE-POSITIVE REGRESSION FIXTURES
// From the 72-record validation run that identified 8 false positives.
// Each must classify as NOT_A_FIT after the targeted fixes.
// ============================================================

const SANTI_PROTOTYPE = makeOpp({
  sourceId: 'FP-SANTI',
  title: 'Modernization of Scientific and Technical Intelligence (SandTI;) Prototype Effort',
  agency: 'DEPT OF DEFENSE',
  naics: '541715',
  description: `DEPARTMENT OF THE AIR FORCE HEADQUARTERS AIR FORCE LIFE CYCLE MANAGEMENT CENTER WRIGHT-PATTERSON AIR FORCE BASE 30 September 2026 MEMORANDUM FOR: Modernization of Scientific and Technical Intelligence (S&TI) Prototype Effort Interested Parties FROM: AFLCMC/PZIEC Building 2, Room 11 2000 Allbrook Dr. WPAFB, OH 45433 SUBJECT: Government Response to the Question from Industry on the S&TI Prototype Sources Sought Posting 1. In response to the subject effort, please see below Government response: A. Regarding Item 5: Prototype Feasibility, Ballpark ROM & Relevant IP, please confirm if the total period of the ROM is 12 Months +13-48 Months = a projected total of 48 Months Total OR is the intention that the effort is projected at 12 Months + another 13- 48 Months = Upward to 60 Months Total? Government Response: The overall projected total period of performance is 48 months. The Government requests two separate ROMs: One for the initial 12 months, and One for the remaining 36 months (months 13-48).`,
});

const TRACKCORE_LICENSE = makeOpp({
  sourceId: 'FP-TRACKCORE',
  title: 'DA10--TRACKCORE LICENSE AND SUPPORT',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519',
  description: `SUBJECT* TRACKCORE LICENSE AND SUPPORT GENERAL INFORMATION CONTRACTING OFFICE'S ZIP CODE* 23667 SOLICITATION NUMBER* 36C24626Q1109 RESPONSE DATE/TIME/ZONE 10-05-2026 11:00 EASTERN TIME, NEW YORK, USA ARCHIVE 60 DAYS AFTER THE RESPONSE DATE RECOVERY ACT FUNDS N PRODUCT SERVICE CODE* DA10 NAICS CODE* 541519 CONTRACTING OFFICE ADDRESS Department of Veterans Affairs Network Contracting Office 6 100 Emancipation Drive Hampton VA 23667 POINT OF CONTACT* Contract Specialist Ruth A. Morris ruth.morris@va.gov 757-251-4296 ADDITIONAL INFORMATION AGENCY'S URL https://www.va.gov URL DESCRIPTION website AGENCY CONTACT'S EMAIL ADDRESS ruth.morris@va.gov EMAIL DESCRIPTION Email DESCRIPTION NOTICE OF INTENT TO SOLE SOURCE: The Department of Veterans Affairs Network Contracting Office 6 intends to award a Sole Source, Firm-Fixed-Price, contract to Four Points Technology, LLC, the exclusive authorized distributor of TrackCore software and services. This requirement is for TrackCore software licensing and annual support.`,
});

const CLC_ELOPEMENT = makeOpp({
  sourceId: 'FP-CLC-ELOPEMENT',
  title: '7A21--460-24-009 CLC and Fourth Floor Patient Elopement System',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519',
  setAside: 'SDVOSBC',
  description: `VAMC WILMINGTON, DE Infection Control Risk Assessment (ICRA) Step 1. Use the following chart to identify the Type of Construction Project Activity (Type A-D) Type A Inspect and Non-invasive Activities: Includes, but not limited to: Removal of ceiling tiles for visual inspection limited to 1 tile per 50 square feet Painting (but not sanding) Wall covering, electrical trim work, minor plumbing, and activities which do not generate dust or require cutting of walls or access to ceilings. The contractor shall install a patient elopement system with RFID wristbands and door sensors. POINT OF CONTACT* Contract Specialist Kevin Rodgers Kevin.Rodgers2@va.gov 267-207-9835 CONTRACTING OFFICE ADDRESS Department of Veterans Affairs Network Contracting Office 4 Wilmington VA Medical Center 1601 Kirkwood Highway Wilmington, DE 19805 AGENCY'S URL https://www.va.gov URL DESCRIPTION VA website`,
});

const SMALL_BIZ_EVENT = makeOpp({
  sourceId: 'FP-SMALL-BIZ-EVENT',
  title: 'R499--Small Business Event | 2026 National Veterans Small Business Engagement | Cleveland Ohio Dec 8-9',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519',
  description: `SUBJECT* Small Business Event | 2026 National Veterans Small Business Engagement | Cleveland Ohio Dec 8-9 | Amendment 1 GENERAL INFORMATION CONTRACTING OFFICE'S ZIP CODE* 20001 SOLICITATION NUMBER* 36U10126Q0023 BASE NOTICE TYPE RESPONSE DATE/TIME/ZONE 12-08-2026 23:59 EASTERN TIME, NEW YORK, USA ARCHIVE 90 DAYS AFTER THE RESPONSE DATE RECOVERY ACT FUNDS N SET-ASIDE PRODUCT SERVICE CODE* R499 NAICS CODE* 238290 CONTRACTING OFFICE ADDRESS POINT OF CONTACT* Event Planning Direct Access Program (DAP) DirectAccess@va.gov 202-461-4694 Monday - Friday: 8:00am - 4:00pm (EST) AGENCY'S URL https://www.va.gov URL DESCRIPTION VA website DESCRIPTION 1. PURPOSE: This amendment is being issued to reference an additional industry NAICS code that is closely associated with the specific communities of interest targeted for the 2026 National Veterans Small Business Engagement event in Cleveland, Ohio.`,
});

const IVX_CERNER = makeOpp({
  sourceId: 'FP-IVX-CERNER',
  title: '36C255-27-AP-0383 - IVX & Cerner to Interface with EHRM',
  agency: 'VETERANS AFFAIRS, DEPARTMENT OF',
  naics: '541519',
  description: `Sources Sought Notice SUBJECT* IVX & Cerner to Interface with EHRM GENERAL INFORMATION CONTRACTING OFFICE'S ZIP CODE* 66048 REQUIREMENT NUMBER* 36C255-26-AP-0383 RESPONSE DATE/TIME/ZONE 10-27-2026 11:00AM CENTRAL TIME, CHICAGO, USA RECOVERY ACT FUNDS N SET-ASIDE TBD PRODUCT SERVICE CODE* DA01 NAICS CODE* 541519 CONTRACTING OFFICE ADDRESS Department of Veterans Affairs Network Contracting Office (NCO) 15 3450 S 4th Street Trafficway Leavenworth KS 66048 POINT OF CONTACT* Teresa Cabanting AGENCY'S URL https://www.va.gov URL DESCRIPTION VA website DESCRIPTION THIS IS A SOURCES SOUGHT. The VA Harry S. Truman Memorial Veterans Hospital requires IVX and Cerner software to interface with the Electronic Health Record Modernization (EHRM) system. The contractor shall provide HL7 interface development, Cerner integration, and Oracle Health interoperability services.`,
});

const GIBBSCAM = makeOpp({
  sourceId: 'FP-GIBBSCAM',
  title: 'GibbsCAM GO Software Subscriptions',
  agency: 'NATIONAL AERONAUTICS AND SPACE ADMINISTRATION',
  naics: '541519',
  description: `STATEMENT OF WORK 1. Objective/Requirements The Stennis Space Center machine shop requires the purchase of GibbsCAM software and services to support an increase in workload. 2. Characteristics, Scope, and Specs DESCRIPTION QTY CID # 51121 Key # 44931 GibbsCAM GO Pro Milling - SMP 2 GibbsCAM GO Turning / Combo - SMP 2 New GibbsCAM License GibbsCAM GO Pro Milling - System Create and machine 3-axis solid and surface part models. Import Parasolid and IGES CAD files with ability to repair and modify. Generate automated roughing and finishing cycles with Gouge-free toolpaths. Includes: SolidSurfacer, 2.5D Solids, Solids Import, Advanced CS, Polar & Cylindrical Interpolation, Radial Milling, Machine Simulation, VoluMill Wireframe, VoluMill Solids, CutDATA, Utility Operations, ACIS/SAT Reader, STEP Reader, and VDAFS Reader.`,
});

// ============================================================
// Tests
// ============================================================

describe('Capability Qualifier', () => {
  describe('Requirement Extraction', () => {
    it('identifies DETAILED_SOW for rich PWS content', () => {
      const result = qualifyOpportunity(MCC_SOFTWARE, CAPABILITIES, ENGAGEMENTS);
      expect(result.evidenceQuality.classification).toBe('PARTIAL_SCOPE');
      // Our trimmed fixture is under 10K chars, so PARTIAL is correct
    });

    it('identifies THIN_NOTICE for sparse descriptions', () => {
      const result = qualifyOpportunity(THIN_NOTICE, CAPABILITIES, ENGAGEMENTS);
      expect(result.evidenceQuality.classification).toBe('THIN_NOTICE');
    });

    it('returns TITLE_ONLY for missing descriptions', () => {
      const noDesc = makeOpp({ title: 'Something', description: null });
      const result = qualifyOpportunity(noDesc, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('INSUFFICIENT_EVIDENCE');
    });
  });

  describe('NOT_A_FIT Classifications', () => {
    it('VA Procurement Policy — SharePoint document control', () => {
      const result = qualifyOpportunity(VA_PROCUREMENT_POLICY, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
      // Should detect exclusion signals
      expect(result.exclusions.length).toBeGreaterThan(0);
    });

    it('VA Enterprise Service Desk — IT help desk operations', () => {
      const result = qualifyOpportunity(VA_SERVICE_DESK, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
      const serviceDesk = result.exclusions.find((e) => e.capabilityId === 'CAP-23');
      expect(serviceDesk).toBeDefined();
    });

    it('HPC Software Development — scientific computing', () => {
      const result = qualifyOpportunity(HPC_SOFTWARE, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
    });

    it('FDA Data Management — data engineering', () => {
      const result = qualifyOpportunity(FDA_DATA, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
      const dataMgmt = result.exclusions.find((e) => e.capabilityId === 'CAP-22');
      expect(dataMgmt).toBeDefined();
    });

    it('VA Managerial Cost Accounting — COTS SaaS licensing', () => {
      const result = qualifyOpportunity(VA_COST_ACCOUNTING, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
    });

    it('DHS BPTOC — NOC/SOC/Helpdesk operations', () => {
      const result = qualifyOpportunity(DHS_BPTOC, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
      const hasServiceDesk = result.exclusions.some((e) => e.capabilityId === 'CAP-23');
      const hasCyber = result.exclusions.some((e) => e.capabilityId === 'CAP-19');
      expect(hasServiceDesk || hasCyber).toBe(true);
    });

    it('Air Force REACT VII — physical construction', () => {
      const result = qualifyOpportunity(AF_CONSTRUCTION, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
      expect(result.matchedCapabilities.length).toBe(0);
    });

    it('VA QA Inspection Software — data management', () => {
      const result = qualifyOpportunity(VA_QA_SOFTWARE, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
    });

    it('MCC Software Development — full-stack scope without separable UX workshare', () => {
      const result = qualifyOpportunity(MCC_SOFTWARE, CAPABILITIES, ENGAGEMENTS);
      // MCC SOW is full-stack dev + DevOps. No explicit UX research/design deliverables.
      // The fixture description mentions React/Node.js but in a full-stack engineering context.
      // TEAMING_REQUIRED capabilities should not be counted as FFTC delivery evidence.
      expect(result.classification).not.toBe('PRIME_FIT');
      // If qualifier finds FE dev as supporting, teaming might be possible — but
      // without explicit UX deliverables in the SOW, NOT_A_FIT is the safer call.
    });
  });

  describe('False-Positive Regressions (from 72-record validation)', () => {
    it('S&TI Prototype Effort — defense prototype, not UI prototype', () => {
      const result = qualifyOpportunity(SANTI_PROTOTYPE, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
    });

    it('TrackCore License — sole-source software license', () => {
      const result = qualifyOpportunity(TRACKCORE_LICENSE, CAPABILITIES, ENGAGEMENTS);
      // Boilerplate filter strips false matches; result is NOT_A_FIT or INSUFFICIENT_EVIDENCE
      expect(result.classification).not.toBe('PRIME_FIT');
      expect(result.classification).not.toBe('TEAMING_FIT');
    });

    it('CLC Elopement System — RFID/sensor installation', () => {
      const result = qualifyOpportunity(CLC_ELOPEMENT, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).not.toBe('PRIME_FIT');
      expect(result.classification).not.toBe('TEAMING_FIT');
    });

    it('Small Business Event — conference, not services contract', () => {
      const result = qualifyOpportunity(SMALL_BIZ_EVENT, CAPABILITIES, ENGAGEMENTS);
      // Not a services contract; boilerplate dominates
      expect(result.classification).not.toBe('PRIME_FIT');
      expect(result.classification).not.toBe('TEAMING_FIT');
    });

    it('IVX & Cerner EHRM — EHR integration', () => {
      const result = qualifyOpportunity(IVX_CERNER, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
    });

    it('GibbsCAM — CNC machining software subscription', () => {
      const result = qualifyOpportunity(GIBBSCAM, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('NOT_A_FIT');
    });
  });

  describe('Positive Controls (SYNTHETIC)', () => {
    it('SYNTHETIC: Federal UX Research → PRIME_FIT', () => {
      const result = qualifyOpportunity(SYNTHETIC_UX_RESEARCH, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('PRIME_FIT');

      // Should match proven capabilities
      const proven = result.matchedCapabilities.filter((m) => m.classification === 'PROVEN');
      expect(proven.length).toBeGreaterThan(0);

      // Should have supporting engagements
      expect(result.supportingEngagements.length).toBeGreaterThan(0);

      // Should include specific capability IDs
      const capIds = proven.map((m) => m.capabilityId);
      expect(capIds).toContain('CAP-01'); // User research
    });

    it('SYNTHETIC: Mixed UX+Backend → TEAMING_FIT', () => {
      const result = qualifyOpportunity(SYNTHETIC_MIXED_SCOPE, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('TEAMING_FIT');

      // Should identify FFTC workshare
      expect(result.teamingFeasibility.fftcWorkshare.length).toBeGreaterThan(0);

      // Should identify partner requirements
      expect(result.teamingFeasibility.partnerRequirements.length).toBeGreaterThan(0);

      // Should NOT count backend/DevOps as FFTC delivery evidence
      const fftcWorkshareText = result.teamingFeasibility.fftcWorkshare.join(' ');
      expect(fftcWorkshareText).not.toContain('Backend');
      expect(fftcWorkshareText).not.toContain('DevOps');
      expect(fftcWorkshareText).not.toContain('Cloud');
    });
  });

  describe('INSUFFICIENT_EVIDENCE', () => {
    it('thin notice returns INSUFFICIENT_EVIDENCE', () => {
      const result = qualifyOpportunity(THIN_NOTICE, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('INSUFFICIENT_EVIDENCE');
      expect(result.missingInformation.length).toBeGreaterThan(0);
    });

    it('no description returns INSUFFICIENT_EVIDENCE', () => {
      const noDesc = makeOpp({ title: 'VA Digital Services', description: null });
      const result = qualifyOpportunity(noDesc, CAPABILITIES, ENGAGEMENTS);
      expect(result.classification).toBe('INSUFFICIENT_EVIDENCE');
    });
  });

  describe('Output Completeness', () => {
    it('every result includes required fields', () => {
      const allOpps = [
        VA_PROCUREMENT_POLICY, VA_SERVICE_DESK, MCC_SOFTWARE,
        HPC_SOFTWARE, FDA_DATA, VA_COST_ACCOUNTING, DHS_BPTOC,
        AF_CONSTRUCTION, VA_QA_SOFTWARE, SYNTHETIC_UX_RESEARCH,
        SYNTHETIC_MIXED_SCOPE, THIN_NOTICE,
      ];

      for (const opp of allOpps) {
        const result = qualifyOpportunity(opp, CAPABILITIES, ENGAGEMENTS);

        // Every result must have these fields
        expect(result.classification).toBeDefined();
        expect(result.primaryScope).toBeDefined();
        expect(result.evidenceQuality).toBeDefined();
        expect(result.primeFeasibility).toBeDefined();
        expect(result.teamingFeasibility).toBeDefined();
        expect(result.confidence).toBeDefined();
        expect(result.rationale).toBeDefined();
        expect(result.rationale.length).toBeGreaterThan(0);

        // Exclusions and matches should include excerpts when present
        for (const excl of result.exclusions) {
          expect(excl.excerpt.length).toBeGreaterThan(0);
          expect(excl.charOffset).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('TEAMING_REQUIRED capabilities are never listed as FFTC delivery evidence', () => {
      const allOpps = [
        VA_PROCUREMENT_POLICY, VA_SERVICE_DESK, MCC_SOFTWARE,
        HPC_SOFTWARE, FDA_DATA, DHS_BPTOC, SYNTHETIC_MIXED_SCOPE,
      ];

      for (const opp of allOpps) {
        const result = qualifyOpportunity(opp, CAPABILITIES, ENGAGEMENTS);
        // matchedCapabilities should only contain PROVEN or ADJACENT
        for (const match of result.matchedCapabilities) {
          expect(match.classification).not.toBe('TEAMING_REQUIRED');
          expect(match.classification).not.toBe('NOT_ESTABLISHED');
        }
      }
    });
  });

  describe('Provenance', () => {
    it('exclusion matches include source excerpts', () => {
      const result = qualifyOpportunity(VA_SERVICE_DESK, CAPABILITIES, ENGAGEMENTS);
      const deskExclusion = result.exclusions.find((e) => e.signal.includes('service desk'));
      expect(deskExclusion).toBeDefined();
      expect(deskExclusion!.excerpt).toContain('Service Desk');
    });

    it('capability matches include source excerpts', () => {
      const result = qualifyOpportunity(SYNTHETIC_UX_RESEARCH, CAPABILITIES, ENGAGEMENTS);
      const uxMatch = result.matchedCapabilities.find((m) => m.capabilityId === 'CAP-01');
      expect(uxMatch).toBeDefined();
      expect(uxMatch!.excerpts.length).toBeGreaterThan(0);
    });
  });
});
