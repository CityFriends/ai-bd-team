/**
 * Model Lifecycle Controls
 *
 * Operational metadata for enabled models. Warns when models approach
 * retirement boundaries. Does NOT auto-switch models — model changes
 * require separate commissioning.
 */

export interface ModelLifecycleEntry {
  modelId: string;
  provider: string;
  lifecycleState: 'active' | 'legacy' | 'deprecated';
  /** Anthropic's "not sooner than" retirement date, or known retirement date */
  retirementBoundary: string | null;
  /** When this entry was last verified against provider documentation */
  lastVerified: string;
  /** Recommended replacement if deprecated */
  recommendedReplacement: string | null;
}

/**
 * Known lifecycle metadata for models used in production.
 * Source: https://platform.claude.com/docs/en/about-claude/model-deprecations
 * Last verified: 2026-10-01
 */
export const MODEL_LIFECYCLE: ModelLifecycleEntry[] = [
  {
    modelId: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    lifecycleState: 'active',
    retirementBoundary: '2026-10-15', // "not sooner than" — NOT a retirement date
    lastVerified: '2026-10-01',
    recommendedReplacement: null,
  },
  {
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
    lifecycleState: 'active',
    retirementBoundary: '2027-02-17',
    lastVerified: '2026-10-01',
    recommendedReplacement: null,
  },
  {
    modelId: 'claude-sonnet-5-5',
    provider: 'anthropic',
    lifecycleState: 'active',
    retirementBoundary: '2027-09-28',
    lastVerified: '2026-10-01',
    recommendedReplacement: null,
  },
  {
    modelId: 'text-embedding-3-small',
    provider: 'openai',
    lifecycleState: 'active',
    retirementBoundary: null,
    lastVerified: '2026-10-01',
    recommendedReplacement: null,
  },
];

/**
 * Check lifecycle warnings for enabled models.
 * Does NOT auto-switch. Model changes require commissioning.
 */
export function checkModelLifecycle(enabledModelIds: string[]): string[] {
  const warnings: string[] = [];
  const now = new Date();

  for (const modelId of enabledModelIds) {
    const entry = MODEL_LIFECYCLE.find((e) => e.modelId === modelId);

    if (!entry) {
      warnings.push(
        `[Lifecycle] UNKNOWN: ${modelId} has no lifecycle metadata. Verify with provider.`
      );
      continue;
    }

    if (entry.lifecycleState === 'deprecated') {
      warnings.push(
        `[Lifecycle] DEPRECATED: ${modelId} — migrate to ${entry.recommendedReplacement || 'replacement'}. ` +
          `Retirement: ${entry.retirementBoundary || 'TBD'}`
      );
      continue;
    }

    if (entry.retirementBoundary) {
      const boundary = new Date(entry.retirementBoundary);
      const daysUntil = Math.floor((boundary.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      if (daysUntil <= 14) {
        warnings.push(
          `[Lifecycle] ELEVATED WARNING: ${modelId} retirement boundary in ${daysUntil} days (${entry.retirementBoundary}). ` +
            `Plan replacement commissioning.`
        );
      } else if (daysUntil <= 30) {
        warnings.push(
          `[Lifecycle] WARNING: ${modelId} retirement boundary in ${daysUntil} days (${entry.retirementBoundary}). ` +
            `Monitor provider announcements.`
        );
      }
    }
  }

  return warnings;
}
