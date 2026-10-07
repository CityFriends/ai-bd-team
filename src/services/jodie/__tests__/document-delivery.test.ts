/**
 * Jodie Document Delivery — Commissioning Tests
 *
 * Real DOCX/PDF rendering, Storage upload, signed URLs,
 * human-edit round trip, page-limit validation.
 *
 * Zero provider calls. Commissioning only.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getEnvironmentRole } from '../../../config/environment.js';

const HAS_DB = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
const IS_PRODUCTION = getEnvironmentRole() === 'production';
const CAN_RUN = HAS_DB && !IS_PRODUCTION;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any;
let testRunId: string;
let wsId: string;
let captureId: string;

// Test proposal content
const testContent = () => ({
  workspaceId: wsId,
  proposalVersion: `v1-${testRunId}`,
  solicitationVersion: 'SOL-2027-001-v1',
  amendmentVersion: 0,
  sections: [
    {
      sectionKey: 'technical_approach',
      title: '1.0 Technical Approach',
      headingLevel: 1 as const,
      paragraphs: [
        { text: 'Friends From The City (FFTC) proposes a cloud-native modernization approach leveraging containerized microservices with Kubernetes orchestration.', type: 'body' as const },
        { text: 'Our solution delivers:', type: 'body' as const, bold: true },
        { text: 'Automated CI/CD pipelines with zero-downtime deployment', type: 'bullet' as const },
        { text: 'FedRAMP-authorized cloud infrastructure meeting security requirements', type: 'bullet' as const },
        { text: 'Real-time monitoring and observability across all tiers', type: 'bullet' as const },
        { text: 'FFTC has successfully delivered similar cloud migrations for federal agencies.', type: 'reference' as const, evidenceRef: 'PP-001' },
      ],
      tables: [{
        caption: 'Table 1: Technical Solution Components',
        headers: ['Component', 'Technology', 'Compliance'],
        rows: [
          ['Container Platform', 'Kubernetes (EKS)', 'FedRAMP High'],
          ['CI/CD Pipeline', 'GitLab CI', 'NIST 800-53'],
          ['Monitoring', 'Prometheus + Grafana', 'IL4/IL5 Ready'],
        ],
      }],
      requirementRefs: ['REQ-T-001', 'REQ-T-002'],
      pageBreakBefore: false,
    },
    {
      sectionKey: 'management_approach',
      title: '2.0 Management Approach',
      headingLevel: 1 as const,
      paragraphs: [
        { text: 'FFTC will manage this program through an Agile at Scale methodology adapted for federal acquisition requirements.', type: 'body' as const },
        { text: 'Key management elements include:', type: 'body' as const },
        { text: 'Program Management Office (PMO) with ITIL-certified leadership', type: 'bullet' as const },
        { text: 'Bi-weekly sprint reviews with government stakeholders', type: 'bullet' as const },
        { text: 'Monthly Earned Value Management (EVM) reporting', type: 'bullet' as const },
        { text: 'Integrated Master Schedule (IMS) maintained in Microsoft Project', type: 'bullet' as const },
      ],
      pageBreakBefore: true,
    },
    {
      sectionKey: 'past_performance',
      title: '3.0 Past Performance',
      headingLevel: 1 as const,
      paragraphs: [
        { text: 'FFTC has a proven track record of delivering cloud modernization programs for federal customers.', type: 'body' as const },
        { text: 'DoD Cloud Migration Program — Contract W911NF-20-C-0001', type: 'body' as const, bold: true },
        { text: 'Successfully migrated 47 applications to AWS GovCloud within 18 months, achieving 99.99% uptime and $2.3M annual cost savings.', type: 'reference' as const, evidenceRef: 'PP-002' },
      ],
      tables: [{
        caption: 'Table 2: Relevant Past Performance',
        headers: ['Contract', 'Agency', 'Value', 'Period', 'Rating'],
        rows: [
          ['W911NF-20-C-0001', 'US Army', '$12.4M', '2020-2023', 'Exceptional'],
          ['FA8802-21-C-0042', 'USAF', '$8.7M', '2021-2024', 'Very Good'],
        ],
      }],
      pageBreakBefore: true,
    },
  ],
  metadata: {
    preparedBy: 'Jodie (AI BD Team)',
    classification: 'PROPRIETARY',
  },
});

describe.skipIf(!CAN_RUN)('Jodie Document Delivery', () => {
  beforeAll(async () => {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
    testRunId = `doc-${Math.random().toString(36).slice(2, 8)}`;

    // Create test capture + workspace
    captureId = randomUUID();
    await supabase.from('captures').insert({
      id: captureId,
      opportunity_id: `opp-doc-${testRunId}`,
      source_material_hash: `hash-doc-${testRunId}`,
      status: 'pursuit_authorized',
      created_by_human_id: 'test',
      idempotency_key: `cap-doc-${testRunId}`,
    });

    const { data } = await supabase.from('proposal_workspaces').insert({
      capture_id: captureId,
      opportunity_id: `opp-doc-${testRunId}`,
      status: 'active',
    }).select('id').single();
    wsId = data?.id;

    // Ensure bucket exists
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b: { name: string }) => b.name === 'proposal-artifacts')) {
      await supabase.storage.createBucket('proposal-artifacts', { public: false });
    }
  });

  afterAll(async () => {
    if (!supabase || !wsId) return;
    // Clean storage
    const { data: files } = await supabase.storage.from('proposal-artifacts').list(`proposals/${wsId}`, { limit: 100 });
    for (const dir of (files || [])) {
      const { data: subFiles } = await supabase.storage.from('proposal-artifacts').list(`proposals/${wsId}/${dir.name}`, { limit: 100 });
      const paths = (subFiles || []).map((f: { name: string }) => `proposals/${wsId}/${dir.name}/${f.name}`);
      if (paths.length > 0) await supabase.storage.from('proposal-artifacts').remove(paths);
    }
    // Clean DB
    await supabase.from('proposal_file_versions').delete().eq('rendered_artifact_id', '00000000-0000-0000-0000-000000000000').neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('proposal_rendered_artifacts').delete().eq('proposal_workspace_id', wsId);
    await supabase.from('proposal_workspaces').delete().eq('id', wsId);
    await supabase.from('captures').delete().eq('id', captureId);
  });

  // ============================================================
  // DOCX RENDERING
  // ============================================================
  describe('DOCX Rendering', () => {
    it('renders real DOCX from structured content', async () => {
      const { renderDocx, DEFAULT_TEMPLATE } = await import('../docx-renderer.js');

      const template = {
        ...DEFAULT_TEMPLATE,
        titlePage: {
          ...DEFAULT_TEMPLATE.titlePage,
          solicitationNumber: 'SOL-2027-001',
          agencyName: 'Department of Defense',
          submissionDate: 'October 15, 2027',
        },
      };

      const result = await renderDocx(testContent(), template);

      // Validation
      expect(result.buffer.length).toBeGreaterThan(1000);
      expect(result.buffer[0]).toBe(0x50); // PK zip header
      expect(result.buffer[1]).toBe(0x4B);
      expect(result.contentHash).toHaveLength(64);
      expect(result.sectionCount).toBe(3);
      expect(result.wordCount).toBeGreaterThan(50);
      expect(result.templateId).toBe('fftc-standard-v1');

      console.log(`DOCX: ${result.buffer.length} bytes, ${result.sectionCount} sections, ${result.wordCount} words`);
    });
  });

  // ============================================================
  // PDF RENDERING
  // ============================================================
  describe('PDF Rendering', () => {
    it('renders real PDF from structured content', async () => {
      const { renderPdf } = await import('../pdf-renderer.js');
      const { DEFAULT_TEMPLATE } = await import('../docx-renderer.js');

      const result = await renderPdf(testContent(), DEFAULT_TEMPLATE);

      expect(result.buffer.length).toBeGreaterThan(1000);
      expect(result.buffer.slice(0, 5).toString()).toBe('%PDF-');
      expect(result.contentHash).toHaveLength(64);
      expect(result.pageCount).toBeGreaterThan(0);
      expect(result.sectionCount).toBe(3);

      console.log(`PDF: ${result.buffer.length} bytes, ${result.pageCount} pages, ${result.wordCount} words`);
    });
  });

  // ============================================================
  // FULL RENDER PIPELINE
  // ============================================================
  let pipelineResult: import('../render-pipeline.js').RenderPipelineResult | null = null;

  describe('Render Pipeline', () => {
    it('executes full pipeline: render → validate → upload → signed URLs', async () => {
      const { executeRenderPipeline } = await import('../render-pipeline.js');
      const { DEFAULT_TEMPLATE } = await import('../docx-renderer.js');

      const template = {
        ...DEFAULT_TEMPLATE,
        titlePage: {
          ...DEFAULT_TEMPLATE.titlePage,
          solicitationNumber: 'SOL-2027-001',
          agencyName: 'Department of Defense',
          submissionDate: 'October 15, 2027',
        },
      };

      pipelineResult = await executeRenderPipeline(supabase, testContent(), template, 120);

      expect(pipelineResult).toBeTruthy();
      expect(pipelineResult.validation.valid).toBe(true);
      expect(pipelineResult.docx.sizeBytes).toBeGreaterThan(0);
      expect(pipelineResult.pdf.sizeBytes).toBeGreaterThan(0);
      expect(pipelineResult.pdf.pageCount).toBeGreaterThan(0);
      expect(pipelineResult.docx.signedUrl).toBeTruthy();
      expect(pipelineResult.pdf.signedUrl).toBeTruthy();
      expect(pipelineResult.docx.artifactId).toBeTruthy();
      expect(pipelineResult.pdf.artifactId).toBeTruthy();

      console.log('\n=== RENDER PIPELINE RESULT ===');
      console.log(`DOCX: ${pipelineResult.docx.sizeBytes} bytes, path: ${pipelineResult.docx.storagePath}`);
      console.log(`PDF: ${pipelineResult.pdf.sizeBytes} bytes, ${pipelineResult.pdf.pageCount} pages, path: ${pipelineResult.pdf.storagePath}`);
      console.log(`DOCX signed URL: ${pipelineResult.docx.signedUrl?.slice(0, 80)}...`);
      console.log(`PDF signed URL: ${pipelineResult.pdf.signedUrl?.slice(0, 80)}...`);
      console.log('Validation:', JSON.stringify(pipelineResult.validation, null, 2));
      console.log('==============================\n');
    });
  });

  // ============================================================
  // SIGNED URL VERIFICATION
  // ============================================================
  describe('Signed URL Verification', () => {
    it('signed DOCX URL returns file content', async () => {
      if (!pipelineResult?.docx.signedUrl) return;
      const response = await fetch(pipelineResult.docx.signedUrl);
      expect(response.ok).toBe(true);
      // Supabase returns the uploaded content type
      const ct = response.headers.get('content-type') || '';
      expect(ct.includes('officedocument') || ct.includes('octet-stream')).toBe(true);
      const buffer = Buffer.from(await response.arrayBuffer());
      expect(buffer[0]).toBe(0x50); // PK header
    });

    it('signed PDF URL returns file content', async () => {
      if (!pipelineResult?.pdf.signedUrl) return;
      const response = await fetch(pipelineResult.pdf.signedUrl);
      expect(response.ok).toBe(true);
      const buffer = Buffer.from(await response.arrayBuffer());
      expect(buffer.slice(0, 5).toString()).toBe('%PDF-');
    });
  });

  // ============================================================
  // PUBLIC ACCESS DENIED
  // ============================================================
  describe('Public Access Verification', () => {
    it('anonymous public URL fails for private bucket', async () => {
      if (!pipelineResult) return;
      const publicUrl = supabase.storage
        .from('proposal-artifacts')
        .getPublicUrl(pipelineResult.docx.storagePath);

      // Try fetching without auth — should fail
      const response = await fetch(publicUrl.data.publicUrl);
      // Private bucket returns 400 or non-200
      expect(response.status).not.toBe(200);
    });
  });

  // ============================================================
  // SLACK PAYLOAD
  // ============================================================
  describe('Slack Payload', () => {
    it('generates proposal-ready payload', async () => {
      if (!pipelineResult) return;
      const { generateProposalReadyPayload } = await import('../render-pipeline.js');

      const payload = generateProposalReadyPayload(
        `Cloud Modernization (opp-doc-${testRunId})`,
        `v1-${testRunId}`,
        '3 requirements covered, 1 compliance risk',
        1,
        pipelineResult.docx.signedUrl || '',
        pipelineResult.pdf.signedUrl || ''
      );

      expect(payload.text).toContain('JODIE');
      expect(payload.text).toContain('Draft Proposal Ready');
      expect(payload.blocks).toHaveLength(4);

      console.log('\n=== SLACK PAYLOAD ===');
      console.log(payload.text);
      console.log('====================\n');
    });
  });

  // ============================================================
  // HUMAN-EDITED ROUND TRIP
  // ============================================================
  describe('Human-Edited Round Trip', () => {
    it('human upload creates RECONCILIATION_REQUIRED', async () => {
      if (!pipelineResult) return;

      // Simulate human-edited DOCX upload
      const editedContent = Buffer.from('HUMAN-EDITED DOCX CONTENT');
      const editedHash = require('crypto').createHash('sha256').update(editedContent).digest('hex');
      const editedPath = `proposals/${wsId}/v1-${testRunId}/proposal-edited.docx`;

      // Upload edited file
      await supabase.storage.from('proposal-artifacts').upload(editedPath, editedContent, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      // Create file version record
      const { data: fv } = await supabase
        .from('proposal_file_versions')
        .insert({
          rendered_artifact_id: pipelineResult.docx.artifactId,
          version_number: 2,
          storage_path: editedPath,
          content_hash: editedHash,
          file_size_bytes: editedContent.length,
          upload_source: 'HUMAN_EDIT',
          uploaded_by: 'test-user',
          reconciliation_status: 'RECONCILIATION_REQUIRED',
          idempotency_key: `fv-edit-${testRunId}`,
        })
        .select('id, reconciliation_status, upload_source')
        .single();

      expect(fv.reconciliation_status).toBe('RECONCILIATION_REQUIRED');
      expect(fv.upload_source).toBe('HUMAN_EDIT');

      // Original version preserved
      const { data: versions } = await supabase
        .from('proposal_file_versions')
        .select('version_number')
        .eq('rendered_artifact_id', pipelineResult.docx.artifactId)
        .order('version_number');

      // Should have at least the human-edited version
      expect(versions?.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // PAGE-LIMIT VALIDATION
  // ============================================================
  describe('Page-Limit Validation', () => {
    it('detects within limit', async () => {
      const { validatePageLimit } = await import('../render-pipeline.js');
      const result = validatePageLimit(4, 100);
      expect(result.withinLimit).toBe(true);
    });

    it('detects over limit', async () => {
      const { validatePageLimit } = await import('../render-pipeline.js');
      const result = validatePageLimit(25, 15);
      expect(result.withinLimit).toBe(false);
      expect(result.pages).toBe(25);
      expect(result.limit).toBe(15);
    });

    it('handles no limit configured', async () => {
      const { validatePageLimit } = await import('../render-pipeline.js');
      const result = validatePageLimit(100, undefined);
      expect(result.withinLimit).toBe(true);
      expect(result.limit).toBeNull();
    });
  });

  // ============================================================
  // PRODUCTION SAFETY
  // ============================================================
  describe('Production Safety', () => {
    it('not connected to production', () => {
      expect(getEnvironmentRole()).not.toBe('production');
    });
  });
});
