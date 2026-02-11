import { getSupabase } from './client.js';

// ============================================
// USER PROFILE TYPES & FUNCTIONS
// ============================================

export interface UserProfile {
  id?: string;
  slack_user_id: string;
  user_name: string;
  display_name?: string;
  role?: string;
  background?: string;
  // Personalization preferences
  communication_style?: 'concise' | 'detailed' | 'balanced';
  topics_of_interest?: string[]; // e.g., ['VA', 'HCD', 'WOSB']
  agencies_focus?: string[]; // Agencies they care about most
  // Decision patterns (learned over time)
  decision_style?: 'cautious' | 'aggressive' | 'balanced';
  typical_concerns?: string[]; // What they usually ask about
  // Notification preferences
  notify_hot_opps?: boolean; // Notify for 80+ score opps
  notify_competitor_alerts?: boolean;
  quiet_hours_start?: string; // e.g., "18:00"
  quiet_hours_end?: string; // e.g., "08:00"
  timezone?: string; // e.g., "America/Chicago"
  // Interaction tracking
  total_interactions?: number;
  last_interaction_at?: string;
  favorite_agent?: string; // Which agent they interact with most
  // Agent notes
  agent_notes?: string; // Free-form notes from agents
  created_at?: string;
  updated_at?: string;
}

export interface UserInteraction {
  id?: string;
  slack_user_id: string;
  agent: string;
  interaction_type: 'question' | 'decision' | 'feedback' | 'command';
  topic?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  created_at?: string;
}

/**
 * Get user profile by Slack user ID
 * Returns the user's name and role so agents can address them properly
 */
export async function getUserProfile(slackUserId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .select('*')
      .eq('slack_user_id', slackUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.warn('Could not fetch user profile:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('Could not fetch user profile:', err);
    return null;
  }
}

/**
 * Upsert a user profile
 */
export async function upsertUserProfile(
  profile: Partial<UserProfile>
): Promise<UserProfile | null> {
  try {
    const { data, error } = await getSupabase()
      .from('user_profiles')
      .upsert(
        {
          ...profile,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'slack_user_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Could not upsert user profile:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Could not upsert user profile:', err);
    return null;
  }
}

/**
 * Track a user interaction for learning preferences
 */
export async function trackUserInteraction(
  interaction: Omit<UserInteraction, 'id' | 'created_at'>
): Promise<void> {
  try {
    // Log the interaction
    await getSupabase()
      .from('user_interactions')
      .insert({
        ...interaction,
        created_at: new Date().toISOString(),
      });

    // Update the user's interaction count and last interaction time
    const { data: profile } = await getSupabase()
      .from('user_profiles')
      .select('total_interactions, favorite_agent')
      .eq('slack_user_id', interaction.slack_user_id)
      .single();

    if (profile) {
      // Increment interaction count
      await getSupabase()
        .from('user_profiles')
        .update({
          total_interactions: (profile.total_interactions || 0) + 1,
          last_interaction_at: new Date().toISOString(),
        })
        .eq('slack_user_id', interaction.slack_user_id);
    }
  } catch (err) {
    // Silently fail - don't block on tracking
  }
}

/**
 * Get user's recent interaction topics to understand their interests
 */
export async function getUserTopics(slackUserId: string, limit: number = 20): Promise<string[]> {
  try {
    const { data, error } = await getSupabase()
      .from('user_interactions')
      .select('topic')
      .eq('slack_user_id', slackUserId)
      .not('topic', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    // Count topic frequency
    const topicCounts: Record<string, number> = {};
    for (const row of data) {
      if (row.topic) {
        topicCounts[row.topic] = (topicCounts[row.topic] || 0) + 1;
      }
    }

    // Return topics sorted by frequency
    return Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);
  } catch {
    return [];
  }
}

/**
 * Format user profile for agent context
 * Gives agents info to personalize their responses
 */
export function formatUserProfileForAgent(profile: UserProfile | null): string {
  if (!profile) {
    return ''; // No profile data available
  }

  const lines: string[] = ['=== USER CONTEXT ==='];

  // Basic info
  lines.push(`User: ${profile.display_name || profile.user_name}`);
  if (profile.role) {
    lines.push(`Role: ${profile.role}`);
  }

  // Communication preferences
  if (profile.communication_style) {
    const styleGuide: Record<string, string> = {
      concise: 'Prefers brief, to-the-point responses',
      detailed: 'Prefers thorough explanations with context',
      balanced: 'Standard communication style',
    };
    lines.push(`Style: ${styleGuide[profile.communication_style]}`);
  }

  // Topics of interest
  if (profile.topics_of_interest && profile.topics_of_interest.length > 0) {
    lines.push(`Interests: ${profile.topics_of_interest.join(', ')}`);
  }

  // Agency focus
  if (profile.agencies_focus && profile.agencies_focus.length > 0) {
    lines.push(`Agency focus: ${profile.agencies_focus.join(', ')}`);
  }

  // Decision style
  if (profile.decision_style) {
    const decisionGuide: Record<string, string> = {
      cautious: 'Tends to want more research before deciding',
      aggressive: 'Prefers to move quickly on opportunities',
      balanced: 'Balanced approach to decisions',
    };
    lines.push(`Decision style: ${decisionGuide[profile.decision_style]}`);
  }

  // Typical concerns
  if (profile.typical_concerns && profile.typical_concerns.length > 0) {
    lines.push(`Usually asks about: ${profile.typical_concerns.join(', ')}`);
  }

  // Agent notes
  if (profile.agent_notes) {
    lines.push(`Notes: ${profile.agent_notes}`);
  }

  // Background
  if (profile.background) {
    lines.push(`Background: ${profile.background}`);
  }

  if (lines.length === 1) {
    return ''; // Only header, no actual data
  }

  lines.push('=== END USER CONTEXT ===\n');
  return lines.join('\n');
}

/**
 * Update user preferences based on observed behavior
 * Call this periodically to learn from interactions
 */
export async function learnUserPreferences(slackUserId: string): Promise<void> {
  try {
    // Get recent interactions
    const { data: interactions } = await getSupabase()
      .from('user_interactions')
      .select('topic, agent, interaction_type')
      .eq('slack_user_id', slackUserId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!interactions || interactions.length < 5) {
      return; // Not enough data to learn from
    }

    // Determine favorite agent
    const agentCounts: Record<string, number> = {};
    for (const i of interactions) {
      if (i.agent) {
        agentCounts[i.agent] = (agentCounts[i.agent] || 0) + 1;
      }
    }
    const favoriteAgent = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Determine topics of interest from interactions
    const topicCounts: Record<string, number> = {};
    for (const i of interactions) {
      if (i.topic) {
        topicCounts[i.topic] = (topicCounts[i.topic] || 0) + 1;
      }
    }
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);

    // Update profile with learned preferences
    await getSupabase()
      .from('user_profiles')
      .update({
        favorite_agent: favoriteAgent,
        topics_of_interest: topTopics.length > 0 ? topTopics : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('slack_user_id', slackUserId);
  } catch (err) {
    console.warn('Could not learn user preferences:', err);
  }
}

// User context (personal info about Lapedra/Tamara)
export interface UserContext {
  id?: string;
  user_name: string;
  context_type: 'personal' | 'preference' | 'pattern' | 'family' | 'mood';
  content: string;
  mentioned_by?: string;
  still_relevant?: boolean;
}

export async function saveUserContext(context: UserContext): Promise<void> {
  try {
    await getSupabase()
      .from('user_context')
      .insert({
        ...context,
        mentioned_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn('Could not save user context:', err);
  }
}

export async function getUserContext(userName: string, limit: number = 10): Promise<UserContext[]> {
  try {
    const { data, error } = await getSupabase()
      .from('user_context')
      .select()
      .eq('user_name', userName)
      .eq('still_relevant', true)
      .order('mentioned_at', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/**
 * Save user context with embedding for semantic search
 */
export async function saveUserContextWithEmbedding(
  context: UserContext,
  embedding?: number[]
): Promise<void> {
  try {
    const insertData: Record<string, unknown> = {
      ...context,
      mentioned_at: new Date().toISOString(),
    };

    if (embedding) {
      insertData.embedding = `[${embedding.join(',')}]`;
    }

    await getSupabase().from('user_context').insert(insertData);
  } catch (err) {
    console.warn('Could not save user context:', err);
  }
}
