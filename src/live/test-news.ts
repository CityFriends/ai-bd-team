#!/usr/bin/env npx tsx
import 'dotenv/config';
import { searchNews, getAgencyNews } from '../integrations/news-search.js';

async function test() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Testing News Search API');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Test 1: Basic search
  console.log('Test 1: Searching for "VA contract award"...\n');

  const result = await searchNews({
    query: 'contract award',
    agencyName: 'VA',
    limit: 3,
  });

  console.log(`Source: ${result.source}`);
  console.log(`Articles found: ${result.articles.length}`);
  console.log('');

  if (result.articles.length === 0) {
    console.log('⚠️  No articles found. Check API key configuration.');
  } else {
    for (const article of result.articles) {
      console.log('📰', article.title);
      console.log('   Source:', article.source);
      console.log('   URL:', article.url);
      console.log('');
    }
  }

  // Test 2: Agency news
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Test 2: Getting agency news for "Department of Defense"...\n');

  const agencyNews = await getAgencyNews('Department of Defense');

  console.log(`Source: ${agencyNews.source}`);
  console.log(`Recent news: ${agencyNews.recentNews.length}`);
  console.log(`Leadership news: ${agencyNews.leadershipChanges.length}`);
  console.log(`Program news: ${agencyNews.programNews.length}`);
  console.log('');

  if (agencyNews.recentNews.length > 0) {
    console.log('Recent:');
    agencyNews.recentNews.slice(0, 2).forEach((a) => console.log('  -', a.title));
  }

  if (agencyNews.leadershipChanges.length > 0) {
    console.log('Leadership:');
    agencyNews.leadershipChanges.slice(0, 2).forEach((a) => console.log('  -', a.title));
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Done!');
  console.log('═══════════════════════════════════════════════════════════');
}

test().catch(console.error);
