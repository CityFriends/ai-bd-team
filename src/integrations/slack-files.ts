// Slack File Handling - Download and parse files shared in channels
// Requires files:read OAuth scope on each Slack app

import { WebClient } from '@slack/web-api';

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  filetype: string;
  size: number;
  url_private: string;
  url_private_download?: string;
}

export interface ParsedFileContent {
  filename: string;
  filetype: string;
  content: string;
  truncated: boolean;
  error?: string;
}

// Maximum content size to include (to avoid token limits)
const MAX_CONTENT_LENGTH = 50000; // ~50k chars, roughly 12k tokens

// Supported file types
const SUPPORTED_TEXT_TYPES = [
  'text', 'txt', 'md', 'markdown', 'csv', 'json', 'xml', 'html', 'htm',
  'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'css', 'scss', 'yaml', 'yml',
  'sh', 'bash', 'sql', 'log', 'ini', 'conf', 'cfg', 'env', 'gitignore'
];

const SUPPORTED_DOC_TYPES = ['pdf', 'doc', 'docx', 'rtf'];

/**
 * Download and parse files from a Slack message
 */
export async function parseSlackFiles(
  client: WebClient,
  files: SlackFile[],
  botToken: string
): Promise<ParsedFileContent[]> {
  const results: ParsedFileContent[] = [];

  for (const file of files) {
    try {
      console.log(`Parsing file: ${file.name} (${file.filetype}, ${formatBytes(file.size)})`);

      // Check file size - skip very large files
      if (file.size > 10 * 1024 * 1024) { // 10MB limit
        results.push({
          filename: file.name,
          filetype: file.filetype,
          content: '',
          truncated: false,
          error: `File too large (${formatBytes(file.size)}). Maximum is 10MB.`
        });
        continue;
      }

      const content = await downloadAndParseFile(file, botToken);
      results.push(content);

    } catch (error) {
      console.error(`Error parsing file ${file.name}:`, error);
      results.push({
        filename: file.name,
        filetype: file.filetype,
        content: '',
        truncated: false,
        error: `Failed to parse: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }
  }

  return results;
}

/**
 * Download file content and parse based on type
 */
async function downloadAndParseFile(
  file: SlackFile,
  botToken: string
): Promise<ParsedFileContent> {
  const downloadUrl = file.url_private_download || file.url_private;

  // Download the file
  const response = await fetch(downloadUrl, {
    headers: {
      'Authorization': `Bearer ${botToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const filetype = file.filetype.toLowerCase();

  // Handle text-based files
  if (SUPPORTED_TEXT_TYPES.includes(filetype) || file.mimetype.startsWith('text/')) {
    const text = await response.text();
    const truncated = text.length > MAX_CONTENT_LENGTH;
    return {
      filename: file.name,
      filetype: file.filetype,
      content: truncated ? text.substring(0, MAX_CONTENT_LENGTH) + '\n\n[... content truncated ...]' : text,
      truncated,
    };
  }

  // Handle PDF files
  if (filetype === 'pdf' || file.mimetype === 'application/pdf') {
    const buffer = await response.arrayBuffer();
    const text = await extractTextFromPDF(Buffer.from(buffer));
    const truncated = text.length > MAX_CONTENT_LENGTH;
    return {
      filename: file.name,
      filetype: 'pdf',
      content: truncated ? text.substring(0, MAX_CONTENT_LENGTH) + '\n\n[... content truncated ...]' : text,
      truncated,
    };
  }

  // Handle Word documents
  if (filetype === 'docx' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const buffer = await response.arrayBuffer();
    const text = await extractTextFromDocx(Buffer.from(buffer));
    const truncated = text.length > MAX_CONTENT_LENGTH;
    return {
      filename: file.name,
      filetype: 'docx',
      content: truncated ? text.substring(0, MAX_CONTENT_LENGTH) + '\n\n[... content truncated ...]' : text,
      truncated,
    };
  }

  // Unsupported file type
  return {
    filename: file.name,
    filetype: file.filetype,
    content: '',
    truncated: false,
    error: `Unsupported file type: ${file.filetype}. Supported: text files, PDF, Word documents.`
  };
}

/**
 * Extract text from PDF using basic parsing
 * Note: For better PDF parsing, consider adding pdf-parse package
 */
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Try to dynamically import pdf-parse if available
    // @ts-ignore - dynamic import may not be available
    const pdfParse = await import('pdf-parse').then((m: any) => m.default).catch(() => null);

    if (pdfParse) {
      const data = await pdfParse(buffer);
      return data.text || '[PDF parsed but no text content found]';
    }

    // Fallback: basic text extraction from PDF
    const content = buffer.toString('utf-8');

    // Extract text between stream markers (basic approach)
    const textMatches: string[] = [];
    const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g;
    let match;

    while ((match = streamRegex.exec(content)) !== null) {
      // Try to decode basic text
      const decoded = match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
        .trim();

      if (decoded.length > 20) {
        textMatches.push(decoded);
      }
    }

    if (textMatches.length > 0) {
      return textMatches.join('\n\n');
    }

    return '[PDF content could not be extracted. For better PDF support, install pdf-parse package.]';
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '[Error extracting PDF content]';
  }
}

/**
 * Extract text from Word documents (.docx)
 * Note: For better Word parsing, consider adding mammoth package
 */
async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  try {
    // Try to dynamically import mammoth if available
    // @ts-ignore - dynamic import may not be available
    const mammoth = await import('mammoth').then((m: any) => m.default || m).catch(() => null);

    if (mammoth) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || '[Document parsed but no text content found]';
    }

    // Fallback: basic extraction from docx (which is a zip file)
    // docx files are ZIP archives containing XML
    // @ts-ignore - dynamic import may not be available
    const JSZip = await import('jszip').then((m: any) => m.default || m).catch(() => null);

    if (JSZip) {
      const zip = await JSZip.loadAsync(buffer);
      const documentXml = await zip.file('word/document.xml')?.async('string');

      if (documentXml) {
        // Strip XML tags and get text content
        const text = documentXml
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return text || '[Document parsed but no text content found]';
      }
    }

    return '[Word document content could not be extracted. For better support, install mammoth package.]';
  } catch (error) {
    console.error('Word extraction error:', error);
    return '[Error extracting Word document content]';
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format file contents for inclusion in agent context
 */
export function formatFilesForContext(files: ParsedFileContent[]): string {
  if (files.length === 0) return '';

  const parts: string[] = ['\n📎 ATTACHED FILES:'];

  for (const file of files) {
    parts.push(`\n--- ${file.filename} (${file.filetype}) ---`);

    if (file.error) {
      parts.push(`[Error: ${file.error}]`);
    } else if (file.content) {
      parts.push(file.content);
      if (file.truncated) {
        parts.push(`\n[Note: File was truncated due to size]`);
      }
    } else {
      parts.push('[No content extracted]');
    }

    parts.push('--- end file ---\n');
  }

  return parts.join('\n');
}
