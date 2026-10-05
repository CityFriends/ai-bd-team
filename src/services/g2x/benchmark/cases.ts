/**
 * G2X Benchmark Cases
 *
 * 3-5 representative commissioning cases covering:
 * A. Software/digital modernization opportunity
 * B. Solicitation with substantial attachments/SOW
 * C. Incumbent/award-history research
 * D. Teaming/company research
 * E. Forecast/pre-solicitation if Community exposes
 *
 * Uses existing historical/non-production opportunities.
 * Does NOT manufacture production captures.
 * Does NOT invoke LLM provider calls.
 */

import type { BenchmarkCase } from '../types.js';

/**
 * Benchmark cases using known public GovCon opportunities.
 * These are historical/public records suitable for transport testing.
 */
export const BENCHMARK_CASES: BenchmarkCase[] = [
  // Case A: Software/Digital Modernization
  {
    id: 'bench-a-software-mod',
    type: 'SOFTWARE_MODERNIZATION',
    description:
      'Software modernization / digital transformation opportunity. ' +
      'Tests discovery, metadata richness, and source reference quality.',
    knownOpportunityId: null, // Will use search-based discovery
    searchTerms: ['software modernization', 'digital transformation', 'IT modernization'],
    expectedEvidence: [
      'opportunity_metadata',
      'agency_info',
      'set_aside_info',
      'response_deadline',
    ],
    testDocumentRetrieval: false,
  },

  // Case B: Solicitation with Attachments
  {
    id: 'bench-b-solicitation-docs',
    type: 'SOLICITATION_ATTACHMENTS',
    description:
      'Solicitation with substantial attachments/SOW. ' +
      'Tests document inventory, attachment retrieval, version tracking, ' +
      'and checksum validation.',
    knownOpportunityId: null, // Will use first result from Case A
    searchTerms: ['statement of work', 'SOW', 'solicitation'],
    expectedEvidence: ['document_inventory', 'attachment_text', 'version_info', 'checksum'],
    testDocumentRetrieval: true,
  },

  // Case C: Incumbent/Award History
  {
    id: 'bench-c-incumbent',
    type: 'INCUMBENT_RESEARCH',
    description:
      'Incumbent and award history research. ' +
      'Tests contract data, award amounts, contractor details.',
    knownOpportunityId: null,
    searchTerms: ['VA', 'Veterans Affairs', 'EHR', 'health IT'],
    expectedEvidence: ['award_history', 'incumbent_name', 'contract_value', 'performance_period'],
    testDocumentRetrieval: false,
  },

  // Case D: Teaming/Company Research
  {
    id: 'bench-d-teaming',
    type: 'TEAMING_COMPANY',
    description:
      'Company and teaming intelligence research. ' +
      'Tests company search, contract history, socioeconomic status.',
    knownOpportunityId: null,
    searchTerms: ['Booz Allen', 'Deloitte', 'Leidos'],
    expectedEvidence: [
      'company_info',
      'contract_history',
      'socioeconomic_status',
      'teaming_partners',
    ],
    testDocumentRetrieval: false,
  },

  // Case E: Forecast/Pre-Solicitation
  {
    id: 'bench-e-forecast',
    type: 'FORECAST_PRESOLICITATION',
    description:
      'Forecast and pre-solicitation research. ' +
      'Tests whether Community plan exposes forecast data. ' +
      'Expected to return CAPABILITY_UNAVAILABLE if not supported.',
    knownOpportunityId: null,
    searchTerms: ['cloud migration', 'FY2027', 'forecast'],
    expectedEvidence: ['forecast_data', 'planned_acquisition', 'timeline'],
    testDocumentRetrieval: false,
  },
];
