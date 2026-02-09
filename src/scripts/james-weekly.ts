#!/usr/bin/env npx tsx
/**
 * James Weekly Strategic Briefing
 *
 * Every Friday at 4pm CST, James posts an unprompted strategic briefing:
 * - Portfolio status (opportunities in active pursuit)
 * - Strategic observations and patterns noticed
 * - Pending decisions that need human input
 * - Win/loss learnings from recent outcomes
 *
 * Usage:
 *   npm run james:weekly      # Run once now
 *   npm run james:schedule    # Run on schedule (Fridays 4pm CST)
 */
import 'dotenv/config';
import cron from 'node-cron';
import { App } from '@slack/bolt';
import {
  getSupabase,
  getRecommendationAccuracy,
  type OpportunityWorkflow,
} from '../integrations/supabase.js';
import { getAnthropic } from '../integrations/claude.js';

const CHANNEL_ID = process.env.SLACK_CHANNEL_ID || '';

// Initialize James's Slack app
async function getJamesApp(): Promise<App | null> {
  const botToken = process.env.JAMES_BOT_TOKEN;
  const appToken = process.env.JAMES_APP_TOKEN;

  if (!botToken || !appToken) {
    console.log('James Slack tokens not configured, running in test mode');
    return null;
  }

  const app = new App({
    token: botToken,
    appToken: appToken,
    socketMode: true,
  });

  await app.start();
  return app;
}

interface PortfolioSummary {
  activeOpportunities: OpportunityWorkflow[];
  pendingDecisions: OpportunityWorkflow[];
  recentWins: number;
  recentLosses: number;
  passedOpportunities: number;
  avgScore: number;
}

async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const supabase = getSupabase();

  // Get opportunities in active stages
  const { data: active } = await supabase
    .from('opportunity_workflow')
    .select('*')
    .in('stage', ['found', 'researching', 'partner_search', 'strategy', 'pursuing'])
    .order('created_at', { ascending: false });

  // Get opportunities awaiting human decision
  const { data: pending } = await supabase
    .from('opportunity_workflow')
    .select('*')
    .eq('stage', 'awaiting_decision')
    .order('decision_deadline', { ascending: true });

  // Get recent outcomes (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: outcomes } = await supabase
    .from('decision_outcomes')
    .select('*')
    .gte('decided_at', thirtyDaysAgo);

  const wins = outcomes?.filter(o => o.outcome === 'win').length || 0;
  const losses = outcomes?.filter(o => o.outcome === 'loss').length || 0;

  // Get passed opportunities this week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: passedCount } = await supabase
    .from('opportunity_workflow')
    .select('id', { count: 'exact', head: true })
    .eq('stage', 'passed')
    .gte('updated_at', weekAgo);

  // Calculate average score of active opportunities
  const scores = active?.map(o => o.score).filter(Boolean) || [];
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  return {
    activeOpportunities: active || [],
    pendingDecisions: pending || [],
    recentWins: wins,
    recentLosses: losses,
    passedOpportunities: passedCount || 0,
    avgScore,
  };
}

interface StrategicInsight {
  type: 'trend' | 'opportunity' | 'concern' | 'learning';
  insight: string;
}

async function generateStrategicInsights(portfolio: PortfolioSummary): Promise<StrategicInsight[]> {
  const insights: StrategicInsight[] = [];

  // Analyze agency concentration
  const agencyCounts: Record<string, number> = {};
  for (const opp of portfolio.activeOpportunities) {
    const agency = opp.agency || 'Unknown';
    agencyCounts[agency] = (agencyCounts[agency] || 0) + 1;
  }

  const topAgency = Object.entries(agencyCounts).sort((a, b) => b[1] - a[1])[0];
  if (topAgency && topAgency[1] >= 3) {
    insights.push({
      type: 'trend',
      insight: `${topAgency[0]} is hot right now - ${topAgency[1]} active opportunities. Consider proactive outreach to their program offices.`,
    });
  }

  // Check for pipeline gaps
  const stageDistribution: Record<string, number> = {};
  for (const opp of portfolio.activeOpportunities) {
    stageDistribution[opp.stage] = (stageDistribution[opp.stage] || 0) + 1;
  }

  if (!stageDistribution['pursuing'] || stageDistribution['pursuing'] < 2) {
    insights.push({
      type: 'concern',
      insight: 'Pipeline gap: Few opportunities in active pursuit. We may need to be more aggressive on go/no-go decisions.',
    });
  }

  // Win rate analysis
  const totalDecided = portfolio.recentWins + portfolio.recentLosses;
  if (totalDecided >= 3) {
    const winRate = Math.round((portfolio.recentWins / totalDecided) * 100);
    if (winRate >= 50) {
      insights.push({
        type: 'learning',
        insight: `Strong win rate of ${winRate}% (${portfolio.recentWins}/${totalDecided}) over last 30 days. Our selection criteria are working.`,
      });
    } else if (winRate < 30) {
      insights.push({
        type: 'concern',
        insight: `Win rate of ${winRate}% is below target. Consider being more selective or improving proposal quality.`,
      });
    }
  }

  // High-value opportunities
  const highScoreOpps = portfolio.activeOpportunities.filter(o => o.score && o.score >= 85);
  if (highScoreOpps.length > 0) {
    insights.push({
      type: 'opportunity',
      insight: `${highScoreOpps.length} high-fit opportunity${highScoreOpps.length > 1 ? 'ies' : 'y'} (85+ score) in pipeline. These deserve extra attention.`,
    });
  }

  // Deadline pressure (use auto_action_at as proxy for decision deadline)
  const urgentDeadlines = portfolio.pendingDecisions.filter(o => {
    if (!o.auto_action_at) return false;
    const deadline = new Date(o.auto_action_at);
    const daysUntil = (deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    return daysUntil <= 3;
  });

  if (urgentDeadlines.length > 0) {
    insights.push({
      type: 'concern',
      insight: `${urgentDeadlines.length} decision${urgentDeadlines.length > 1 ? 's' : ''} due within 3 days. Don't let these slip.`,
    });
  }

  return insights;
}

async function generateWeeklyBriefing(): Promise<string> {
  console.log('[James Weekly] Generating strategic briefing...');

  const portfolio = await getPortfolioSummary();
  const insights = await generateStrategicInsights(portfolio);
  const accuracyData = await getRecommendationAccuracy();
  const totalRecommendations = accuracyData.goRecommendations.total + accuracyData.passRecommendations.total;
  const wins = accuracyData.goRecommendations.won;
  const passCorrect = accuracyData.passRecommendations.correct;
  const totalCorrect = wins + passCorrect;
  const accuracyRate = totalRecommendations > 0 ? (totalCorrect / totalRecommendations) * 100 : 0;

  // Build the briefing
  const lines: string[] = [];

  lines.push('*📊 Weekly Strategy Brief*');
  lines.push(`_${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}_\n`);

  // Portfolio Status
  lines.push('*PORTFOLIO STATUS*');
  lines.push(`• ${portfolio.activeOpportunities.length} opportunities in active pipeline`);
  lines.push(`• ${portfolio.pendingDecisions.length} pending decision${portfolio.pendingDecisions.length !== 1 ? 's' : ''}`);
  if (portfolio.avgScore > 0) {
    lines.push(`• Average fit score: ${portfolio.avgScore}/100`);
  }
  lines.push('');

  // Recent Activity
  const totalOutcomes = portfolio.recentWins + portfolio.recentLosses;
  if (totalOutcomes > 0 || portfolio.passedOpportunities > 0) {
    lines.push('*LAST 30 DAYS*');
    if (totalOutcomes > 0) {
      const winRate = Math.round((portfolio.recentWins / totalOutcomes) * 100);
      lines.push(`• Wins: ${portfolio.recentWins} | Losses: ${portfolio.recentLosses} | Win rate: ${winRate}%`);
    }
    if (portfolio.passedOpportunities > 0) {
      lines.push(`• Passed this week: ${portfolio.passedOpportunities}`);
    }
    lines.push('');
  }

  // Strategic Insights
  if (insights.length > 0) {
    lines.push("*WHAT I'M THINKING ABOUT*");
    for (const insight of insights) {
      const emoji = insight.type === 'trend' ? '📈' :
                   insight.type === 'opportunity' ? '🎯' :
                   insight.type === 'concern' ? '⚠️' : '💡';
      lines.push(`${emoji} ${insight.insight}`);
    }
    lines.push('');
  }

  // Pending Decisions
  if (portfolio.pendingDecisions.length > 0) {
    lines.push('*DECISIONS NEEDED*');
    for (const opp of portfolio.pendingDecisions.slice(0, 5)) {
      const deadline = opp.auto_action_at ? new Date(opp.auto_action_at).toLocaleDateString() : 'No deadline';
      const recommendation = opp.james_recommendation || 'Pending analysis';
      const emoji = recommendation.toLowerCase().includes('go') ? '🟢' :
                   recommendation.toLowerCase().includes('pass') ? '🔴' : '🟡';
      lines.push(`${emoji} ${opp.title?.slice(0, 50)}...`);
      lines.push(`   Deadline: ${deadline} | Rec: ${recommendation}`);
    }
    if (portfolio.pendingDecisions.length > 5) {
      lines.push(`   _...and ${portfolio.pendingDecisions.length - 5} more_`);
    }
    lines.push('');
  } else {
    lines.push("*DECISIONS NEEDED*");
    lines.push("• No pending decisions - we're clear");
    lines.push('');
  }

  // Recommendation Accuracy (if enough data)
  if (totalRecommendations >= 5) {
    const confidenceEmoji = accuracyRate >= 60 ? '✅' : accuracyRate >= 40 ? '⚠️' : '❌';
    lines.push('*MY TRACK RECORD*');
    lines.push(`${confidenceEmoji} ${Math.round(accuracyRate)}% accuracy on ${totalRecommendations} recommendations`);
    lines.push('');
  }

  lines.push('_Have a good weekend! Hit me up Monday if you want to dive into any of these._');

  return lines.join('\n');
}

async function postToSlack(app: App | null, message: string): Promise<void> {
  if (app) {
    await app.client.chat.postMessage({
      channel: CHANNEL_ID,
      text: message,
    });
    console.log('[James Weekly] Posted to Slack');
  } else {
    console.log('\n--- Would post to Slack ---');
    console.log(message);
    console.log('----------------------------\n');
  }
}

export async function runWeeklyBriefing(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`  James Weekly Briefing - ${new Date().toLocaleString()}`);
  console.log('='.repeat(60) + '\n');

  const app = await getJamesApp();
  const briefing = await generateWeeklyBriefing();

  await postToSlack(app, briefing);

  if (app) {
    await app.stop();
  }

  console.log('\nWeekly briefing complete');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const scheduleMode = args.includes('--schedule') || args.includes('-s');

  if (scheduleMode) {
    console.log('='.repeat(60));
    console.log('  James Weekly Briefing - Scheduled Mode');
    console.log('='.repeat(60));
    console.log('\nSchedule:');
    console.log('  - Friday at 4:00 PM CST: Weekly strategic briefing');
    console.log('  - Press Ctrl+C to stop\n');

    // Friday at 4pm CST (22:00 UTC)
    cron.schedule('0 22 * * 5', async () => {
      await runWeeklyBriefing();
    });

    console.log('Scheduler running...');
  } else {
    // One-time run
    await runWeeklyBriefing();
  }
}

main().catch(console.error);
