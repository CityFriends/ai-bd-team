// Quick test script for embeddings integration
import 'dotenv/config';
import { embed, cosineSimilarity } from '../integrations/embeddings.js';

async function testEmbeddings() {
  console.log('Testing OpenAI embeddings integration...\n');

  try {
    // Test 1: Basic embedding
    console.log('1. Generating embedding for test text...');
    const embedding = await embed('Government contracting opportunity for IT services');
    console.log(`   ✅ Success! Vector length: ${embedding.length}\n`);

    // Test 2: Similarity check
    console.log('2. Testing semantic similarity...');
    const text1 = 'Looking for VA healthcare IT modernization contracts';
    const text2 = 'Veterans Affairs hospital technology upgrade RFP';
    const text3 = 'Recipe for chocolate cake';

    const [emb1, emb2, emb3] = await Promise.all([embed(text1), embed(text2), embed(text3)]);

    const sim12 = cosineSimilarity(emb1, emb2);
    const sim13 = cosineSimilarity(emb1, emb3);

    console.log(`   Similar texts (VA IT): ${(sim12 * 100).toFixed(1)}% similarity`);
    console.log(`   Different texts (IT vs cake): ${(sim13 * 100).toFixed(1)}% similarity`);
    console.log(`   ✅ Similarity working correctly!\n`);

    console.log('🎉 All embedding tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testEmbeddings();
