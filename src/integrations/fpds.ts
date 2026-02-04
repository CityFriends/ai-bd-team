// FPDS Integration - DEPRECATED
// FPDS is being retired in February 2026. All data has moved to SAM.gov/USASpending.
// This file re-exports from contract-data.ts for backwards compatibility.

export {
  // Types (aliased for compatibility)
  type ContractAward as FPDSContract,
  type ContractSearchResult as FPDSSearchResult,

  // Functions (aliased for compatibility)
  searchContracts as searchFPDS,
  searchByContractNumber,
  findIncumbent,
  getVendorHistory,
  formatContractDataForAgent as formatFPDSForAgent,
} from './contract-data.js';

// Log deprecation notice once
let deprecationLogged = false;
export function logFPDSDeprecation() {
  if (!deprecationLogged) {
    console.log('[NOTICE] FPDS is deprecated. Using USASpending.gov API instead.');
    deprecationLogged = true;
  }
}
