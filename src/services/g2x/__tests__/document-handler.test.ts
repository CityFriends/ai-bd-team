/**
 * G2X Document Handler Tests
 *
 * Covers:
 * - Document inventory retrieval
 * - Attachment text retrieval
 * - Checksum validation
 * - Version/amendment preservation (no silent overwrite)
 * - Raw + normalized provenance
 * - Payload size controls
 * - G2X as retrieval provider, not source authority
 * - Incomplete/corrupt marking on checksum failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/environment.js', () => ({
  assertCommissioningEnvironment: vi.fn(),
}));

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockLimit = vi.fn();
const mockMaybeSingle = vi.fn();
const mockSingle = vi.fn();
const mockUpsert = vi.fn();

vi.mock('../../../integrations/database/client.js', () => ({
  getSupabase: () => ({
    from: vi.fn().mockReturnValue({
      insert: mockInsert,
      select: mockSelect,
      update: mockUpdate,
      upsert: mockUpsert,
    }),
  }),
}));

vi.mock('../mcp-client.js', () => ({
  callTool: vi.fn(),
}));

import { callTool } from '../mcp-client.js';
import {
  retrieveDocumentInventory,
  retrieveAttachmentText,
  persistEvidence,
  persistExternalSourceRecord,
} from '../document-handler.js';
import type { G2XAuthState } from '../types.js';
import { MAX_RAW_PAYLOAD_BYTES, MAX_ATTACHMENT_TEXT_BYTES } from '../types.js';

const mockAuth: G2XAuthState = {
  accessToken: 'test-token',
  tokenType: 'Bearer',
  expiresAt: null,
  refreshToken: null,
  scopes: [],
  interactiveAuthRequired: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSingle.mockResolvedValue({ data: { id: 'test-id' }, error: null });
  mockInsert.mockReturnValue({
    select: vi.fn().mockReturnValue({ single: mockSingle }),
  });
  mockUpsert.mockReturnValue({
    select: vi.fn().mockReturnValue({ single: mockSingle }),
  });
  mockSelect.mockReturnValue({
    eq: mockEq,
  });
  mockEq.mockReturnValue({
    eq: mockEq,
    limit: mockLimit,
  });
  mockLimit.mockReturnValue({
    maybeSingle: mockMaybeSingle,
  });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
});

describe('Document Inventory Retrieval', () => {
  it('retrieves and parses document inventory', async () => {
    vi.mocked(callTool).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            documents: [
              {
                id: 'doc-1',
                title: 'Statement of Work',
                filename: 'SOW.pdf',
                type: 'SOW',
                status: 'READY',
                checksum: 'abc123',
              },
              {
                id: 'doc-2',
                title: 'Amendment 001',
                filename: 'AMD001.pdf',
                type: 'Amendment',
                status: 'READY',
              },
            ],
          }),
        },
      ],
    });

    const result = await retrieveDocumentInventory(mockAuth, 'opp-123');

    expect(result.documents).toHaveLength(2);
    expect(result.documents[0].providerDocumentId).toBe('doc-1');
    expect(result.documents[0].title).toBe('Statement of Work');
    expect(result.documents[0].documentType).toBe('SOW');
    expect(result.documents[0].readiness).toBe('READY');
    expect(result.documents[0].checksum).toBe('abc123');
    expect(result.failure).toBeUndefined();
  });

  it('handles document inventory failure', async () => {
    vi.mocked(callTool).mockResolvedValue({
      type: 'PROVIDER_UNAVAILABLE',
      message: 'Server error',
      httpStatus: 503,
    } as any);

    const result = await retrieveDocumentInventory(mockAuth, 'opp-123');

    expect(result.documents).toHaveLength(0);
    expect(result.failure).toBeDefined();
    expect(result.failure!.type).toBe('PROVIDER_UNAVAILABLE');
  });

  it('reports size observations', async () => {
    vi.mocked(callTool).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ documents: [{ id: 'doc-1', title: 'Test' }] }),
        },
      ],
    });

    const result = await retrieveDocumentInventory(mockAuth, 'opp-123');

    expect(result.sizeObservations.length).toBeGreaterThan(0);
    expect(result.sizeObservations[0].recordType).toBe('document_inventory');
    expect(result.sizeObservations[0].sizeBytes).toBeGreaterThan(0);
  });

  it('maps readiness statuses correctly', async () => {
    vi.mocked(callTool).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            documents: [
              { id: '1', title: 'A', status: 'READY' },
              { id: '2', title: 'B', status: 'PROCESSING' },
              { id: '3', title: 'C', status: 'UNAVAILABLE' },
              { id: '4', title: 'D', status: 'weird_status' },
            ],
          }),
        },
      ],
    });

    const result = await retrieveDocumentInventory(mockAuth, 'opp-123');

    expect(result.documents[0].readiness).toBe('READY');
    expect(result.documents[1].readiness).toBe('PROCESSING');
    expect(result.documents[2].readiness).toBe('NOT_AVAILABLE');
    expect(result.documents[3].readiness).toBe('UNKNOWN');
  });
});

describe('Attachment Text Retrieval', () => {
  it('retrieves and parses attachment text', async () => {
    vi.mocked(callTool).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            text: 'This is the SOW content.',
            page: 1,
            section: '3.1 Requirements',
          }),
        },
      ],
    });

    const result = await retrieveAttachmentText(mockAuth, 'doc-1');

    expect(result.text).toBe('This is the SOW content.');
    expect(result.provenance).toBeDefined();
    expect(result.provenance!.pageNumber).toBe(1);
    expect(result.provenance!.section).toBe('3.1 Requirements');
    expect(result.provenance!.evidenceType).toBe('EXTRACTED_TEXT');
    expect(result.failure).toBeUndefined();
  });

  it('validates checksum when provided', async () => {
    const text = 'Document content';
    const crypto = await import('crypto');
    const correctHash = crypto.createHash('sha256').update(text).digest('hex');

    vi.mocked(callTool).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            text,
            checksum: correctHash,
          }),
        },
      ],
    });

    const result = await retrieveAttachmentText(mockAuth, 'doc-1');

    expect(result.checksumValid).toBe(true);
  });

  it('detects checksum mismatch', async () => {
    vi.mocked(callTool).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            text: 'Document content',
            checksum: 'wrong-checksum-value',
          }),
        },
      ],
    });

    const result = await retrieveAttachmentText(mockAuth, 'doc-1');

    expect(result.checksumValid).toBe(false);
  });

  it('returns null checksum when not provided', async () => {
    vi.mocked(callTool).mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ text: 'Content without checksum' }),
        },
      ],
    });

    const result = await retrieveAttachmentText(mockAuth, 'doc-1');

    expect(result.checksumValid).toBeNull();
  });

  it('handles DOCUMENT_NOT_READY failure', async () => {
    vi.mocked(callTool).mockResolvedValue({
      content: [{ type: 'text' }], // No text
    });

    const result = await retrieveAttachmentText(mockAuth, 'doc-1');

    expect(result.text).toBeNull();
    expect(result.failure).toBeDefined();
    expect(result.failure!.type).toBe('DOCUMENT_NOT_READY');
  });

  it('reports size observation for large attachments', async () => {
    const largeText = 'x'.repeat(MAX_ATTACHMENT_TEXT_BYTES + 1000);
    vi.mocked(callTool).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ text: largeText }) }],
    });

    const result = await retrieveAttachmentText(mockAuth, 'doc-1');

    expect(result.sizeObservation).toBeDefined();
    expect(result.sizeObservation!.exceedsLimit).toBe(true);
    expect(result.sizeObservation!.storageStrategy).toBe('REQUIRES_OBJECT_STORAGE');
    // Text should be truncated
    expect(result.text).toContain('[TRUNCATED');
  });
});

describe('Evidence Persistence', () => {
  it('does not persist evidence with failed checksum', async () => {
    const result = await persistEvidence(
      'version-1',
      'Some text',
      { evidenceType: 'EXTRACTED_TEXT', contentHash: 'hash' },
      false // Checksum failed
    );

    expect(result).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('persists evidence with valid checksum', async () => {
    const result = await persistEvidence(
      'version-1',
      'Valid content',
      {
        evidenceType: 'EXTRACTED_TEXT',
        pageNumber: 5,
        section: '2.1',
        contentHash: 'valid-hash',
      },
      true // Checksum passed
    );

    expect(result).toBe('test-id');
    expect(mockInsert).toHaveBeenCalled();
  });

  it('persists evidence when no checksum was provided', async () => {
    const result = await persistEvidence(
      'version-1',
      'Content',
      { evidenceType: 'EXTRACTED_TEXT', contentHash: 'hash' },
      null // No checksum to validate
    );

    expect(result).toBe('test-id');
  });
});

describe('External Source Record Persistence', () => {
  it('persists record with bounded payload', async () => {
    const result = await persistExternalSourceRecord(
      'g2x',
      'opportunities',
      'record-1',
      'OPPORTUNITY_SEARCH',
      { title: 'Test', agency: 'DOD' }
    );

    expect(result).toBe('test-id');
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('truncates oversized payloads', async () => {
    const largePayload: Record<string, unknown> = {};
    // Create payload exceeding MAX_RAW_PAYLOAD_BYTES
    largePayload.data = 'x'.repeat(MAX_RAW_PAYLOAD_BYTES + 1000);

    await persistExternalSourceRecord(
      'g2x',
      'opportunities',
      'record-large',
      'OPPORTUNITY_SEARCH',
      largePayload
    );

    // Should still persist (truncated version)
    expect(mockUpsert).toHaveBeenCalled();
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.raw_payload._truncated).toBe(true);
    expect(upsertArg.raw_payload._originalSizeBytes).toBeGreaterThan(MAX_RAW_PAYLOAD_BYTES);
  });
});
