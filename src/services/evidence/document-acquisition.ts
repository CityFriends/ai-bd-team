/**
 * Document Acquisition Service
 *
 * Safely retrieves and extracts text from opportunity attachments.
 * Reusable across Maya, David, Marcus, James, etc.
 *
 * Safety:
 *   - Only fetches URLs from authoritative opportunity source records
 *   - URL allowlist (sam.gov domains)
 *   - MIME type allowlist
 *   - Size limits per document and per opportunity
 *   - Download count limits
 *   - Timeouts
 *   - No arbitrary URL fetching / SSRF prevention
 *   - No LLM calls
 *   - No Slack posts
 */

import { createHash } from 'crypto';

// ============================================================
// Configuration
// ============================================================

export interface AcquisitionConfig {
  maxDocumentsPerOpportunity: number;
  maxBytesPerDocument: number;
  maxTotalBytesPerOpportunity: number;
  maxExtractedCharsPerDocument: number;
  requestTimeoutMs: number;
  opportunityTimeoutMs: number;
  allowedMimeTypes: string[];
  allowedUrlDomains: string[];
}

export const DEFAULT_ACQUISITION_CONFIG: AcquisitionConfig = {
  maxDocumentsPerOpportunity: 5,
  maxBytesPerDocument: 10 * 1024 * 1024, // 10 MB
  maxTotalBytesPerOpportunity: 25 * 1024 * 1024, // 25 MB
  maxExtractedCharsPerDocument: 50_000,
  requestTimeoutMs: 30_000,
  opportunityTimeoutMs: 120_000,
  allowedMimeTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/html',
    'application/msword',
  ],
  allowedUrlDomains: ['sam.gov', 'api.sam.gov', 'beta.sam.gov'],
};

// ============================================================
// Document Priority
// ============================================================

/** Score attachment by likely scope relevance based on filename */
const SCOPE_PRIORITY_TERMS = [
  { pattern: /solicitation/i, score: 10 },
  { pattern: /statement\s*of\s*work|sow/i, score: 10 },
  { pattern: /performance\s*work\s*statement|pws/i, score: 10 },
  { pattern: /statement\s*of\s*objectives|soo/i, score: 9 },
  { pattern: /requirements/i, score: 8 },
  { pattern: /rfp|rfq|rfi/i, score: 8 },
  { pattern: /sources?\s*sought/i, score: 7 },
  { pattern: /draft/i, score: 6 },
  { pattern: /description/i, score: 5 },
  { pattern: /scope/i, score: 5 },
  { pattern: /synopsis/i, score: 4 },
  { pattern: /amendment/i, score: 3 },
];

const LOW_PRIORITY_TERMS = [
  /wage\s*determination/i,
  /representations?\s*and\s*certifications/i,
  /sf[\s-]?1449/i,
  /sf[\s-]?33/i,
  /sf[\s-]?30/i,
  /far\s*clause/i,
  /52\.2/i, // FAR clause references
  /provisions/i,
];

export interface AttachmentInfo {
  name: string;
  url: string;
  priorityScore: number;
  mimeType?: string;
}

export function prioritizeAttachments(
  attachments: Array<{ name: string; url?: string; type?: string }>,
  config: AcquisitionConfig = DEFAULT_ACQUISITION_CONFIG
): AttachmentInfo[] {
  return attachments
    .filter((a) => a.url)
    .map((a) => {
      let score = 1;
      const name = a.name || '';

      for (const { pattern, score: s } of SCOPE_PRIORITY_TERMS) {
        if (pattern.test(name)) {
          score = Math.max(score, s);
          break;
        }
      }
      for (const pattern of LOW_PRIORITY_TERMS) {
        if (pattern.test(name)) {
          score = 0;
          break;
        }
      }

      return {
        name,
        url: a.url!,
        priorityScore: score,
        mimeType: a.type,
      };
    })
    .filter((a) => a.priorityScore > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore || a.name.localeCompare(b.name))
    .slice(0, config.maxDocumentsPerOpportunity);
}

// ============================================================
// URL Safety
// ============================================================

export function isUrlSafe(
  url: string,
  config: AcquisitionConfig = DEFAULT_ACQUISITION_CONFIG
): boolean {
  try {
    const parsed = new URL(url);
    // Must be HTTPS
    if (parsed.protocol !== 'https:') return false;
    // Must match allowed domain
    return config.allowedUrlDomains.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

// ============================================================
// Document Retrieval
// ============================================================

export interface RetrievedDocument {
  name: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  retrievedAt: string;
  content: Buffer;
}

export interface RetrievalResult {
  document: RetrievedDocument | null;
  error: string | null;
  skippedReason: string | null;
}

export async function retrieveDocument(
  attachment: AttachmentInfo,
  config: AcquisitionConfig = DEFAULT_ACQUISITION_CONFIG
): Promise<RetrievalResult> {
  // SSRF prevention
  if (!isUrlSafe(attachment.url, config)) {
    return {
      document: null,
      error: null,
      skippedReason: `URL domain not in allowlist: ${attachment.url}`,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    // SAM.gov resource/file download URLs are PUBLIC — do NOT append API key.
    // The API key is only required for the SAM search API, not file downloads.
    // Appending api_key to file download URLs causes HTTP 400.
    const fetchUrl = attachment.url;

    const response = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: { Accept: config.allowedMimeTypes.join(', ') },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { document: null, error: `HTTP ${response.status}`, skippedReason: null };
    }

    // Determine MIME type — SAM.gov often returns application/octet-stream
    const contentType = response.headers.get('content-type') || '';
    let mimeType = contentType.split(';')[0].trim();

    // If server says octet-stream, infer from filename/URL
    if (mimeType === 'application/octet-stream' || !mimeType) {
      const urlLower = attachment.url.toLowerCase();
      const nameLower = attachment.name.toLowerCase();
      if (urlLower.endsWith('.pdf') || nameLower.endsWith('.pdf')) mimeType = 'application/pdf';
      else if (urlLower.endsWith('.docx') || nameLower.endsWith('.docx'))
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (urlLower.endsWith('.doc') || nameLower.endsWith('.doc'))
        mimeType = 'application/msword';
      else if (urlLower.endsWith('.txt') || nameLower.endsWith('.txt')) mimeType = 'text/plain';
      else if (urlLower.endsWith('.html') || urlLower.endsWith('.htm')) mimeType = 'text/html';
      else mimeType = 'application/octet-stream'; // Will try PDF extraction as fallback
    }

    // For octet-stream with no extension hint, attempt PDF extraction later
    const isAllowed =
      config.allowedMimeTypes.some((m) => mimeType.includes(m) || m.includes(mimeType)) ||
      mimeType === 'application/octet-stream'; // Allow octet-stream, determine type during extraction
    if (!isAllowed) {
      return { document: null, error: null, skippedReason: `MIME type not allowed: ${mimeType}` };
    }

    // Check size via Content-Length header
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > config.maxBytesPerDocument) {
      return {
        document: null,
        error: null,
        skippedReason: `Document too large: ${contentLength} bytes`,
      };
    }

    // Read body
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > config.maxBytesPerDocument) {
      return {
        document: null,
        error: null,
        skippedReason: `Document too large after download: ${buffer.length} bytes`,
      };
    }

    const contentHash = createHash('sha256').update(buffer).digest('hex');

    return {
      document: {
        name: attachment.name,
        url: attachment.url,
        mimeType,
        sizeBytes: buffer.length,
        contentHash,
        retrievedAt: new Date().toISOString(),
        content: buffer,
      },
      error: null,
      skippedReason: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      return { document: null, error: 'Request timed out', skippedReason: null };
    }
    return { document: null, error: msg, skippedReason: null };
  }
}

// ============================================================
// Text Extraction
// ============================================================

export interface ExtractionResult {
  text: string;
  charCount: number;
  method: 'pdf_text' | 'docx_text' | 'plain_text' | 'html_text' | 'ocr_required' | 'unsupported';
  truncated: boolean;
}

export async function extractText(
  doc: RetrievedDocument,
  config: AcquisitionConfig = DEFAULT_ACQUISITION_CONFIG
): Promise<ExtractionResult> {
  const maxChars = config.maxExtractedCharsPerDocument;

  // Plain text / HTML
  if (doc.mimeType.includes('text/plain') || doc.mimeType.includes('text/html')) {
    let text = doc.content.toString('utf-8');
    if (doc.mimeType.includes('html')) {
      text = text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    const truncated = text.length > maxChars;
    return {
      text: text.slice(0, maxChars),
      charCount: Math.min(text.length, maxChars),
      method: doc.mimeType.includes('html') ? 'html_text' : 'plain_text',
      truncated,
    };
  }

  // PDF or octet-stream (SAM.gov often sends PDFs as octet-stream)
  if (doc.mimeType.includes('pdf') || doc.mimeType === 'application/octet-stream') {
    try {
      // Use pdfjs-dist directly (pdf-parse v2's PDFParse wrapper rejects valid PDFs)
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(doc.content) }).promise;

      let text = '';
      const maxPages = Math.min(pdfDoc.numPages, 20); // Cap at 20 pages
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(' ');
        text += pageText + '\n';
        if (text.length >= maxChars) break;
      }

      if (text.trim().length < 50) {
        return { text: '', charCount: 0, method: 'ocr_required', truncated: false };
      }

      // Canonicalize whitespace for deterministic hashing — collapse runs
      // of spaces/tabs to single space, normalize line endings, trim lines
      const canonicalText = text
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const truncated = canonicalText.length > maxChars;
      return {
        text: canonicalText.slice(0, maxChars),
        charCount: Math.min(canonicalText.length, maxChars),
        method: 'pdf_text',
        truncated,
      };
    } catch (pdfErr) {
      console.warn(
        `[DocAcq] PDF extraction failed for ${doc.name}:`,
        pdfErr instanceof Error ? pdfErr.message : pdfErr
      );
      if (doc.mimeType.includes('pdf')) {
        return { text: '', charCount: 0, method: 'ocr_required', truncated: false };
      }
    }
  }

  // DOCX (ZIP containing word/document.xml)
  if (
    doc.mimeType.includes('wordprocessingml') ||
    doc.mimeType.includes('msword') ||
    doc.mimeType === 'application/octet-stream'
  ) {
    // Check for ZIP magic bytes (PK)
    if (doc.content[0] === 0x50 && doc.content[1] === 0x4b) {
      try {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(doc.content);
        const docXml = zip.file('word/document.xml');
        if (docXml) {
          const xmlContent = await docXml.async('text');
          // Strip XML tags, normalize whitespace
          const text = xmlContent
            .replace(/<w:br[^/]*\/>/gi, '\n')
            .replace(/<\/w:p>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (text.length >= 50) {
            const truncated = text.length > maxChars;
            return {
              text: text.slice(0, maxChars),
              charCount: Math.min(text.length, maxChars),
              method: 'docx_text',
              truncated,
            };
          }
        }
      } catch {
        // Not a valid DOCX or extraction failed
      }
    }
  }

  return { text: '', charCount: 0, method: 'unsupported', truncated: false };
}

// ============================================================
// Opportunity Evidence
// ============================================================

export interface OpportunityEvidence {
  opportunityId: string;
  sources: Array<{
    documentName: string;
    documentUrl: string;
    contentHash: string;
    retrievedAt: string;
    extractionMethod: string;
    charCount: number;
  }>;
  extractedScopeText: string;
  extractionCharacterCount: number;
  contentHash: string;
  retrievedAt: string;
}

/**
 * Acquire and extract evidence for an opportunity.
 * Returns extracted scope text from prioritized attachments.
 * ZERO LLM calls. Bounded by configuration.
 */
export async function acquireOpportunityEvidence(
  opportunityId: string,
  attachments: Array<{ name: string; url?: string; type?: string }>,
  config: AcquisitionConfig = DEFAULT_ACQUISITION_CONFIG
): Promise<OpportunityEvidence> {
  const prioritized = prioritizeAttachments(attachments, config);
  const sources: OpportunityEvidence['sources'] = [];
  let combinedText = '';
  let totalBytes = 0;

  const startTime = Date.now();

  for (const attachment of prioritized) {
    // Check opportunity-level timeout
    if (Date.now() - startTime > config.opportunityTimeoutMs) break;
    // Check total bytes
    if (totalBytes >= config.maxTotalBytesPerOpportunity) break;

    const retrieval = await retrieveDocument(attachment, config);
    if (!retrieval.document) continue;

    totalBytes += retrieval.document.sizeBytes;
    const extraction = await extractText(retrieval.document, config);

    if (extraction.charCount > 0) {
      sources.push({
        documentName: retrieval.document.name,
        documentUrl: retrieval.document.url,
        contentHash: retrieval.document.contentHash,
        retrievedAt: retrieval.document.retrievedAt,
        extractionMethod: extraction.method,
        charCount: extraction.charCount,
      });

      combinedText += `\n--- ${retrieval.document.name} ---\n${extraction.text}\n`;
    }
  }

  const combinedHash = createHash('sha256').update(combinedText).digest('hex');

  return {
    opportunityId,
    sources,
    extractedScopeText: combinedText.trim(),
    extractionCharacterCount: combinedText.length,
    contentHash: combinedHash,
    retrievedAt: new Date().toISOString(),
  };
}
