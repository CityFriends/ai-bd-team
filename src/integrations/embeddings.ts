// Embeddings integration for semantic search
// Uses OpenAI text-embedding-3-small for vector generation

import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY environment variable');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// Embedding model configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingResult {
  embedding: number[];
  text: string;
  tokens: number;
}

/**
 * Generate embedding for a single text string
 */
export async function embed(text: string): Promise<number[]> {
  const client = getOpenAI();

  // Clean and truncate text if necessary (model limit is ~8191 tokens)
  const cleanText = text.trim().slice(0, 30000); // Rough character limit

  if (!cleanText) {
    // Return zero vector for empty text
    return new Array(EMBEDDING_DIMENSIONS).fill(0);
  }

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleanText,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Embedding generation failed:', error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple texts in a single batch
 * More efficient than calling embed() multiple times
 */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  const client = getOpenAI();

  // Clean texts
  const cleanTexts = texts.map(t => t.trim().slice(0, 30000)).filter(t => t.length > 0);

  if (cleanTexts.length === 0) {
    return [];
  }

  try {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleanTexts,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    return response.data.map((item, index) => ({
      embedding: item.embedding,
      text: cleanTexts[index],
      tokens: response.usage?.total_tokens ? Math.floor(response.usage.total_tokens / cleanTexts.length) : 0,
    }));
  } catch (error) {
    console.error('Batch embedding generation failed:', error);
    throw error;
  }
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimensions');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Format embedding array for PostgreSQL vector type
 */
export function formatForPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Parse PostgreSQL vector string back to array
 */
export function parseFromPgVector(vectorStr: string): number[] {
  // Remove brackets and split
  const cleanStr = vectorStr.replace(/[\[\]]/g, '');
  return cleanStr.split(',').map(Number);
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
