/**
 * HR Knowledge Search Module
 *
 * C8X-107BQ: Guru-style keyword search across approved HR content.
 */

export {
  searchHRKnowledge,
  formatSearchResultsForSlack,
  parseSearchCommand,
  extractSearchQuery,
  validateQuery,
  isPhraseQuery,
  hashQuery,
  isSearchError,
  type SearchResult,
  type SearchResponse,
  type SearchError,
} from './keyword-search.js';
