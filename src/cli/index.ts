#!/usr/bin/env node

/**
 * Unified CLI for AI BD Team
 *
 * This CLI provides a unified entry point for all commands.
 * It delegates to the existing scripts which contain their own logic.
 *
 * Usage:
 *   npm run cli -- <command> [subcommand] [options]
 *   npm run cli -- help
 *
 * Examples:
 *   npm run cli -- agent maya scan
 *   npm run cli -- workflow process
 *   npm run cli -- notion sync
 *   npm run cli -- cron maya-daily
 *   npm run cli -- live
 *
 * Note: Most commands still support their legacy npm scripts too.
 */

import 'dotenv/config';
import { program } from 'commander';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '..');

// Helper to run a TypeScript file with tsx
function runScript(scriptPath: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const fullPath = path.resolve(srcDir, scriptPath);
    console.log(`Running: tsx ${fullPath} ${args.join(' ')}`);

    const child = spawn('tsx', [fullPath, ...args], {
      cwd: path.resolve(srcDir, '..'),
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// Agent commands
program
  .command('agent <name> [action]')
  .description('Run agent commands (maya, david, rosa, james, patricia, marcus)')
  .option('--schedule', 'Run in scheduled mode')
  .option('--weekly', 'Run weekly scan')
  .option('--brief', 'Generate brief only')
  .option('--nudge', 'Send nudge reminders')
  .option('--report', 'Generate report')
  .action(async (name: string, action: string | undefined, options) => {
    const agentName = name.toLowerCase();
    const agentAction = action?.toLowerCase() || 'run';
    const args: string[] = [];

    if (options.schedule) args.push('--schedule');
    if (options.weekly) args.push('--weekly');
    if (options.brief) args.push('--brief');
    if (options.nudge) args.push('--nudge');
    if (options.report) args.push('--report');

    const scriptMap: Record<string, Record<string, string>> = {
      maya: {
        scan: 'scripts/maya-scanner.ts',
        run: 'scripts/maya-scanner.ts',
        live: 'live/run-maya.ts',
      },
      david: {
        scan: 'scripts/david-scanner.ts',
        run: 'scripts/david-scanner.ts',
        news: 'scripts/david-news-digest.ts',
        live: 'live/run-david.ts',
      },
      rosa: {
        scan: 'scripts/rosa-scanner.ts',
        run: 'scripts/rosa-scanner.ts',
      },
      james: {
        digest: 'scripts/james-digest.ts',
        weekly: 'scripts/james-weekly.ts',
        run: 'scripts/james-digest.ts',
      },
      patricia: {
        checkin: 'scripts/patricia-checkin.ts',
        run: 'scripts/patricia-checkin.ts',
      },
      marcus: {
        live: 'live/run-marcus.ts',
      },
    };

    const agentScripts = scriptMap[agentName];
    if (!agentScripts) {
      console.error(`Unknown agent: ${agentName}`);
      console.log('Available agents: maya, david, rosa, james, patricia, marcus');
      process.exit(1);
    }

    const script = agentScripts[agentAction];
    if (!script) {
      console.error(`Unknown action for ${agentName}: ${agentAction}`);
      console.log(`Available actions: ${Object.keys(agentScripts).join(', ')}`);
      process.exit(1);
    }

    await runScript(script, args);
  });

// Live team command
program
  .command('live [agent]')
  .description('Start live agent(s) in socket mode')
  .action(async (agent?: string) => {
    if (agent) {
      const agentLower = agent.toLowerCase();
      const liveScripts: Record<string, string> = {
        maya: 'live/run-maya.ts',
        david: 'live/run-david.ts',
        marcus: 'live/run-marcus.ts',
        team: 'live/run-team.ts',
      };

      const script = liveScripts[agentLower];
      if (!script) {
        console.error(`Unknown agent: ${agent}`);
        console.log(`Available: ${Object.keys(liveScripts).join(', ')}`);
        process.exit(1);
      }

      await runScript(script);
    } else {
      await runScript('live/run-team.ts');
    }
  });

// Workflow commands
program
  .command('workflow <action>')
  .description('Run workflow commands (process, summary, learning)')
  .option('--schedule', 'Run in scheduled mode')
  .action(async (action: string, options) => {
    const args: string[] = [];
    if (action === 'summary') args.push('--summary');
    if (action === 'learning') args.push('--learning');
    if (options.schedule) args.push('--schedule');

    await runScript('coordination/workflow-processor.ts', args);
  });

// Notion commands
program
  .command('notion <action>')
  .description('Run Notion commands (setup, sync, watch, check)')
  .action(async (action: string) => {
    const actionMap: Record<string, { script: string; args?: string[] }> = {
      setup: { script: 'scripts/setup-notion-hub.ts' },
      sync: { script: 'scripts/notion-sync.ts' },
      watch: { script: 'scripts/notion-sync.ts', args: ['--watch'] },
      check: { script: 'scripts/notion-sync.ts', args: ['--check'] },
      test: { script: 'scripts/test-notion-hub.ts' },
    };

    const cmd = actionMap[action.toLowerCase()];
    if (!cmd) {
      console.error(`Unknown notion action: ${action}`);
      console.log('Available actions: setup, sync, watch, check, test');
      process.exit(1);
    }

    await runScript(cmd.script, cmd.args);
  });

// Cron commands
program
  .command('cron <job>')
  .description('Run cron jobs (maya-daily, maya-weekly, patricia-standup, patricia-nudge)')
  .action(async (job: string) => {
    const cronScripts: Record<string, string> = {
      'maya-daily': 'cron/maya-daily.ts',
      'maya-weekly': 'cron/maya-weekly.ts',
      'patricia-standup': 'cron/patricia-standup.ts',
      'patricia-nudge': 'cron/patricia-nudge.ts',
    };

    const script = cronScripts[job.toLowerCase()];
    if (!script) {
      console.error(`Unknown cron job: ${job}`);
      console.log(`Available jobs: ${Object.keys(cronScripts).join(', ')}`);
      process.exit(1);
    }

    await runScript(script);
  });

// Scan commands (shorthand)
program
  .command('scan <type>')
  .description('Run scans (opportunities, forecasts)')
  .option('--schedule', 'Run in scheduled mode')
  .option('--brief', 'Generate brief only')
  .action(async (type: string, options) => {
    const args: string[] = [];
    if (options.schedule) args.push('--schedule');
    if (options.brief) args.push('--brief');

    const scanScripts: Record<string, string> = {
      opportunities: 'scripts/maya-scanner.ts',
      opps: 'scripts/maya-scanner.ts',
      forecasts: 'scripts/forecast-scanner.ts',
    };

    const script = scanScripts[type.toLowerCase()];
    if (!script) {
      console.error(`Unknown scan type: ${type}`);
      console.log('Available types: opportunities (opps), forecasts');
      process.exit(1);
    }

    await runScript(script, args);
  });

// Actions commands
program
  .command('actions <action>')
  .description('Manage agent actions (check, schedule)')
  .action(async (action: string) => {
    const args = action.toLowerCase() === 'schedule' ? ['--schedule'] : [];
    await runScript('scripts/action-scheduler.ts', args);
  });

// Utility commands
program
  .command('test-connections')
  .description('Test all external connections')
  .action(async () => {
    await runScript('test-connections.ts');
  });

program
  .command('onboard <company>')
  .description('Onboard a new company')
  .action(async (company: string) => {
    await runScript('scripts/onboard-company.ts', [company]);
  });

program
  .command('check-awards')
  .description('Check for new contract awards')
  .action(async () => {
    await runScript('scripts/check-awards.ts');
  });

// Start server
program
  .command('start')
  .description('Start the production server')
  .action(async () => {
    await runScript('scripts/run-all.ts');
  });

// Show all available legacy commands
program
  .command('legacy')
  .description('Show legacy npm script mappings')
  .action(() => {
    console.log(`
Legacy npm scripts are still available. Here's how they map to the new CLI:

Agent Commands:
  npm run maya:scan          ->  npm run cli -- agent maya scan
  npm run maya:schedule      ->  npm run cli -- agent maya scan --schedule
  npm run david:scan         ->  npm run cli -- agent david scan
  npm run david:news         ->  npm run cli -- agent david news
  npm run rosa:scan          ->  npm run cli -- agent rosa scan
  npm run james:digest       ->  npm run cli -- agent james digest
  npm run james:weekly       ->  npm run cli -- agent james weekly
  npm run patricia:checkin   ->  npm run cli -- agent patricia checkin

Live Agents:
  npm run live               ->  npm run cli -- live
  npm run live:maya          ->  npm run cli -- live maya
  npm run live:david         ->  npm run cli -- live david

Workflow:
  npm run workflow:process   ->  npm run cli -- workflow process
  npm run workflow:summary   ->  npm run cli -- workflow summary

Notion:
  npm run notion:sync        ->  npm run cli -- notion sync
  npm run notion:watch       ->  npm run cli -- notion watch

Cron:
  npm run cron:maya-daily    ->  npm run cli -- cron maya-daily

Scans:
  npm run forecast:scan      ->  npm run cli -- scan forecasts

Server:
  npm run start:prod         ->  npm run cli -- start
`);
  });

// Version and help
program
  .name('ai-bd')
  .description('AI BD Team CLI - Manage AI agents for government contracting')
  .version('1.0.0');

program.parse();
