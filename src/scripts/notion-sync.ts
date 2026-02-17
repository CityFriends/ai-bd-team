/**
 * Notion Sync
 *
 * Syncs data between Supabase and Notion:
 * - Opportunities from agents → Notion
 * - Decisions from Notion → Supabase
 * - Forecasts → Notion
 * - Feedback → Notion
 *
 * Usage:
 *   npm run notion:sync           # One-time sync
 *   npm run notion:sync --watch   # Continuous sync
 */
import 'dotenv/config';
import * as fs from 'fs';
import {
  addOpportunityToNotion,
  logActivityToNotion,
  logFeedbackToNotion,
  queryNotionDatabase,
  getNotionText,
  getNotionSelect,
  NotionHubIds,
} from '../integrations/notion-hub.js';
import { getSupabase } from '../integrations/supabase.js';

// Load hub IDs
function loadHubIds(): NotionHubIds | null {
  try {
    const data = fs.readFileSync('notion-hub-ids.json', 'utf-8');
    return JSON.parse(data);
  } catch {
    console.error('Hub IDs not found. Run: npm run notion:setup <parent-page-id>');
    return null;
  }
}

// Map agency abbreviations
function mapAgency(abbrev: string): string {
  const map: Record<string, string> = {
    'Department of Veterans Affairs': 'VA',
    'Veterans Affairs': 'VA',
    'Centers for Medicare & Medicaid Services': 'CMS',
    'Department of Health and Human Services': 'HHS',
    'Department of Labor': 'DOL',
    'Department of Homeland Security': 'DHS',
    'General Services Administration': 'GSA',
    'Small Business Administration': 'SBA',
    'Department of Education': 'ED',
  };
  return map[abbrev] || abbrev || 'Other';
}

// Map set-aside to Notion format
function mapSetAside(setAside: string | null): string {
  if (!setAside) return 'Unrestricted';
  const lower = setAside.toLowerCase();
  if (lower.includes('8(a)')) return '8(a)';
  if (lower.includes('wosb') || lower.includes('women')) return 'WOSB';
  if (lower.includes('sdvosb') || lower.includes('service-disabled')) return 'SDVOSB';
  if (lower.includes('hubzone')) return 'HUBZone';
  if (lower.includes('small')) return 'Small Business';
  return 'Unrestricted';
}

// Sync opportunities from seen_opportunities to Notion
async function syncOpportunities(hubIds: NotionHubIds) {
  console.log('\n--- Syncing Opportunities to Notion ---');

  const supabase = getSupabase();

  // Get opportunities not yet synced to Notion
  const { data: opportunities, error } = await supabase
    .from('seen_opportunities')
    .select('*')
    .is('notion_page_id', null)
    .order('posted_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching opportunities:', error);
    return;
  }

  if (!opportunities || opportunities.length === 0) {
    console.log('  No new opportunities to sync');
    return;
  }

  console.log(`  Found ${opportunities.length} opportunities to sync`);

  for (const opp of opportunities) {
    try {
      const pageId = await addOpportunityToNotion(hubIds.opportunitiesDbId, {
        name: opp.title || 'Untitled Opportunity',
        status: 'New',
        fitScore: opp.score,
        samLink: opp.sam_url,
        postedDate: opp.posted_at?.split('T')[0],
        mayasTake: `Score: ${opp.score}/100`,
      });

      // Update Supabase with Notion page ID
      await supabase.from('seen_opportunities').update({ notion_page_id: pageId }).eq('id', opp.id);

      // Log activity
      await logActivityToNotion(hubIds.activityLogDbId, {
        agent: 'Maya',
        actionType: 'Found Opportunity',
        summary: `Found: ${opp.title?.slice(0, 100)}`,
        opportunityId: pageId,
      });

      console.log(`  ✓ Synced: ${opp.title?.slice(0, 50)}...`);
    } catch (err) {
      console.error(`  ✗ Failed to sync: ${opp.title?.slice(0, 50)}...`, err);
    }
  }
}

// Sync forecasts to Notion
async function syncForecasts(hubIds: NotionHubIds) {
  console.log('\n--- Syncing Forecasts to Notion ---');

  const supabase = getSupabase();

  // Get forecasts not yet synced
  const { data: forecasts, error } = await supabase
    .from('agency_forecasts')
    .select('*')
    .is('notion_page_id', null)
    .eq('status', 'upcoming')
    .gte('relevance_score', 60)
    .order('relevance_score', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching forecasts:', error);
    return;
  }

  if (!forecasts || forecasts.length === 0) {
    console.log('  No new forecasts to sync');
    return;
  }

  console.log(`  Found ${forecasts.length} forecasts to sync`);

  for (const forecast of forecasts) {
    try {
      // Add to Notion
      const result = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: hubIds.forecastsDbId },
          properties: {
            Title: { title: [{ text: { content: forecast.title || 'Untitled' } }] },
            Agency: { select: { name: mapAgency(forecast.agency) } },
            Description: {
              rich_text: [{ text: { content: (forecast.description || '').slice(0, 2000) } }],
            },
            'Estimated Value': {
              rich_text: [{ text: { content: forecast.estimated_value || 'TBD' } }],
            },
            'Relevance Score': { number: forecast.relevance_score },
            'Source URL': { url: forecast.source_url || null },
            Status: { select: { name: 'Upcoming' } },
            ...(forecast.estimated_release
              ? { 'Estimated Release': { date: { start: forecast.estimated_release } } }
              : {}),
            ...(forecast.naics_code
              ? { NAICS: { rich_text: [{ text: { content: forecast.naics_code } }] } }
              : {}),
            ...(forecast.set_aside
              ? { 'Set-Aside': { select: { name: mapSetAside(forecast.set_aside) } } }
              : {}),
          },
        }),
      });

      const data = (await result.json()) as { id?: string };

      if (data.id) {
        // Update Supabase with Notion page ID
        await supabase
          .from('agency_forecasts')
          .update({ notion_page_id: data.id })
          .eq('id', forecast.id);

        console.log(`  ✓ Synced: ${forecast.title?.slice(0, 50)}...`);
      }
    } catch (err) {
      console.error(`  ✗ Failed to sync forecast: ${forecast.title?.slice(0, 50)}...`, err);
    }
  }
}

// Sync feedback to Notion
async function syncFeedback(hubIds: NotionHubIds) {
  console.log('\n--- Syncing Feedback to Notion ---');

  const supabase = getSupabase();

  // Get feedback not yet synced
  const { data: feedback, error } = await supabase
    .from('system_feedback')
    .select('*')
    .is('notion_page_id', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching feedback:', error);
    return;
  }

  if (!feedback || feedback.length === 0) {
    console.log('  No new feedback to sync');
    return;
  }

  console.log(`  Found ${feedback.length} feedback items to sync`);

  for (const fb of feedback) {
    try {
      const typeMap: Record<string, string> = {
        bug: 'Bug',
        wrong_answer: 'Wrong Answer',
        great_catch: 'Great Catch',
        suggestion: 'Suggestion',
        annoying: 'Annoying',
        missing_info: 'Missing Info',
      };

      const severityMap: Record<string, string> = {
        minor: 'Minor',
        medium: 'Medium',
        major: 'Major',
      };

      const pageId = await logFeedbackToNotion(hubIds.feedbackLogDbId, {
        agent: fb.agent || 'System',
        feedbackType: typeMap[fb.feedback_type] || 'Suggestion',
        whatHappened: fb.what_happened || '',
        whatShouldHappen: fb.what_should_happen,
        severity: severityMap[fb.severity] || 'Medium',
      });

      // Update Supabase with Notion page ID
      await supabase.from('system_feedback').update({ notion_page_id: pageId }).eq('id', fb.id);

      console.log(`  ✓ Synced feedback: ${fb.what_happened?.slice(0, 50)}...`);
    } catch (err) {
      console.error(`  ✗ Failed to sync feedback:`, err);
    }
  }
}

// Sync decisions from Notion back to Supabase
async function syncDecisions(hubIds: NotionHubIds) {
  console.log('\n--- Syncing Decisions from Notion ---');

  try {
    // Query opportunities with decisions
    const pages = await queryNotionDatabase(hubIds.opportunitiesDbId, {
      and: [{ property: 'Decision', select: { is_not_empty: true } }],
    });

    let synced = 0;

    for (const page of pages) {
      const decision = getNotionSelect(page.properties['Decision']);
      const decisionDate = page.properties['Decision Date']?.date?.start;
      const rationale = getNotionText(page.properties['Decision Rationale']);
      const samLink = page.properties['SAM Link']?.url;

      if (decision && samLink) {
        // Find matching opportunity in Supabase and update
        const supabase = getSupabase();
        const { data: existing } = await supabase
          .from('seen_opportunities')
          .select('id, decision')
          .eq('sam_url', samLink)
          .single();

        if (existing && existing.decision !== decision) {
          await supabase
            .from('seen_opportunities')
            .update({
              decision,
              decision_date: decisionDate,
              decision_rationale: rationale,
            })
            .eq('id', existing.id);

          synced++;
          console.log(`  ✓ Updated decision: ${decision} for ${samLink.slice(-20)}...`);
        }
      }
    }

    console.log(`  Synced ${synced} decision(s) from Notion`);
  } catch (err) {
    console.error('Error syncing decisions:', err);
  }
}

// Run daily sync check (for Patricia)
async function runDailySyncCheck(_hubIds: NotionHubIds): Promise<string> {
  const supabase = getSupabase();

  // Count items that need syncing
  const { count: oppCount } = await supabase
    .from('seen_opportunities')
    .select('id', { count: 'exact' })
    .is('notion_page_id', null);

  const { count: forecastCount } = await supabase
    .from('agency_forecasts')
    .select('id', { count: 'exact' })
    .is('notion_page_id', null)
    .eq('status', 'upcoming');

  const { count: feedbackCount } = await supabase
    .from('system_feedback')
    .select('id', { count: 'exact' })
    .is('notion_page_id', null);

  const total = (oppCount || 0) + (forecastCount || 0) + (feedbackCount || 0);

  if (total === 0) {
    return 'All synced ✓';
  }

  return `Found ${total} items to sync: ${oppCount || 0} opportunities, ${forecastCount || 0} forecasts, ${feedbackCount || 0} feedback`;
}

async function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes('--watch') || args.includes('-w');
  const checkOnly = args.includes('--check') || args.includes('-c');

  const hubIds = loadHubIds();
  if (!hubIds) {
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('  Notion Sync');
  console.log('='.repeat(60));

  if (checkOnly) {
    const status = await runDailySyncCheck(hubIds);
    console.log(`\nSync Status: ${status}`);
    return;
  }

  const runSync = async () => {
    console.log(`\nSync started at ${new Date().toLocaleString()}`);

    await syncOpportunities(hubIds);
    await syncForecasts(hubIds);
    await syncFeedback(hubIds);
    await syncDecisions(hubIds);

    console.log('\nSync complete');
  };

  await runSync();

  if (watchMode) {
    console.log('\nWatching for changes (syncing every 5 minutes)...');
    setInterval(runSync, 5 * 60 * 1000);
  }
}

main().catch(console.error);
