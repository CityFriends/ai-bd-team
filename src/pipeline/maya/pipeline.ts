/**
 * Maya Pipeline Orchestrator
 *
 * SOURCE → NORMALIZE → DEDUP → HARD FILTER → NON-COMPETITIVE CLASSIFY
 * → FIT SCORE → STRATEGIC OVERRIDE → MAYA REVIEW (if qualified)
 *
 * Reads organizational data through CompanyProfileRepository (DB truth).
 * Shadow mode: processes but does not post to Slack or wake agents.
 */

import type { OpportunitySource, NormalizedOpportunity, PipelineResult } from './types.js';
import { DEFAULT_THRESHOLDS } from './types.js';
import { applyHardFilters } from './hard-filters.js';
import { calculateFitScore, type ScoringContext } from './fit-score.js';
import { checkStrategicOverrides, getNonCompetitiveClassification } from './strategic.js';
import { checkDuplicate } from './dedup.js';
import { detectChanges } from './change-detect.js';
import { matchPastPerformance } from './company-profile.js';
import type { CompanyProfileRepository } from './company-repository.js';

export interface PipelineConfig {
  shadowMode: boolean;
  enableMayaReview: boolean;
  thresholds: typeof DEFAULT_THRESHOLDS;
}

const DEFAULT_CONFIG: PipelineConfig = {
  shadowMode: true,
  enableMayaReview: false,
  thresholds: DEFAULT_THRESHOLDS,
};

/**
 * Process a single opportunity through the full pipeline.
 * Reads company data from repository, not static imports.
 */
export async function processOpportunity(
  opp: NormalizedOpportunity,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  repo: CompanyProfileRepository,
  config: PipelineConfig = DEFAULT_CONFIG
): Promise<PipelineResult> {
  const result: PipelineResult = {
    opportunity: opp,
    decision: 'PASS',
    hardFilter: { excluded: false, reason: null, rule: null },
    fitScore: {
      totalScore: 0,
      breakdown: {
        capabilityFit: 0,
        pastPerformance: 0,
        agencyFit: 0,
        setAsideAdvantage: 0,
        revenueRoleQuality: 0,
        naicsPscFit: 0,
        vehicleAccessFit: 0,
        primeSuitability: 0,
        timingViability: 0,
      },
      reasons: [],
      concerns: [],
      hardExcluded: false,
    },
    strategicOverride: { triggered: false, rules: [] },
    pastPerformanceMatches: [],
    processedAt: new Date().toISOString(),
  };

  // 1. HARD FILTERS
  result.hardFilter = applyHardFilters(opp);
  if (result.hardFilter.excluded) {
    result.decision = 'HARD_EXCLUDE';
    return result;
  }

  // 2. DEDUP + CHANGE DETECTION
  const dupCheck = await checkDuplicate(opp, supabase);
  if (dupCheck.isDuplicate) {
    const { data: existing } = await supabase
      .from('pipeline_opportunities')
      .select('raw_hash, material_hash')
      .eq('source', opp.source)
      .eq('source_id', opp.sourceId)
      .single();

    if (existing) {
      const changes = detectChanges(opp, existing.raw_hash, existing.material_hash);
      if (!changes.hasMaterialChange) {
        result.decision = 'PASS';
        result.fitScore.reasons.push('Duplicate — cosmetic update only');
        return result;
      }
      result.fitScore.reasons.push('Material change detected — rescoring');
    }
  }

  // 3. LOAD ORGANIZATIONAL DATA (from repository, not static imports)
  const [profile, pastPerformance, preferences] = await Promise.all([
    repo.getCompanyProfile(),
    repo.getPastPerformance(),
    repo.getPursuitPreferences(),
  ]);

  const scoringCtx: ScoringContext = { profile, pastPerformance, preferences };

  // 4. PAST PERFORMANCE MATCHING
  result.pastPerformanceMatches = matchPastPerformance(
    { agency: opp.agency, title: opp.title, description: opp.description, naics: opp.naics },
    pastPerformance
  );

  // 5. NON-COMPETITIVE CLASSIFICATION (before scoring — may affect decision)
  const nonCompResult = getNonCompetitiveClassification(opp, profile);
  if (nonCompResult.isNonCompetitive) {
    if (nonCompResult.classification === 'DIRECTED_TO_OTHER') {
      // Another company is the intended source — PASS unless strategic override
      result.decision = 'PASS';
      result.fitScore.reasons.push(`Non-competitive: directed to ${nonCompResult.intendedSource}`);
      // Continue to scoring so we have data, but decision is PASS by default
    }
  }

  // 6. FIT SCORE
  result.fitScore = calculateFitScore(opp, scoringCtx);

  // 7. STRATEGIC OVERRIDES (uses non-competitive classification)
  result.strategicOverride = checkStrategicOverrides(opp, result.fitScore, preferences, profile);

  // 8. DETERMINE DECISION
  const score = result.fitScore.totalScore;
  const t = config.thresholds;

  // Directed-to-other defaults to PASS unless strategic override forces review
  if (nonCompResult.classification === 'DIRECTED_TO_OTHER' && !result.strategicOverride.triggered) {
    result.decision = 'PASS';
  } else if (result.strategicOverride.triggered && score >= 30) {
    result.decision = score >= t.quickReview + 1 ? 'MAYA_FULL_REVIEW' : 'MAYA_QUICK_REVIEW';
  } else if (score > t.quickReview) {
    result.decision = 'MAYA_FULL_REVIEW';
  } else if (score > t.storeWatch) {
    result.decision = 'MAYA_QUICK_REVIEW';
  } else if (score > t.passArchive) {
    result.decision = 'WATCH';
  } else {
    result.decision = 'PASS';
  }

  return result;
}

/**
 * Process a batch of opportunities from a source.
 */
export async function runPipeline(
  source: OpportunitySource,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  repo: CompanyProfileRepository,
  config: PipelineConfig = DEFAULT_CONFIG,
  fetchInput?: { since?: Date; limit?: number }
): Promise<{
  total: number;
  hardExcluded: number;
  passed: number;
  watching: number;
  quickReview: number;
  fullReview: number;
  results: PipelineResult[];
}> {
  const rawOpps = await source.fetchChanges({ since: fetchInput?.since, limit: fetchInput?.limit });
  const normalized = rawOpps.map((raw) => source.normalize(raw)).filter((opp) => opp.sourceId);

  const results: PipelineResult[] = [];
  const counts = { hardExcluded: 0, passed: 0, watching: 0, quickReview: 0, fullReview: 0 };

  for (const opp of normalized) {
    const pipelineResult = await processOpportunity(opp, supabase, repo, config);
    results.push(pipelineResult);

    switch (pipelineResult.decision) {
      case 'HARD_EXCLUDE':
        counts.hardExcluded++;
        break;
      case 'PASS':
        counts.passed++;
        break;
      case 'WATCH':
        counts.watching++;
        break;
      case 'MAYA_QUICK_REVIEW':
        counts.quickReview++;
        break;
      case 'MAYA_FULL_REVIEW':
        counts.fullReview++;
        break;
    }
  }

  return { total: normalized.length, ...counts, results };
}
