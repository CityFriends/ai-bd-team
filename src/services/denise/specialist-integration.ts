/**
 * Denise Specialist Integration — Read-Only Artifact Bundle Assembly
 *
 * Deterministic service providing verified acquisition intelligence to:
 * James, Patricia, Jodie, Marcus, Rosa
 *
 * Zero LLM calls. Zero mutations. Zero downstream actions.
 * All artifacts are immutable and versioned.
 */

import type { SupabaseClient } from './types.js';

// ============================================================
// TYPES
// ============================================================

export type SpecialistRole = 'JAMES' | 'PATRICIA' | 'JODIE' | 'MARCUS' | 'ROSA';
export type WorkflowPhase = 'CAPTURE' | 'PURSUIT';
export type ArtifactType =
  | 'ACQUISITION_ANALYSIS' | 'EVALUATION_MODEL' | 'CLAUSE_REGISTER'
  | 'ACQUISITION_RISK' | 'CLARIFICATION_QUESTION' | 'ACQUISITION_CONFLICT'
  | 'AMENDMENT_IMPACT' | 'REGULATORY_INTERPRETATION';

export interface IntegrationRequest {
  opportunityId: string;
  pursuitId?: string;
  specialistRole: SpecialistRole;
  workflowPhase: WorkflowPhase;
  requestedArtifactTypes?: ArtifactType[];
  asOfVersion?: number;
}

export interface ArtifactProvenance {
  artifactId: string;
  artifactType: ArtifactType;
  version: number;
  sourceEvidenceIds: string[];
  contentHash?: string;
  findingCategory: string;
  verificationStatus: string;
  coverageStatus: string;
  supersededById: string | null;
  createdAt: string;
  legalReviewRequired: boolean;
}

export interface DeniseIntelligenceBundle {
  opportunityId: string;
  specialistRole: SpecialistRole;
  workflowPhase: WorkflowPhase;
  retrievedAt: string;

  // Artifacts (typed as arrays of DB rows with provenance)
  acquisitionAnalyses: Array<Record<string, unknown> & { _provenance: ArtifactProvenance }>;
  evaluationModels: Array<Record<string, unknown> & { _provenance: ArtifactProvenance }>;
  clauseRegister: Array<Record<string, unknown> & { _provenance: ArtifactProvenance }>;
  acquisitionRisks: Array<Record<string, unknown> & { _provenance: ArtifactProvenance }>;
  clarificationQuestions: Array<Record<string, unknown> & { _provenance: ArtifactProvenance }>;
  acquisitionConflicts: Array<Record<string, unknown> & { _provenance: ArtifactProvenance }>;
  amendmentImpacts: Array<Record<string, unknown> & { _provenance: ArtifactProvenance }>;
  regulatoryInterpretations: Array<Record<string, unknown> & { _provenance: ArtifactProvenance }>;

  // Metadata
  versionInfo: {
    latestVersion: number;
    requestedVersion: number | null;
    /** Version numbers are local to each artifact stream (per-opportunity analyses).
     *  asOfVersion does NOT represent a globally consistent historical snapshot. */
    versionScope: 'PER_ARTIFACT_STREAM';
  };
  missingArtifacts: ArtifactType[];
  staleIndicators: string[];
  legalReviewRequired: boolean;
  coverageLimitations: string[];
}

// ============================================================
// SPECIALIST PROJECTION RULES
// ============================================================

export const SPECIALIST_ARTIFACT_MAP: Record<SpecialistRole, ArtifactType[]> = {
  JAMES: ['ACQUISITION_ANALYSIS', 'EVALUATION_MODEL', 'ACQUISITION_RISK', 'ACQUISITION_CONFLICT', 'AMENDMENT_IMPACT'],
  PATRICIA: ['ACQUISITION_ANALYSIS', 'CLAUSE_REGISTER', 'CLARIFICATION_QUESTION', 'AMENDMENT_IMPACT'],
  JODIE: ['EVALUATION_MODEL', 'CLAUSE_REGISTER', 'AMENDMENT_IMPACT', 'REGULATORY_INTERPRETATION'],
  MARCUS: ['EVALUATION_MODEL', 'CLAUSE_REGISTER', 'ACQUISITION_RISK', 'REGULATORY_INTERPRETATION'],
  ROSA: ['ACQUISITION_ANALYSIS', 'CLAUSE_REGISTER', 'ACQUISITION_RISK', 'ACQUISITION_CONFLICT'],
};

// ============================================================
// VERSION SELECTION
// ============================================================

function selectCurrentVersion<T extends { version?: number; supersedes_id?: string | null }>(
  artifacts: T[]
): T[] {
  // Find artifacts that are NOT superseded by any other artifact
  const supersededIds = new Set(artifacts.map(a => (a as any).supersedes_id).filter(Boolean));
  return artifacts.filter(a => !supersededIds.has((a as any).id));
}

// ============================================================
// PROVENANCE BUILDER
// ============================================================

function buildProvenance(
  artifact: Record<string, unknown>,
  artifactType: ArtifactType
): ArtifactProvenance {
  return {
    artifactId: String(artifact.id || ''),
    artifactType,
    version: Number(artifact.version || artifact.amendment_version || 1),
    sourceEvidenceIds: Array.isArray(artifact.source_refs)
      ? (artifact.source_refs as Array<{ id?: string }>).map(r => r.id || '').filter(Boolean)
      : Array.isArray(artifact.evidence_refs)
        ? (artifact.evidence_refs as Array<{ id?: string }>).map(r => typeof r === 'string' ? r : r.id || '').filter(Boolean)
        : [],
    contentHash: String(artifact.content_hash || artifact.evidence_content_hash || ''),
    findingCategory: String(artifact.finding_category || artifact.risk_type || artifact.classification || 'DENISE_ANALYSIS'),
    verificationStatus: String(artifact.verification_status || artifact.freshness_status || 'VERIFIED'),
    coverageStatus: String(artifact.coverage_status || 'PARTIAL'),
    supersededById: artifact.supersedes_id ? String(artifact.supersedes_id) : null,
    createdAt: String(artifact.created_at || ''),
    legalReviewRequired: Boolean(artifact.legal_review_required),
  };
}

// ============================================================
// MAIN SERVICE
// ============================================================

export async function getDeniseIntelligenceForSpecialist(
  supabase: SupabaseClient,
  request: IntegrationRequest
): Promise<DeniseIntelligenceBundle> {
  const now = new Date().toISOString();
  // Validate specialist role
  const roleMap = SPECIALIST_ARTIFACT_MAP[request.specialistRole];
  if (!roleMap) {
    throw new Error(`Invalid specialist role: ${request.specialistRole}`);
  }

  // requestedArtifactTypes is an INTERSECTION filter, not an override.
  // It can narrow the role's allowed types but cannot expand beyond them.
  const roleAllowed = new Set(roleMap);
  const allowedTypes = request.requestedArtifactTypes
    ? request.requestedArtifactTypes.filter(t => roleAllowed.has(t))
    : roleMap;

  const bundle: DeniseIntelligenceBundle = {
    opportunityId: request.opportunityId,
    specialistRole: request.specialistRole,
    workflowPhase: request.workflowPhase,
    retrievedAt: now,
    acquisitionAnalyses: [],
    evaluationModels: [],
    clauseRegister: [],
    acquisitionRisks: [],
    clarificationQuestions: [],
    acquisitionConflicts: [],
    amendmentImpacts: [],
    regulatoryInterpretations: [],
    versionInfo: { latestVersion: 0, requestedVersion: request.asOfVersion || null, versionScope: 'PER_ARTIFACT_STREAM' },
    missingArtifacts: [],
    staleIndicators: [],
    legalReviewRequired: false,
    coverageLimitations: [],
  };

  // === ACQUISITION ANALYSES ===
  if (allowedTypes.includes('ACQUISITION_ANALYSIS')) {
    let query = supabase.from('acquisition_analyses').select('*')
      .eq('opportunity_id', request.opportunityId)
      .order('version', { ascending: false });
    if (request.asOfVersion) query = query.lte('version', request.asOfVersion);
    const { data } = await query;
    if (data?.length) {
      const current = selectCurrentVersion(data);
      bundle.acquisitionAnalyses = current.map(a => ({ ...a, _provenance: buildProvenance(a, 'ACQUISITION_ANALYSIS') }));
      bundle.versionInfo.latestVersion = Math.max(...data.map((a: any) => a.version || 0));
    } else {
      bundle.missingArtifacts.push('ACQUISITION_ANALYSIS');
    }
  }

  // === EVALUATION MODELS ===
  if (allowedTypes.includes('EVALUATION_MODEL')) {
    // Evaluation models require analysis IDs — fetch analyses if not already loaded
    let analysisIds = bundle.acquisitionAnalyses.map(a => a.id as string).filter(Boolean);
    if (!analysisIds.length) {
      const { data: analyses } = await supabase.from('acquisition_analyses').select('id')
        .eq('opportunity_id', request.opportunityId).order('version', { ascending: false });
      analysisIds = (analyses || []).map((a: any) => a.id);
    }
    if (analysisIds.length) {
      const { data } = await supabase.from('acquisition_evaluation_models').select('*')
        .in('acquisition_analysis_id', analysisIds);
      if (data?.length) {
        bundle.evaluationModels = data.map((e: any) => ({ ...e, _provenance: buildProvenance(e, 'EVALUATION_MODEL') }));
      }
    }
    if (!bundle.evaluationModels.length) bundle.missingArtifacts.push('EVALUATION_MODEL');
  }

  // === CLAUSE REGISTER ===
  if (allowedTypes.includes('CLAUSE_REGISTER')) {
    const { data } = await supabase.from('acquisition_clause_register').select('*')
      .eq('opportunity_id', request.opportunityId);
    if (data?.length) {
      bundle.clauseRegister = data.map((c: any) => ({ ...c, _provenance: buildProvenance(c, 'CLAUSE_REGISTER') }));
    } else {
      bundle.missingArtifacts.push('CLAUSE_REGISTER');
    }
  }

  // === ACQUISITION RISKS ===
  if (allowedTypes.includes('ACQUISITION_RISK')) {
    const { data } = await supabase.from('acquisition_risks').select('*')
      .eq('opportunity_id', request.opportunityId).eq('status', 'OPEN');
    if (data?.length) {
      bundle.acquisitionRisks = data.map((r: any) => ({ ...r, _provenance: buildProvenance(r, 'ACQUISITION_RISK') }));
    } else {
      bundle.missingArtifacts.push('ACQUISITION_RISK');
    }
  }

  // === CLARIFICATION QUESTIONS ===
  if (allowedTypes.includes('CLARIFICATION_QUESTION')) {
    const { data } = await supabase.from('acquisition_clarification_questions').select('*')
      .eq('opportunity_id', request.opportunityId);
    if (data?.length) {
      bundle.clarificationQuestions = data.map((q: any) => ({ ...q, _provenance: buildProvenance(q, 'CLARIFICATION_QUESTION') }));
    } else {
      bundle.missingArtifacts.push('CLARIFICATION_QUESTION');
    }
  }

  // === ACQUISITION CONFLICTS ===
  if (allowedTypes.includes('ACQUISITION_CONFLICT')) {
    const { data } = await supabase.from('acquisition_conflicts').select('*')
      .eq('opportunity_id', request.opportunityId).eq('status', 'OPEN');
    if (data?.length) {
      bundle.acquisitionConflicts = data.map((c: any) => ({ ...c, _provenance: buildProvenance(c, 'ACQUISITION_CONFLICT') }));
    } else {
      bundle.missingArtifacts.push('ACQUISITION_CONFLICT');
    }
  }

  // === AMENDMENT IMPACTS ===
  if (allowedTypes.includes('AMENDMENT_IMPACT')) {
    // Amendment impacts are stored as acquisition_analyses with amendment_version > 0
    const { data } = await supabase.from('acquisition_analyses').select('*')
      .eq('opportunity_id', request.opportunityId)
      .gt('amendment_version', 0)
      .order('amendment_version', { ascending: false });
    if (data?.length) {
      bundle.amendmentImpacts = data.map((a: any) => ({ ...a, _provenance: buildProvenance(a, 'AMENDMENT_IMPACT') }));
    }
  }

  // === REGULATORY INTERPRETATIONS ===
  if (allowedTypes.includes('REGULATORY_INTERPRETATION')) {
    const { data } = await supabase.from('regulatory_interpretations').select('*')
      .eq('opportunity_id', request.opportunityId)
      .order('created_at', { ascending: false });
    if (data?.length) {
      bundle.regulatoryInterpretations = data.map((ri: any) => ({
        ...ri,
        _provenance: {
          ...buildProvenance(ri, 'REGULATORY_INTERPRETATION'),
          contentHash: ri.evidence_content_hash,
          verificationStatus: 'PARTIAL', // Bounded schema
          coverageStatus: ri.coverage_status || 'PARTIAL',
        },
      }));
      // Preserve coverage limitations
      bundle.coverageLimitations.push('Regulatory interpretations use bounded schema (max 3 items per category) — coverage is PARTIAL');
      if (data.some((ri: any) => !ri.provision_publication_link_verified)) {
        bundle.coverageLimitations.push('provisionPublicationLinkVerified=false for regulatory evidence');
      }
    } else {
      bundle.missingArtifacts.push('REGULATORY_INTERPRETATION');
    }
  }

  // === AGGREGATE LEGAL REVIEW — always check all sources regardless of specialist projection ===
  const { data: allLegalClauses } = await supabase.from('acquisition_clause_register')
    .select('legal_review_required').eq('opportunity_id', request.opportunityId)
    .eq('legal_review_required', true).limit(1);
  const { data: allLegalRisks } = await supabase.from('acquisition_risks')
    .select('legal_review_required').eq('opportunity_id', request.opportunityId)
    .eq('legal_review_required', true).limit(1);
  const { data: allLegalClarifications } = await supabase.from('acquisition_clarification_questions')
    .select('classification').eq('opportunity_id', request.opportunityId)
    .eq('classification', 'LEGAL_REVIEW_REQUIRED').limit(1);

  bundle.legalReviewRequired =
    (allLegalClauses?.length || 0) > 0 ||
    (allLegalRisks?.length || 0) > 0 ||
    (allLegalClarifications?.length || 0) > 0 ||
    bundle.regulatoryInterpretations.some(ri => ri.legal_review_required);

  // === STALE INDICATORS ===
  if (bundle.acquisitionAnalyses.length > 0 && bundle.amendmentImpacts.length > 0) {
    const latestAnalysisVersion = Math.max(...bundle.acquisitionAnalyses.map(a => Number(a.version) || 0));
    const latestAmendment = Math.max(...bundle.amendmentImpacts.map(a => Number(a.amendment_version) || 0));
    if (latestAmendment > latestAnalysisVersion) {
      bundle.staleIndicators.push(`Amendment v${latestAmendment} may invalidate analysis v${latestAnalysisVersion}`);
    }
  }

  return bundle;
}
