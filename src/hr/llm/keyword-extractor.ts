/**
 * Deterministic Keyword Extraction for HR Search
 *
 * Extracts search keywords from natural-language employee questions.
 * Expands HR-specific synonyms so ILIKE substring matching finds
 * relevant chunks regardless of exact wording.
 *
 * Pure functions. No network, database, or credential access.
 */

// ── Stop Words ─────────────────────────────────────────────

/** Common English words that add no retrieval value. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it',
  'they', 'them', 'their', 'its', 'us',
  'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'that', 'this', 'these', 'those',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up',
  'about', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'under', 'over',
  'and', 'but', 'or', 'nor', 'not', 'no', 'so', 'if', 'then',
  'than', 'too', 'very', 'just', 'also',
  'am', 'get', 'got', 'give', 'take', 'make', 'go', 'know', 'tell',
  'say', 'said', 'see', 'come', 'think', 'look', 'want', 'use',
  'find', 'here', 'there', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'some', 'any', 'many', 'much', 'own', 'other',
  'new', 'old', 'right', 'still',
  'please', 'thanks', 'thank', 'hi', 'hello', 'hey',
]);

/**
 * Words that are valid inside multi-word HR phrases but too broad as
 * standalone search terms. Only excluded when they appear alone after
 * multi-word phrase extraction has consumed their meaningful context.
 *
 * Example: "work" is valid inside "work from home" but noise in
 * "How does parental leave work?" where it means "function".
 */
const CONTEXTUAL_STOP_WORDS = new Set([
  'work', 'offer', 'report', 'policy', 'plan', 'program',
  'process', 'information', 'details', 'learn', 'change',
]);

// ── HR Synonym Dictionary ──────────────────────────────────

/**
 * Maps common employee phrasing to canonical HR terms.
 * Each entry: [pattern phrase] → [additional search terms to add].
 * Patterns are matched case-insensitively against the full question.
 */
const HR_SYNONYMS: Array<{ pattern: RegExp; terms: string[] }> = [
  // Time off / Leave
  { pattern: /\bpto\b/i, terms: ['paid time off', 'vacation', 'leave'] },
  { pattern: /\bpaid time off\b/i, terms: ['PTO', 'vacation', 'leave'] },
  { pattern: /\bvacation\b/i, terms: ['PTO', 'paid time off', 'leave'] },
  { pattern: /\btime off\b/i, terms: ['PTO', 'vacation', 'leave'] },
  { pattern: /\bsick\s*(days?|leave|time)\b/i, terms: ['sick leave', 'medical leave', 'illness'] },
  { pattern: /\bmaternity\b/i, terms: ['parental leave', 'maternity leave', 'family leave'] },
  { pattern: /\bpaternity\b/i, terms: ['parental leave', 'paternity leave', 'family leave'] },
  { pattern: /\bparental\s*leave\b/i, terms: ['maternity', 'paternity', 'family leave'] },
  { pattern: /\bbereavement\b/i, terms: ['bereavement leave', 'funeral leave', 'death'] },
  { pattern: /\bfmla\b/i, terms: ['family medical leave', 'FMLA'] },
  { pattern: /\bjury\s*duty\b/i, terms: ['jury duty', 'court leave', 'civic duty'] },

  // Remote work
  { pattern: /\bwork\s*from\s*home\b/i, terms: ['remote work', 'WFH', 'telecommute', 'hybrid'] },
  { pattern: /\bwfh\b/i, terms: ['work from home', 'remote work', 'telecommute'] },
  { pattern: /\bremote\b/i, terms: ['work from home', 'WFH', 'telecommute', 'hybrid'] },
  { pattern: /\bhybrid\b/i, terms: ['remote work', 'work from home', 'in-office'] },

  // Benefits
  { pattern: /\bhealth\s*insurance\b/i, terms: ['medical', 'health benefits', 'coverage'] },
  { pattern: /\b401\s*k\b/i, terms: ['401k', 'retirement', 'pension', '401(k)'] },
  { pattern: /\bretirement\b/i, terms: ['401k', '401(k)', 'pension'] },
  { pattern: /\bdental\b/i, terms: ['dental insurance', 'dental benefits', 'dental plan'] },
  { pattern: /\bvision\b/i, terms: ['vision insurance', 'vision benefits', 'eye care'] },
  { pattern: /\bbenefits\b/i, terms: ['benefits', 'insurance', 'coverage', 'enrollment'] },
  { pattern: /\bopen\s*enrollment\b/i, terms: ['benefits enrollment', 'enrollment period'] },

  // Compensation
  { pattern: /\bsalary\b/i, terms: ['compensation', 'pay', 'wage'] },
  { pattern: /\bpay\b/i, terms: ['compensation', 'salary', 'payroll'] },
  { pattern: /\bbonus\b/i, terms: ['bonus', 'incentive', 'compensation'] },
  { pattern: /\braise\b/i, terms: ['raise', 'salary increase', 'merit increase', 'compensation'] },
  { pattern: /\bpayroll\b/i, terms: ['payroll', 'pay', 'paycheck', 'direct deposit'] },
  { pattern: /\bpaycheck\b/i, terms: ['paycheck', 'payroll', 'pay stub', 'direct deposit'] },

  // Policies
  { pattern: /\bdress\s*code\b/i, terms: ['dress code', 'attire', 'appearance'] },
  { pattern: /\bharassment\b/i, terms: ['harassment', 'discrimination', 'complaint', 'reporting'] },
  { pattern: /\bdiscrimination\b/i, terms: ['discrimination', 'harassment', 'equal opportunity'] },
  { pattern: /\bperformance\s*review\b/i, terms: ['performance review', 'evaluation', 'appraisal'] },
  { pattern: /\bonboarding\b/i, terms: ['onboarding', 'new hire', 'orientation'] },
  { pattern: /\btermination\b/i, terms: ['termination', 'separation', 'firing', 'resignation'] },
  { pattern: /\bresign\b/i, terms: ['resignation', 'notice period', 'termination'] },
  { pattern: /\bexpense\b/i, terms: ['expense', 'reimbursement', 'expense report'] },
  { pattern: /\btravel\b/i, terms: ['travel', 'travel policy', 'business travel', 'expense'] },
  { pattern: /\bholiday\b/i, terms: ['holiday', 'holidays', 'company holiday', 'day off'] },

  // Timekeeping
  { pattern: /\btimekeeping\b/i, terms: ['timesheet', 'time tracking', 'record hours'] },
  { pattern: /\btimesheet\b/i, terms: ['timekeeping', 'time tracking', 'record hours'] },
  { pattern: /\btime\s*sheet\b/i, terms: ['timesheet', 'timekeeping', 'time tracking'] },
  { pattern: /\btime\s*tracking\b/i, terms: ['timekeeping', 'timesheet', 'record hours'] },
  { pattern: /\brecord\s*(my\s*)?hours\b/i, terms: ['timekeeping', 'timesheet', 'time tracking'] },
  { pattern: /\btrack\s*(my\s*)?hours\b/i, terms: ['timekeeping', 'timesheet', 'time tracking'] },
  { pattern: /\blog\s*(my\s*)?hours\b/i, terms: ['timekeeping', 'timesheet', 'time tracking'] },

  // Cybersecurity / IT Security
  { pattern: /\bcyber\s*security\b/i, terms: ['information security', 'IT security', 'security policy'] },
  { pattern: /\binformation\s*security\b/i, terms: ['cybersecurity', 'IT security', 'security policy'] },
  { pattern: /\bit\s*security\b/i, terms: ['cybersecurity', 'information security', 'security policy'] },
  { pattern: /\bsecurity\s*policy\b/i, terms: ['cybersecurity', 'information security', 'IT security'] },
  { pattern: /\bdata\s*security\b/i, terms: ['cybersecurity', 'information security', 'security policy'] },
  { pattern: /\bphishing\b/i, terms: ['cybersecurity', 'security policy'] },
  { pattern: /\bpassword\s*policy\b/i, terms: ['cybersecurity', 'security policy', 'IT security'] },
];

// ── Multi-Word Phrase Detection ────────────────────────────

/**
 * Known multi-word HR phrases that should be kept together.
 * Matched case-insensitively. Checked before word-level tokenization.
 */
const MULTI_WORD_PHRASES = [
  'paid time off', 'time off', 'work from home', 'health insurance',
  'open enrollment', 'direct deposit', 'dress code', 'jury duty',
  'sick leave', 'sick day', 'sick time', 'parental leave',
  'maternity leave', 'paternity leave', 'bereavement leave',
  'family leave', 'medical leave', 'performance review',
  'expense report', 'pay stub', 'notice period', 'new hire',
  'equal opportunity', 'business travel', 'company holiday',
  'merit increase', 'salary increase', 'family medical leave',
  'court leave', 'funeral leave', 'remote work',
  // Timekeeping
  'time tracking', 'time sheet', 'record hours', 'track hours', 'log hours',
  // Cybersecurity
  'information security', 'security policy', 'data security',
  'password policy', 'cyber security',
];

// ── Extractor ──────────────────────────────────────────────

/** Maximum number of search terms returned. */
const MAX_TERMS = 6;

/** Classification of how a search term was derived. */
export type TermSource = 'phrase' | 'keyword' | 'synonym';

/** A search term with its derivation source for relevance scoring. */
export interface SearchTerm {
  text: string;
  source: TermSource;
}

/**
 * Extract search keywords from a natural-language employee question.
 *
 * Strategy:
 * 1. Detect multi-word HR phrases in the question.
 * 2. Tokenize remaining words, remove stop words.
 * 3. Expand with HR synonyms.
 * 4. Return deduplicated terms (phrases first, then individual keywords).
 *
 * Pure function. Returns 1–MAX_TERMS search terms with source metadata.
 */
export function extractSearchTermsWithSource(question: string): SearchTerm[] {
  const lower = question.toLowerCase();
  const terms: SearchTerm[] = [];
  const seen = new Set<string>();

  function addTerm(t: string, source: TermSource): void {
    const normalized = t.toLowerCase().trim();
    if (normalized.length >= 2 && !seen.has(normalized)) {
      seen.add(normalized);
      terms.push({ text: normalized, source });
    }
  }

  // 1. Extract multi-word phrases
  let remaining = lower;
  for (const phrase of MULTI_WORD_PHRASES) {
    if (remaining.includes(phrase)) {
      addTerm(phrase, 'phrase');
      // Remove the phrase so its words aren't also extracted individually
      remaining = remaining.replace(new RegExp(escapeRegex(phrase), 'g'), ' ');
    }
  }

  // 2. Tokenize remaining words, filter stop words and contextual stop words
  const words = remaining
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !CONTEXTUAL_STOP_WORDS.has(w));

  for (const word of words) {
    addTerm(word, 'keyword');
  }

  // 3. Expand synonyms from the original question
  for (const { pattern, terms: synonyms } of HR_SYNONYMS) {
    if (pattern.test(question)) {
      for (const syn of synonyms) {
        addTerm(syn, 'synonym');
      }
    }
  }

  // 4. Cap at MAX_TERMS (phrases first since they're more specific)
  return terms.slice(0, MAX_TERMS);
}

/**
 * Extract search keywords as plain strings (convenience wrapper).
 * Used by retrieval and tests that don't need source metadata.
 */
export function extractSearchTerms(question: string): string[] {
  return extractSearchTermsWithSource(question).map((t) => t.text);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
