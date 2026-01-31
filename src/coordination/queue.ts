import { getPendingTasks, updateTaskStatus } from '../integrations/supabase.js';
import { getAgent } from '../agents/index.js';
import type { AgentQueueItem, AgentName } from '../types/index.js';

let queueProcessorInterval: ReturnType<typeof setInterval> | null = null;
const QUEUE_POLL_INTERVAL = 30000; // Check every 30 seconds

// Process pending tasks from the queue
async function processQueue(): Promise<void> {
  try {
    const pendingTasks = await getPendingTasks();

    for (const task of pendingTasks) {
      await processTask(task);
    }
  } catch (error) {
    console.error('Error processing queue:', error);
  }
}

// Process a single task
async function processTask(task: AgentQueueItem): Promise<void> {
  console.log(`Processing task: ${task.agent} - ${task.action}`);

  try {
    // Mark as running
    await updateTaskStatus(task.id, 'running');

    // Get the agent and execute the action
    const agent = getAgent(task.agent as AgentName);
    await agent.handleAction(task.action, {
      ...task.payload,
      opportunity_id: task.opportunity_id,
      thread_ts: task.thread_ts,
    });

    // Mark as completed
    await updateTaskStatus(task.id, 'completed', { success: true });
    console.log(`Task completed: ${task.agent} - ${task.action}`);
  } catch (error) {
    console.error(`Task failed: ${task.agent} - ${task.action}`, error);
    await updateTaskStatus(task.id, 'failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// Start the queue processor
export function startQueueProcessor(): void {
  if (queueProcessorInterval) {
    console.log('Queue processor already running');
    return;
  }

  console.log('Starting queue processor...');

  // Initial run
  processQueue();

  // Schedule regular runs
  queueProcessorInterval = setInterval(processQueue, QUEUE_POLL_INTERVAL);
  console.log(`Queue processor started (polling every ${QUEUE_POLL_INTERVAL / 1000}s)`);
}

// Stop the queue processor
export function stopQueueProcessor(): void {
  if (queueProcessorInterval) {
    clearInterval(queueProcessorInterval);
    queueProcessorInterval = null;
    console.log('Queue processor stopped');
  }
}

// Process queue immediately (for testing)
export async function processQueueNow(): Promise<void> {
  await processQueue();
}
