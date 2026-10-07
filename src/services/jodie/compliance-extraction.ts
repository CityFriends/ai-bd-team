/**
 * Jodie Chunked Compliance Extraction Pipeline
 *
 * Large solicitations → deterministic source units → bounded per-chunk
 * extraction → strict validation → deterministic merge/dedupe →
 * completeness reconciliation → authoritative compliance candidates.
 *
 * No partial extraction may masquerade as complete compliance analysis.
 *
 * Zero direct provider calls — all inference via Gateway.
 */

import { randomUUID } from 'crypto';
import * as crypto from 'crypto';
import { executeComplianceAnalysis } from './reasoning.js';
import type { ComplianceExtractionResult, ComplianceExtractionMeta } from './reasoning.js';
import type { SupabaseClient } from './types.js';

// ============================================================
// CONSTANTS
// ============================================================

/** Max package-level compliance extraction budget */
export const COMPLIANCE_PACKAGE_BUDGET_USD = 0.20;

/** Max parallel chunk extractions */
export const MAX_CONCURRENCY = 2;

/** Max retries per failed chunk */
export const MAX_CHUNK_RETRIES = 1;

// ============================================================
// SOURCE UNIT MODEL
// ============================================================

export interface SourceUnit {
  chunkId: string;
  sourceDocumentId: string;
  sourceDocumentVersion: string;
  documentType: string;
  pageRange?: string;
  sectionRef: string;
  sequenceNumber: number;
  contentHash: string;
  text: string;
}

/**
 * Create deterministic source units from solicitation text.
 * Prefers semantic/document boundaries (sections, clauses).
 * Falls back to token splitting for oversized units.
 */
export function createSourceUnits(
  documentId: string,
  documentVersion: string,
  documentType: string,
  fullText: string,
  maxChunkTokens: number = 3000
): SourceUnit[] {
  const units: SourceUnit[] = [];

  // Split on common solicitation section patterns
  const sectionPattern = /(?=(?:^|\n)(?:SECTION\s+[A-Z]|[A-Z]\.\d+|PART\s+\d+|ARTICLE\s+\d+|CLAUSE\s+|(?:L|M|C|H|K|J)\.\d+)\s)/i;
  const rawSections = fullText.split(sectionPattern).filter(s => s.trim().length > 0);

  let seq = 0;
  for (const section of rawSections) {
    const trimmed = section.trim();
    if (trimmed.length === 0) continue;

    // Extract section reference from first line
    const firstLine = trimmed.split('\n')[0].trim();
    const sectionRef = firstLine.slice(0, 80);

    // Estimate tokens (rough: 4 chars per token)
    const estTokens = Math.ceil(trimmed.length / 4);

    if (estTokens <= maxChunkTokens) {
      units.push({
        chunkId: randomUUID(),
        sourceDocumentId: documentId,
        sourceDocumentVersion: documentVersion,
        documentType,
        sectionRef,
        sequenceNumber: seq++,
        contentHash: crypto.createHash('sha256').update(trimmed).digest('hex'),
        text: trimmed,
      });
    } else {
      // Token split for oversized sections
      const subChunks = splitByTokenLimit(trimmed, maxChunkTokens);
      for (let i = 0; i < subChunks.length; i++) {
        units.push({
          chunkId: randomUUID(),
          sourceDocumentId: documentId,
          sourceDocumentVersion: documentVersion,
          documentType,
          sectionRef: `${sectionRef} (part ${i + 1}/${subChunks.length})`,
          sequenceNumber: seq++,
          contentHash: crypto.createHash('sha256').update(subChunks[i]).digest('hex'),
          text: subChunks[i],
        });
      }
    }
  }

  return units;
}

function splitByTokenLimit(text: string, maxTokens: number): string[] {
  const maxChars = maxTokens * 4;
  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ============================================================
// EXTRACTION MANIFEST
// ============================================================

export interface ExtractionManifest {
  runId: string;
  workspaceId: string;
  solicitationVersion: string;
  amendmentVersion: number;
  expectedChunkCount: number;
  completedChunkCount: number;
  failedChunkCount: number;
  skippedChunkCount: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'INCOMPLETE' | 'FAILED';
  failureReason?: string;
  chunks: ChunkStatus[];
  createdAt: string;
  completedAt?: string;
}

export interface ChunkStatus {
  chunkId: string;
  contentHash: string;
  sectionRef: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  requirementsExtracted: number;
  retryCount: number;
  costUsd: number;
  ledgerId?: string;
  error?: string;
  reusedFromVersion?: string;
}

// ============================================================
// CHUNK RESULT
// ============================================================

interface ChunkExtractionResult {
  chunkId: string;
  requirements: ComplianceExtractionResult['requirements'];
  meta: ComplianceExtractionMeta;
  costUsd: number;
  ledgerId?: string;
}

// ============================================================
// REQUIREMENT CANDIDATE (post-merge)
// ============================================================

export interface RequirementCandidate {
  requirementText: string;
  requirementType: string;
  mandatory: boolean;
  sourceLocations: Array<{
    chunkId: string;
    sectionRef: string;
    sourceDocumentId: string;
    sourceDocumentVersion: string;
  }>;
  responseExpectation?: string;
  evidenceNeed?: string;
  ambiguous: boolean;
  interpretationRequired: boolean;
}

// ============================================================
// MERGED RESULT
// ============================================================

export interface MergedComplianceResult {
  manifest: ExtractionManifest;
  candidates: RequirementCandidate[];
  contradictions: Array<{
    description: string;
    sourceA: { chunkId: string; sectionRef: string; text: string };
    sourceB: { chunkId: string; sectionRef: string; text: string };
  }>;
  totalCostUsd: number;
  totalProviderCalls: number;
}

// ============================================================
// MAIN PIPELINE
// ============================================================

/**
 * Run the full chunked compliance extraction pipeline.
 *
 * solicitation → source units → manifest → bounded extraction
 * → validation → merge/dedupe → completeness → promote or INCOMPLETE
 */
export async function runChunkedComplianceExtraction(
  supabase: SupabaseClient,
  workspaceId: string,
  solicitationVersion: string,
  amendmentVersion: number,
  sourceUnits: SourceUnit[],
  options?: {
    maxConcurrency?: number;
    maxPackageBudgetUsd?: number;
    previousRunChunks?: Map<string, ChunkExtractionResult>; // for amendment reuse
  }
): Promise<MergedComplianceResult> {
  const runId = randomUUID();
  const maxConcurrency = options?.maxConcurrency || MAX_CONCURRENCY;
  const maxBudget = options?.maxPackageBudgetUsd || COMPLIANCE_PACKAGE_BUDGET_USD;
  const previousChunks = options?.previousRunChunks || new Map();

  // Create manifest
  const manifest: ExtractionManifest = {
    runId,
    workspaceId,
    solicitationVersion,
    amendmentVersion,
    expectedChunkCount: sourceUnits.length,
    completedChunkCount: 0,
    failedChunkCount: 0,
    skippedChunkCount: 0,
    status: 'RUNNING',
    chunks: sourceUnits.map(u => ({
      chunkId: u.chunkId,
      contentHash: u.contentHash,
      sectionRef: u.sectionRef,
      status: 'PENDING' as const,
      requirementsExtracted: 0,
      retryCount: 0,
      costUsd: 0,
    })),
    createdAt: new Date().toISOString(),
  };

  let totalCost = 0;
  let totalCalls = 0;
  const allChunkResults: ChunkExtractionResult[] = [];

  // Process chunks with bounded concurrency
  const pending = [...sourceUnits];
  const active: Promise<void>[] = [];

  async function processChunk(unit: SourceUnit): Promise<void> {
    const chunkStatus = manifest.chunks.find(c => c.chunkId === unit.chunkId)!;

    // Amendment reuse: if content hash matches previous extraction, reuse
    const previousResult = previousChunks.get(unit.contentHash);
    if (previousResult) {
      chunkStatus.status = 'COMPLETED';
      chunkStatus.requirementsExtracted = previousResult.requirements.length;
      chunkStatus.reusedFromVersion = previousResult.meta.sourceDocumentVersion;
      manifest.completedChunkCount++;
      manifest.skippedChunkCount++;
      allChunkResults.push(previousResult);
      return;
    }

    // Budget check before starting
    const estCostPerChunk = 0.005; // ~$0.005 per Haiku chunk
    if (totalCost + estCostPerChunk > maxBudget) {
      chunkStatus.status = 'FAILED';
      chunkStatus.error = 'BUDGET_EXHAUSTED';
      manifest.failedChunkCount++;
      manifest.status = 'INCOMPLETE';
      manifest.failureReason = 'BUDGET_EXHAUSTED';
      return;
    }

    // Extract with retry
    let attempt = 0;
    while (attempt <= MAX_CHUNK_RETRIES) {
      const idempotencyKey = `chunk-${runId}-${unit.chunkId}-attempt${attempt}`;

      const result = await executeComplianceAnalysis(
        supabase, workspaceId,
        [{ chunkId: unit.chunkId, text: unit.text, sectionRef: unit.sectionRef }],
        solicitationVersion, idempotencyKey
      );

      if (result && result.meta.completionStatus === 'COMPLETE') {
        chunkStatus.status = 'COMPLETED';
        chunkStatus.requirementsExtracted = result.result.requirements.length;
        chunkStatus.costUsd = result.costUsd;
        chunkStatus.ledgerId = result.ledgerId;
        totalCost += result.costUsd;
        totalCalls++;
        manifest.completedChunkCount++;

        allChunkResults.push({
          chunkId: unit.chunkId,
          requirements: result.result.requirements,
          meta: result.meta,
          costUsd: result.costUsd,
          ledgerId: result.ledgerId,
        });
        return;
      }

      // Failed or null (idempotent replay returns null, retry with new key)
      attempt++;
      chunkStatus.retryCount = attempt;
      if (result) {
        chunkStatus.error = `Extraction ${result.meta.completionStatus}: ${result.meta.validationStatus}`;
      }
    }

    // All retries exhausted
    chunkStatus.status = 'FAILED';
    chunkStatus.error = chunkStatus.error || 'Max retries exhausted';
    manifest.failedChunkCount++;
  }

  // Bounded parallel execution
  for (const unit of pending) {
    if (manifest.status === 'INCOMPLETE') break; // Budget exhausted

    const task = processChunk(unit);
    active.push(task);

    if (active.length >= maxConcurrency) {
      await Promise.race(active);
      // Remove completed tasks
      const remaining: Promise<void>[] = [];
      for (const t of active) {
        // Check if resolved by racing
        const resolved = await Promise.race([t.then(() => true), Promise.resolve(false)]);
        if (!resolved) remaining.push(t);
      }
      active.length = 0;
      active.push(...remaining);
    }
  }

  // Wait for remaining
  await Promise.allSettled(active);

  // Determine final status
  if (manifest.failedChunkCount > 0) {
    manifest.status = manifest.failureReason === 'BUDGET_EXHAUSTED' ? 'INCOMPLETE' : 'INCOMPLETE';
    manifest.failureReason = manifest.failureReason || `${manifest.failedChunkCount} chunk(s) failed`;
  } else if (manifest.completedChunkCount === manifest.expectedChunkCount) {
    manifest.status = 'COMPLETE';
  } else {
    manifest.status = 'INCOMPLETE';
  }

  manifest.completedAt = new Date().toISOString();

  // Merge/dedupe only if COMPLETE
  let candidates: RequirementCandidate[] = [];
  let contradictions: MergedComplianceResult['contradictions'] = [];

  if (manifest.status === 'COMPLETE') {
    const merged = mergeRequirements(allChunkResults, sourceUnits);
    candidates = merged.candidates;
    contradictions = merged.contradictions;
  }

  return {
    manifest,
    candidates,
    contradictions,
    totalCostUsd: totalCost,
    totalProviderCalls: totalCalls,
  };
}

// ============================================================
// DETERMINISTIC MERGE / DEDUPE
// ============================================================

function mergeRequirements(
  chunkResults: ChunkExtractionResult[],
  sourceUnits: SourceUnit[]
): { candidates: RequirementCandidate[]; contradictions: MergedComplianceResult['contradictions'] } {
  const unitMap = new Map(sourceUnits.map(u => [u.chunkId, u]));
  const candidates: RequirementCandidate[] = [];
  const contradictions: MergedComplianceResult['contradictions'] = [];

  // Group requirements by normalized text for dedup
  const seen = new Map<string, RequirementCandidate>();

  for (const chunk of chunkResults) {
    const unit = unitMap.get(chunk.chunkId);
    if (!unit) continue;

    for (const req of chunk.requirements) {
      const normalizedKey = normalizeRequirementText(req.requirementText);

      const existing = seen.get(normalizedKey);
      if (existing) {
        // Deduplicate: add source location to existing
        existing.sourceLocations.push({
          chunkId: chunk.chunkId,
          sectionRef: req.sourceSection || unit.sectionRef,
          sourceDocumentId: unit.sourceDocumentId,
          sourceDocumentVersion: unit.sourceDocumentVersion,
        });

        // Check for contradictory mandatory status
        if (existing.mandatory !== req.mandatory) {
          contradictions.push({
            description: `Requirement "${req.requirementText.slice(0, 80)}..." has conflicting mandatory status across sections`,
            sourceA: { chunkId: existing.sourceLocations[0].chunkId, sectionRef: existing.sourceLocations[0].sectionRef, text: `mandatory: ${existing.mandatory}` },
            sourceB: { chunkId: chunk.chunkId, sectionRef: unit.sectionRef, text: `mandatory: ${req.mandatory}` },
          });
          // Conservative: mark as mandatory if either says mandatory
          existing.mandatory = true;
          existing.interpretationRequired = true;
        }
      } else {
        const candidate: RequirementCandidate = {
          requirementText: req.requirementText,
          requirementType: req.requirementType,
          mandatory: req.mandatory,
          sourceLocations: [{
            chunkId: chunk.chunkId,
            sectionRef: req.sourceSection || unit.sectionRef,
            sourceDocumentId: unit.sourceDocumentId,
            sourceDocumentVersion: unit.sourceDocumentVersion,
          }],
          responseExpectation: req.responseExpectation,
          evidenceNeed: req.evidenceNeed,
          ambiguous: req.ambiguous || false,
          interpretationRequired: false,
        };
        seen.set(normalizedKey, candidate);
        candidates.push(candidate);
      }
    }
  }

  return { candidates, contradictions };
}

/**
 * Normalize requirement text for dedup matching.
 * Conservative: only exact content match after whitespace normalization.
 */
function normalizeRequirementText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
