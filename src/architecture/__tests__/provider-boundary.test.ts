/**
 * Provider Boundary — Static Architecture Tests
 *
 * These tests enforce the architectural invariant:
 *
 *   APPLICATION CODE → controlled provider module → circuit breaker → external provider
 *
 * No alternate route is permitted.
 *
 * Approved provider modules (Milestone 1A):
 *   - src/integrations/claude.ts
 *   - src/integrations/embeddings.ts
 *
 * Test files may mock provider SDKs as necessary.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');

// Approved modules that may construct provider clients directly
const APPROVED_ANTHROPIC_MODULES = [
  'src/integrations/claude.ts',
  'src/services/llm-gateway/gateway.ts',
];

const APPROVED_OPENAI_MODULES = [
  'src/integrations/embeddings.ts',
  'src/services/llm-gateway/gateway.ts',
];

// Directories/patterns excluded from scanning (tests, config, build artifacts)
const EXCLUDED_PATTERNS = ['__tests__', '.test.ts', '.spec.ts', 'node_modules', 'dist'];

/**
 * Recursively collect all .ts files under a directory
 */
function collectTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...collectTypeScriptFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Check if a file path is excluded from scanning
 */
function isExcluded(filePath: string): boolean {
  return EXCLUDED_PATTERNS.some((pattern) => filePath.includes(pattern));
}

/**
 * Get relative path from project root
 */
function relPath(filePath: string): string {
  return path.relative(PROJECT_ROOT, filePath);
}

describe('Provider Boundary Enforcement', () => {
  const allFiles = collectTypeScriptFiles(SRC_DIR);
  const applicationFiles = allFiles.filter((f) => !isExcluded(f));

  describe('Anthropic SDK', () => {
    it('no direct `new Anthropic(` construction outside approved modules', () => {
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const rel = relPath(file);
        if (APPROVED_ANTHROPIC_MODULES.includes(rel)) continue;

        const content = fs.readFileSync(file, 'utf-8');
        if (/new\s+Anthropic\s*\(/.test(content)) {
          violations.push(rel);
        }
      }

      expect(violations).toEqual([]);
    });

    it('no direct Anthropic SDK imports outside approved modules and type-only imports', () => {
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const rel = relPath(file);
        if (APPROVED_ANTHROPIC_MODULES.includes(rel)) continue;

        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          // Allow type-only imports (import type { ... } from '@anthropic-ai/sdk/...')
          if (/^\s*import\s+type\s+/.test(line)) continue;

          // Flag value imports of the SDK constructor
          if (
            /import\s+.*from\s+['"]@anthropic-ai\/sdk['"]/.test(line) &&
            !/import\s+type\s+/.test(line)
          ) {
            violations.push(`${rel}: ${line.trim()}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('OpenAI SDK', () => {
    it('no direct `new OpenAI(` construction outside approved modules', () => {
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const rel = relPath(file);
        if (APPROVED_OPENAI_MODULES.includes(rel)) continue;

        const content = fs.readFileSync(file, 'utf-8');
        if (/new\s+OpenAI\s*\(/.test(content)) {
          violations.push(rel);
        }
      }

      expect(violations).toEqual([]);
    });

    it('no direct OpenAI SDK imports outside approved modules', () => {
      const violations: string[] = [];

      for (const file of applicationFiles) {
        const rel = relPath(file);
        if (APPROVED_OPENAI_MODULES.includes(rel)) continue;

        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          // Allow type-only imports
          if (/^\s*import\s+type\s+/.test(line)) continue;

          // Flag value imports of openai package
          if (/import\s+.*from\s+['"]openai['"]/.test(line) && !/import\s+type\s+/.test(line)) {
            violations.push(`${rel}: ${line.trim()}`);
          }
        }
      }

      expect(violations).toEqual([]);
    });
  });

  describe('Provider Module Integrity', () => {
    it('claude.ts contains the circuit breaker check', () => {
      const claudePath = path.join(PROJECT_ROOT, 'src', 'integrations', 'claude.ts');
      const content = fs.readFileSync(claudePath, 'utf-8');

      expect(content).toContain('isAIEnabled');
      expect(content).toContain('AIDisabledError');
      expect(content).toContain('getAnthropic');
    });

    it('embeddings.ts contains the circuit breaker check', () => {
      const embeddingsPath = path.join(PROJECT_ROOT, 'src', 'integrations', 'embeddings.ts');
      const content = fs.readFileSync(embeddingsPath, 'utf-8');

      expect(content).toContain('isAIEnabled');
      expect(content).toContain('AIDisabledError');
      expect(content).toContain('getOpenAI');
    });

    it('gateway.ts contains the kill-switch check and budget reservation', () => {
      const gatewayPath = path.join(PROJECT_ROOT, 'src', 'services', 'llm-gateway', 'gateway.ts');
      const content = fs.readFileSync(gatewayPath, 'utf-8');

      expect(content).toContain('isAIEnabled');
      expect(content).toContain('AIDisabledError');
      expect(content).toContain('reserveBudget');
      expect(content).toContain('settleBudget');
      expect(content).toContain('releaseBudget');
      expect(content).toContain('validateAttribution');
    });
  });

  describe('Approved module count', () => {
    it('Anthropic client construction exists only in approved modules', () => {
      const claudePath = path.join(PROJECT_ROOT, 'src', 'integrations', 'claude.ts');
      const gatewayPath = path.join(PROJECT_ROOT, 'src', 'services', 'llm-gateway', 'gateway.ts');

      const claudeContent = fs.readFileSync(claudePath, 'utf-8');
      const gatewayContent = fs.readFileSync(gatewayPath, 'utf-8');

      expect(claudeContent.match(/new\s+Anthropic\s*\(/g)).toHaveLength(1);
      expect(gatewayContent.match(/new\s+Anthropic\s*\(/g)).toHaveLength(1);
    });

    it('OpenAI client construction exists only in approved modules', () => {
      const embeddingsPath = path.join(PROJECT_ROOT, 'src', 'integrations', 'embeddings.ts');
      const content = fs.readFileSync(embeddingsPath, 'utf-8');
      const matches = content.match(/new\s+OpenAI\s*\(/g);
      expect(matches).toHaveLength(1);
    });
  });
});
