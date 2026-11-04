/**
 * HR Answer Pipeline — Dependency-Injected Orchestrator
 *
 * Chains: question validation → authorized retrieval → safe prompt
 * assembly → LLM generation → strict parsing → citation validation
 * → employee-safe result.
 *
 * Security contract:
 *   - Retrieval authorization is enforced by the injected retrieval
 *     function (SECURITY DEFINER RPC with signed identity tokens).
 *   - Callers cannot supply arbitrary "authorized" chunks.
 *   - The pipeline never returns unvalidated model text.
 *   - Feature gates are enforced by the LLM client.
 *   - No credentials, prompts, or policy content are logged.
 *
 * This module is independent of Slack formatting and delivery.
 */

import type { HRReaderPool } from '../database/hr-client.js';
import type { RetrievalResult } from '../notion/retrieval.js';
import type { HRLLMClientConfig } from './hr-llm-client.js';
import { createHRLLMClient } from './hr-llm-client.js';
import {
  assemblePrompt,
  finalizeAnswer,
  HR_ABSTENTION_MESSAGE,
  type HRAnswerResult,
} from './hr-answer-foundation.js';

// ── Pipeline Result ─────────────────────────────────────────

export type HRPipelineResult =
  | (HRAnswerResult & { ok: true })
  | {
      ok: false;
      code:
        | 'disabled'
        | 'retrieval_error'
        | 'no_evidence'
        | 'invalid_question'
        | 'prompt_too_large'
        | 'llm_error'
        | 'llm_parse_error'
        | 'citation_error'
        | 'unsafe_output';
      /** Safe, employee-facing fallback message. Never contains raw model output. */
      fallbackMessage: string;
    };

const FALLBACK_DISABLED = 'HR AI assistance is not currently available.';
const FALLBACK_RETRIEVAL =
  'I was unable to look up HR information right now. Please try again later or contact your HR team.';
const FALLBACK_NO_EVIDENCE = HR_ABSTENTION_MESSAGE;
const FALLBACK_QUESTION =
  "I couldn't understand that question. Please try rephrasing it in a shorter, simpler way.";
const FALLBACK_LLM =
  'I encountered an issue generating a response. Please try again later or contact your HR team.';
const FALLBACK_PARSE = FALLBACK_LLM;
const FALLBACK_CITATION = FALLBACK_LLM;
const FALLBACK_UNSAFE = FALLBACK_LLM;
const FALLBACK_PROMPT =
  'That question is too complex for me to process right now. Please try a shorter question or contact your HR team.';

// ── Pipeline Dependencies ───────────────────────────────────

/**
 * Retrieval function signature matching retrieveForUser().
 * Injected to keep the pipeline testable without a real database.
 */
export type RetrievalFn = (
  readerPool: HRReaderPool,
  signingSecret: string,
  queryText: string,
  slackUserId: string
) => Promise<RetrievalResult>;

export interface HRPipelineConfig {
  /** The authorized reader pool for the HR database. */
  readerPool: HRReaderPool;
  /** HMAC signing secret for identity tokens. */
  signingSecret: string;
  /** LLM client configuration (transport + optional timeout). */
  llmConfig: HRLLMClientConfig;
  /** Retrieval function — injected for testability. */
  retrieveFn: RetrievalFn;
}

// ── Pipeline ────────────────────────────────────────────────

/**
 * Execute the full HR answer pipeline for an employee question.
 *
 * The pipeline is fail-closed at every stage:
 *   - Disabled gates → safe message, no LLM call.
 *   - Retrieval failure → safe message, no LLM call.
 *   - No evidence → safe abstention, no LLM call.
 *   - LLM failure → safe message.
 *   - Invalid model output → safe message.
 *   - Unauthorized citations → safe message.
 *
 * Never returns raw model text to the employee.
 */
export async function executeHRPipeline(
  config: HRPipelineConfig,
  question: string,
  slackUserId: string
): Promise<HRPipelineResult> {
  // 1. Authorized retrieval (feature-gated internally by retrieveForUser)
  let retrieval: RetrievalResult;
  try {
    retrieval = await config.retrieveFn(
      config.readerPool,
      config.signingSecret,
      question,
      slackUserId
    );
  } catch {
    return { ok: false, code: 'retrieval_error', fallbackMessage: FALLBACK_RETRIEVAL };
  }

  if (retrieval.error) {
    return { ok: false, code: 'retrieval_error', fallbackMessage: FALLBACK_RETRIEVAL };
  }

  // 2. Assemble prompt from validated question and authorized chunks
  const promptResult = assemblePrompt(question, retrieval.chunks);
  if (!promptResult.ok) {
    const fallback =
      promptResult.code === 'no_evidence'
        ? FALLBACK_NO_EVIDENCE
        : promptResult.code === 'prompt_too_large'
          ? FALLBACK_PROMPT
          : FALLBACK_QUESTION;
    return { ok: false, code: promptResult.code, fallbackMessage: fallback };
  }

  // 3. LLM generation (feature-gated by the LLM client)
  const llmClient = createHRLLMClient(config.llmConfig);
  const llmResult = await llmClient.complete(promptResult.request);

  if (!llmResult.ok) {
    if (llmResult.code === 'disabled') {
      return { ok: false, code: 'disabled', fallbackMessage: FALLBACK_DISABLED };
    }
    return { ok: false, code: 'llm_error', fallbackMessage: FALLBACK_LLM };
  }

  // 4. Validate and finalize the model's response
  const answerResult = finalizeAnswer(llmResult.text, promptResult.authorizedChunks);

  if (!answerResult.ok) {
    const fallback =
      answerResult.code === 'unsafe_output'
        ? FALLBACK_UNSAFE
        : answerResult.code === 'citation_error'
          ? FALLBACK_CITATION
          : FALLBACK_PARSE;
    return { ok: false, code: answerResult.code, fallbackMessage: fallback };
  }

  return answerResult;
}
