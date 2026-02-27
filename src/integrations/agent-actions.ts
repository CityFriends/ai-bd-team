/**
 * Agent Actions - Memory and Follow-Through System
 *
 * Allows agents to commit to actions and actually follow through:
 * - Patricia: Schedule team meetings, set reminders
 * - Maya: Watch opportunities, alert on updates
 * - Marcus: Follow up on outreach, check partners
 * - David: Deep dive research, follow up on news
 */

import { getSupabase } from './supabase.js';
import { getAnthropic } from './claude.js';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

// Team timezone - configurable via env var
const TEAM_TIMEZONE = process.env.TEAM_TIMEZONE || 'America/Chicago';

export interface AgentAction {
  id?: string;
  agent_name: string;
  action_type: string;
  description: string;
  context?: string;
  source_channel?: string;
  source_thread_ts?: string;
  scheduled_for: Date;
  status?: string;
  result_message?: string;
  recurrence?: string;
}

export type ActionType =
  | 'team_meeting' // Patricia calls a team discussion
  | 'watch_opportunity' // Maya watches a specific opportunity
  | 'follow_up' // General follow-up reminder
  | 'research' // David does deep research
  | 'outreach' // Marcus follows up on contacts
  | 'alert'; // Any agent sets an alert

/**
 * Save a new action commitment to the database
 */
export async function createAction(action: AgentAction): Promise<string | null> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('agent_actions')
      .insert({
        agent_name: action.agent_name,
        action_type: action.action_type,
        description: action.description,
        context: action.context,
        source_channel: action.source_channel,
        source_thread_ts: action.source_thread_ts,
        scheduled_for: action.scheduled_for.toISOString(),
        status: 'pending',
        recurrence: action.recurrence,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[AgentActions] Failed to create action:', error);
      return null;
    }

    console.log(
      `[AgentActions] Created action: ${action.agent_name} - ${action.action_type} at ${action.scheduled_for}`
    );
    return data.id;
  } catch (err) {
    console.error('[AgentActions] Error creating action:', err);
    return null;
  }
}

/**
 * Get all pending actions that are due
 */
export async function getDueActions(): Promise<AgentAction[]> {
  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('agent_actions')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true });

    if (error) {
      console.error('[AgentActions] Failed to get due actions:', error);
      return [];
    }

    return (data || []).map((row) => ({
      id: row.id,
      agent_name: row.agent_name,
      action_type: row.action_type,
      description: row.description,
      context: row.context,
      source_channel: row.source_channel,
      source_thread_ts: row.source_thread_ts,
      scheduled_for: new Date(row.scheduled_for),
      status: row.status,
      recurrence: row.recurrence,
    }));
  } catch (err) {
    console.error('[AgentActions] Error getting due actions:', err);
    return [];
  }
}

/**
 * Mark an action as in progress
 */
export async function markActionInProgress(actionId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase
      .from('agent_actions')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', actionId);
  } catch (err) {
    console.error('[AgentActions] Error marking action in progress:', err);
  }
}

/**
 * Mark an action as completed
 */
export async function markActionCompleted(
  actionId: string,
  resultMessage?: string,
  resultThreadTs?: string
): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase
      .from('agent_actions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result_message: resultMessage,
        result_thread_ts: resultThreadTs,
      })
      .eq('id', actionId);
    console.log(`[AgentActions] Completed action: ${actionId}`);
  } catch (err) {
    console.error('[AgentActions] Error marking action completed:', err);
  }
}

/**
 * Mark an action as failed
 */
export async function markActionFailed(actionId: string, error: string): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase
      .from('agent_actions')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        result_message: `Failed: ${error}`,
      })
      .eq('id', actionId);
  } catch (err) {
    console.error('[AgentActions] Error marking action failed:', err);
  }
}

/**
 * Get pending actions for a specific agent
 */
export async function getAgentPendingActions(agentName: string): Promise<AgentAction[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('agent_actions')
      .select('*')
      .eq('agent_name', agentName)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true });

    if (error) return [];

    return (data || []).map((row) => ({
      id: row.id,
      agent_name: row.agent_name,
      action_type: row.action_type,
      description: row.description,
      context: row.context,
      scheduled_for: new Date(row.scheduled_for),
      status: row.status,
    }));
  } catch {
    return [];
  }
}

/**
 * Parse natural language time references to actual dates
 * All times are interpreted in the team's timezone and converted to UTC for storage
 * Uses date-fns-tz for proper DST handling
 */
export function parseScheduleTime(timeRef: string): Date {
  const now = new Date();
  const lower = timeRef.toLowerCase();

  // Helper to create a date in team timezone and convert to UTC
  const createInTimezone = (baseDate: Date, hours: number, minutes = 0): Date => {
    // Get the date in team timezone
    const zonedDate = toZonedTime(baseDate, TEAM_TIMEZONE);
    // Set the hours/minutes in that timezone
    zonedDate.setHours(hours, minutes, 0, 0);
    // Convert back to UTC for storage
    return fromZonedTime(zonedDate, TEAM_TIMEZONE);
  };

  // Handle relative times (these work correctly since they're relative to now)
  if (lower.includes('in 30 min') || lower.includes('in half an hour')) {
    return new Date(now.getTime() + 30 * 60 * 1000);
  }
  if (lower.includes('in an hour') || lower.includes('in 1 hour')) {
    return new Date(now.getTime() + 60 * 60 * 1000);
  }
  if (lower.includes('in 2 hour')) {
    return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  }
  if (lower.includes('later today') || lower.includes('this afternoon')) {
    let afternoon = createInTimezone(now, 14); // 2 PM team timezone
    if (afternoon <= now) {
      afternoon = createInTimezone(now, 16); // 4 PM team timezone
    }
    return afternoon;
  }
  if (lower.includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return createInTimezone(tomorrow, 10); // 10 AM team timezone
  }
  if (lower.includes('next week')) {
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return createInTimezone(nextWeek, 10); // 10 AM team timezone
  }

  // Handle day names
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      const target = new Date(now);
      const currentDay = now.getDay();
      let daysUntil = i - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      target.setDate(target.getDate() + daysUntil);
      return createInTimezone(target, 10); // 10 AM team timezone
    }
  }

  // Handle specific times (interpreted in team timezone)
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3];

    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;

    let scheduled = createInTimezone(now, hours, minutes);

    // If time already passed today, schedule for tomorrow
    if (scheduled <= now) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      scheduled = createInTimezone(tomorrow, hours, minutes);
    }

    return scheduled;
  }

  // Default: schedule for 1 hour from now
  return new Date(now.getTime() + 60 * 60 * 1000);
}

/**
 * Parse an agent's response to extract action commitments
 * Returns structured action if the agent committed to something
 */
export async function parseActionFromResponse(
  agentName: string,
  response: string,
  context: string,
  channel?: string,
  threadTs?: string
): Promise<AgentAction | null> {
  const client = getAnthropic();

  const prompt = `Analyze this agent response and determine if they committed to a future action.

Agent: ${agentName}
Response: "${response}"
Context: ${context}

If the agent committed to doing something later (scheduling a meeting, following up, watching something, researching, reaching out), extract:
1. action_type: one of 'team_meeting', 'watch_opportunity', 'follow_up', 'research', 'outreach', 'alert'
2. description: what they committed to do
3. scheduled_time: when they said they'd do it (e.g., "Thursday", "later today", "next week", "in an hour")

If they did NOT commit to a future action, respond with: NO_ACTION

Response format (if action found):
ACTION_TYPE: <type>
DESCRIPTION: <what they'll do>
SCHEDULED: <when>

Response format (if no action):
NO_ACTION`;

  try {
    const result = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = result.content.find((b) => b.type === 'text');
    const parsed = text?.type === 'text' ? text.text.trim() : '';

    if (parsed.includes('NO_ACTION')) {
      return null;
    }

    // Parse the structured response
    const typeMatch = parsed.match(/ACTION_TYPE:\s*(\w+)/i);
    const descMatch = parsed.match(/DESCRIPTION:\s*(.+)/i);
    const schedMatch = parsed.match(/SCHEDULED:\s*(.+)/i);

    if (typeMatch && descMatch && schedMatch) {
      const scheduledFor = parseScheduleTime(schedMatch[1]);

      return {
        agent_name: agentName,
        action_type: typeMatch[1].toLowerCase(),
        description: descMatch[1].trim(),
        context: context.substring(0, 1000), // Limit context size
        source_channel: channel,
        source_thread_ts: threadTs,
        scheduled_for: scheduledFor,
      };
    }

    return null;
  } catch (err) {
    console.error('[AgentActions] Error parsing action:', err);
    return null;
  }
}
