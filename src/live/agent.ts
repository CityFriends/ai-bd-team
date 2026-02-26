// Live conversational agent base class

import { App, LogLevel } from '@slack/bolt';
import { getAnthropic } from '../integrations/claude.js';
import {
  logAgentMemory,
  claimMessage,
  getRecentThreadResponses,
  getConversationalContext,
  recordThreadParticipation,
  getAgentThreads,
  saveExtractedFact,
  acknowledgeHandoff,
  getUserProfile,
  formatUserProfileForAgent,
  trackUserInteraction,
  getThreadActivity,
  logTeamActivity,
  formatTeamActivityForAgent,
  type TeamActivity,
} from '../integrations/supabase.js';
import { gatherResearchContext, formatResearchContext } from '../integrations/research-context.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';
import {
  parseSlackFiles,
  formatFilesForContext,
  type SlackFile,
} from '../integrations/slack-files.js';
import { createMemoryManager, type MemoryManager } from '../integrations/memory-manager.js';
import {
  buildHierarchicalContext,
  formatHierarchicalContext,
} from '../integrations/summarization.js';
import { embed } from '../integrations/embeddings.js';
import {
  trackAgentResponse,
  detectRephrasedQuestion,
  setupFeedbackListeners,
} from './feedback-listener.js';
import {
  checkForHandoff,
  formatHandoffForPrompt,
  handoffToAgent,
  detectAgentTag,
} from './handoff.js';
import { buildWarmupMessages, formatAgentMoodLine } from './warmups.js';
import { parseActionFromResponse, createAction } from '../integrations/agent-actions.js';
import { loadSharedContext, formatSharedContextForPrompt } from './shared-context.js';
import {
  getToolsForAgent,
  getToolDefinitionsForAgent,
  executeToolCalls,
  formatToolResultsForClaude,
  extractSourceCitations,
  formatToolDescriptionsForAgent,
} from '../tools/index.js';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import {
  EventProcessor,
  createEventProcessor,
  getHandlersForAgent,
  publishEvent,
  type EventType,
  type PublishResult,
} from '../events/index.js';
import type {
  LiveAgentName,
  IncomingMessage,
  ThreadContext,
  ThreadMessage,
  AgentResponse,
  SlackFileAttachment,
} from './types.js';

// Agent Slack IDs for handoffs
const AGENT_SLACK_IDS: Record<string, LiveAgentName> = {
  U0AC3RA4JVB: 'maya',
  U0AC0SVD3MH: 'david',
  U0ACASZ36BW: 'rosa',
  U0AC582GXBQ: 'james',
  U0AC79NTDAN: 'patricia',
  U0ACP8LKFB3: 'jodie',
  U0ADSL3DL95: 'marcus',
};

export abstract class LiveAgent {
  abstract name: LiveAgentName;
  abstract displayName: string;
  abstract systemPrompt: string;

  protected app: App | null = null;
  protected slackUserId: string | null = null;
  protected channelId: string;

  // Track active threads this agent is participating in
  protected activeThreads: Set<string> = new Set();

  // Track recently processed messages to avoid duplicates
  protected processedMessages: Set<string> = new Set();

  // Memory manager for three-tier memory
  protected memoryManager: MemoryManager;

  // Event processor for handling events from other agents
  protected eventProcessor: EventProcessor | null = null;

  constructor() {
    this.channelId = process.env.SLACK_CHANNEL_ID || '';
    // Memory manager will be initialized in connect() once agent name is available
    this.memoryManager = createMemoryManager('agent');
  }

  // Initialize the Slack app for this agent
  async connect(): Promise<void> {
    const botToken = this.getBotToken();
    const appToken = this.getAppToken();

    if (!botToken || !appToken) {
      throw new Error(`Missing tokens for ${this.displayName}. Check .env file.`);
    }

    this.app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    // Get this bot's user ID
    const authResult = await this.app.client.auth.test();
    this.slackUserId = authResult.user_id as string;
    console.log(`${this.displayName}: Connected as <@${this.slackUserId}>`);

    // Initialize memory manager with agent name
    this.memoryManager = createMemoryManager(this.name);

    // Restore active threads from database (persistent across restarts)
    await this.restoreActiveThreads();

    // Set up event handlers
    this.setupEventHandlers();

    // Set up feedback listeners (reaction tracking)
    setupFeedbackListeners(this.app);

    // Start the app
    await this.app.start();
    console.log(`${this.displayName}: Listening for messages...`);
  }

  /**
   * Get the Slack app instance for registering additional handlers
   * (e.g., button action handlers)
   */
  getApp(): App | null {
    return this.app;
  }

  // Restore active threads from database
  private async restoreActiveThreads(): Promise<void> {
    try {
      const threads = await getAgentThreads(this.name, { hours: 72 });
      threads.forEach((t) => this.activeThreads.add(t.thread_ts));
      console.log(
        `${this.displayName}: Restored ${this.activeThreads.size} active threads from database`
      );
    } catch (err) {
      console.warn(`${this.displayName}: Could not restore active threads:`, err);
    }
  }

  // Get bot token from env
  protected abstract getBotToken(): string | undefined;
  protected abstract getAppToken(): string | undefined;

  // Set up Slack event handlers
  private setupEventHandlers(): void {
    if (!this.app) return;

    // Handle @mentions
    this.app.event('app_mention', async ({ event }) => {
      const msg = event as any;
      const messageId = msg.ts;

      // Dedupe: skip if we already processed this message
      if (this.processedMessages.has(messageId)) return;
      this.processedMessages.add(messageId);

      // Clean up old messages after 5 minutes
      setTimeout(() => this.processedMessages.delete(messageId), 5 * 60 * 1000);

      console.log(`${this.displayName}: Mentioned in message`);

      // Debug: Log if files are present
      if (msg.files && msg.files.length > 0) {
        console.log(`${this.displayName}: Message has ${msg.files.length} file(s) attached`);
        msg.files.forEach((f: any) => console.log(`  - ${f.name} (${f.filetype})`));
      }

      const message = await this.parseIncomingMessage(event);
      if (message) {
        await this.handleMessage(message);
      }
    });

    // Handle messages in channels (for thread replies, agent cross-talk, and proactive responses)
    this.app.event('message', async ({ event }) => {
      const msg = event as any;
      const messageId = msg.ts;

      // Dedupe: skip if we already processed this message (via app_mention or earlier)
      if (this.processedMessages.has(messageId)) return;

      // Ignore our OWN messages (prevent self-loops)
      if (msg.bot_id && msg.user === this.slackUserId) return;

      // Check if we're mentioned in this message (for agent cross-talk)
      const text = (msg.text || '').toLowerCase();
      const isMentioned = (msg.text || '').includes(`<@${this.slackUserId}>`);

      // If this is a direct @mention of THIS agent, skip - app_mention handler will handle it
      // This prevents the race condition where both handlers fire for the same message
      if (isMentioned && !msg.bot_id) return;

      // For bot messages (other agents), only respond if directly @mentioned
      const isFromBot = msg.bot_id || msg.subtype === 'bot_message';
      if (isFromBot && !isMentioned) return;

      // Check if this is in a thread we're active in
      const threadTs = msg.thread_ts;
      const isInActiveThread = threadTs && this.activeThreads.has(threadTs) && !isFromBot;

      // Debug: log thread activity
      if (threadTs && this.activeThreads.has(threadTs)) {
        console.log(`${this.displayName}: Received message in active thread`);
      }

      // Check if this is a general channel message (not in a thread) that we should respond to
      const isGeneralMessage = !threadTs && !isFromBot && msg.channel === this.channelId;
      let shouldProactivelyRespond = false;

      // Check if ANOTHER agent is @mentioned - if so, don't proactively respond
      const otherAgentMentioned = this.checkIfOtherAgentMentioned(msg.text || '');
      if (otherAgentMentioned && !isMentioned) {
        // Another agent was specifically @mentioned, let them handle it
        return;
      }

      if (isGeneralMessage) {
        // Patricia responds to general check-ins
        if (this.name === 'patricia') {
          const checkInPhrases = [
            "what's happening",
            'status',
            'update',
            "what's up",
            'checking in',
            'standup',
            'quiet in here',
            'anyone there',
            "y'all",
          ];
          shouldProactivelyRespond = checkInPhrases.some((phrase) => text.includes(phrase));
        }

        // Gratitude responses - Patricia acknowledges thank yous as team coordinator
        if (!shouldProactivelyRespond && this.name === 'patricia') {
          const gratitudePhrases = [
            'thank you',
            'thanks',
            'appreciate',
            'grateful',
            'you rock',
            'great job',
            'nice work',
            'well done',
            'awesome work',
            'good job',
          ];
          const isGratitude = gratitudePhrases.some((phrase) => text.includes(phrase));
          if (isGratitude) {
            shouldProactivelyRespond = true;
          }
        }

        // Casual/social conversation - different agents respond to different topics
        if (!shouldProactivelyRespond) {
          const casualKeywords: Record<string, string[]> = {
            maya: [
              'running',
              'marathon',
              'half marathon',
              'atlanta',
              'cat',
              'sol',
              'true crime',
              'podcast',
              'portugal',
              'japan',
              'travel',
              'traveling',
              'vacation',
              'trip',
              'korea',
              'kbbq',
            ],
            david: [
              'beer',
              'homebrew',
              'brewing',
              'denver',
              'colorado',
              'hiking',
              'board game',
              'game night',
              'ramen',
              'iceland',
              'germany',
              'dog',
              'audit',
            ],
            rosa: [
              'miami',
              'cuban',
              'cooking',
              'dinner party',
              'salsa',
              'dancing',
              'cat',
              'puerto rico',
              'colombia',
              'spain',
              'plantain',
              'wynwood',
            ],
            james: [
              'san diego',
              'golf',
              'golfing',
              'kids',
              'little league',
              'baseball',
              'commanders',
              'nationals',
              'bbq',
              'grill',
              'steak',
              'navy',
              'hawaii',
              'scotland',
              'dad joke',
            ],
            patricia: [
              'austin',
              'yoga',
              'spin',
              'dog',
              'deadline',
              'meal prep',
              'thailand',
              'thai',
              'costa rica',
              'italy',
              'bali',
              'matcha',
            ],
            marcus: [
              'f1',
              'formula 1',
              'mclaren',
              'lando',
              'norris',
              'chess',
              'sci-fi',
              'octavia butler',
              'jemisin',
              'bike',
              'biking',
              'columbia heights',
              'haitian',
              'griot',
              'kernel',
            ],
          };
          const myCasualKeywords = casualKeywords[this.name] || [];
          shouldProactivelyRespond = myCasualKeywords.some((kw) => text.includes(kw));
        }

        // General social questions - rotate who answers (based on agent name hash with message)
        if (!shouldProactivelyRespond) {
          const socialPhrases = [
            // Greetings & check-ins
            'weekend',
            'plans',
            'vacation',
            'traveling',
            'trip',
            'how is everyone',
            'how are you',
            'good morning',
            'good afternoon',
            'happy friday',
            'happy monday',
            'tgif',
            'how we feeling',
            // Pop culture & banter
            'anyone else',
            "y'all",
            'watching',
            'netflix',
            'show',
            'movie',
            'tiktok',
            'twitter',
            'succession',
            'meme',
            'funny',
            'lol',
            'lmao',
            'dead',
            'wild',
            'crazy',
            // General chat
            'feeling',
            'mood',
            'vibe',
            'energy',
            'tired',
            'coffee',
            'need a break',
            'friday',
            'monday',
            'hump day',
            'wednesday',
            'thursday',
            'end of',
            'start of',
            // Food & life
            'lunch',
            'eating',
            'hungry',
            'dinner',
            'drinks',
            'happy hour',
            // Basic questions & help
            'anybody',
            'anyone',
            'does anyone',
            'can someone',
            'help',
            'question',
            'what day',
            'what time',
            "what's today",
            "today's date",
            'calendar',
            'schedule',
            'reminder',
            'forgot',
            'remember',
          ];
          const isSocialQuestion = socialPhrases.some((phrase) => text.includes(phrase));

          if (isSocialQuestion) {
            // Different response chances per agent for social questions
            // Patricia is team coordinator, James waits for strategy
            const responseChances: Record<string, number> = {
              patricia: 0.4, // Team coordinator - responds often
              maya: 0.35,
              rosa: 0.3,
              david: 0.25,
              marcus: 0.2, // Engineering lead - mostly focused on technical
              james: 0.15, // Strategist - waits for strategic topics
            };
            const myChance = responseChances[this.name] || 0.25;
            shouldProactivelyRespond = Math.random() < myChance;
          }
        }

        // Work expertise keywords
        if (!shouldProactivelyRespond) {
          const expertiseKeywords: Record<string, string[]> = {
            maya: ['opportunity', 'sam.gov', 'rfp', 'rfi', 'solicitation', 'found', 'new opp'],
            david: [
              'research',
              'risk',
              'incumbent',
              'agency',
              'red flag',
              'due diligence',
              'analyze',
            ],
            rosa: ['partner', 'team', 'teaming', 'subcontractor', 'relationship', 'intro'],
            james: [
              'go/no-go',
              'should we bid',
              'win probability',
              'capture strategy',
              'final call',
              'worth pursuing',
            ],
            patricia: [], // Patricia handled above
            marcus: [
              'github',
              'repo',
              'repository',
              'codebase',
              'architecture',
              'tech stack',
              'fedramp',
              'ato',
              'section 508',
              'accessibility',
              'cloud.gov',
              'login.gov',
              'uswds',
              'technical review',
              'code review',
              'engineering',
            ],
          };
          const myKeywords = expertiseKeywords[this.name] || [];
          shouldProactivelyRespond = myKeywords.some((kw) => text.includes(kw));
        }

        // Catch-all: respond to any direct question or conversation starter
        // This ensures team members get responses even without specific keywords
        if (!shouldProactivelyRespond) {
          const isQuestion = text.includes('?');
          const isGreeting = /^(hey|hi|hello|yo|sup|what's up|morning|afternoon)/i.test(
            text.trim()
          );

          if (isQuestion || isGreeting) {
            // For general questions/greetings, one agent should respond
            // Patricia is the natural "team coordinator" so she has higher chance
            const responseChance = this.name === 'patricia' ? 0.5 : 0.2;
            shouldProactivelyRespond = Math.random() < responseChance;
          }
        }
      }

      // Final decision: only handle if mentioned, in active thread, OR proactively responding
      // CRITICAL: Never proactively respond to bot messages - that causes pile-ons
      const shouldHandle =
        isMentioned || isInActiveThread || (shouldProactivelyRespond && !isFromBot);

      if (shouldHandle) {
        // Mark as processed to avoid duplicates
        this.processedMessages.add(messageId);
        setTimeout(() => this.processedMessages.delete(messageId), 5 * 60 * 1000);

        const reason = isMentioned
          ? 'Mentioned by agent'
          : isInActiveThread
            ? 'Message in active thread'
            : 'Proactive response to channel message';
        console.log(`${this.displayName}: ${reason}`);

        const message = await this.parseIncomingMessage(event);
        if (message) {
          await this.handleMessage(message);
        }
      }
    });
  }

  // Parse raw Slack event into our message format
  private async parseIncomingMessage(event: any): Promise<IncomingMessage | null> {
    const text = event.text || '';
    const userId = event.user;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const messageTs = event.ts;

    // Find mentioned agents
    const { agents: mentionedAgents, isTeamMention } = this.extractMentionedAgents(text);
    const isDirectMention = mentionedAgents.includes(this.name);
    const isInActiveThread = this.activeThreads.has(threadTs);

    // Look up user profile if it's a human (not a bot)
    let userName: string | undefined;
    if (userId && !event.bot_id) {
      const userProfile = await getUserProfile(userId);
      userName = userProfile?.display_name || userProfile?.user_name;
    }

    // Extract file attachments if present
    // Debug: log raw event to see file structure
    if (event.files) {
      console.log(`${this.displayName || 'Agent'}: Event has ${event.files.length} files attached`);
    }

    const files: SlackFileAttachment[] | undefined = event.files?.map((f: any) => ({
      id: f.id,
      name: f.name,
      mimetype: f.mimetype,
      filetype: f.filetype,
      size: f.size,
      url_private: f.url_private,
      url_private_download: f.url_private_download,
    }));

    // Determine if message is from another bot/agent
    const isFromBot = !!(event.bot_id || event.subtype === 'bot_message');

    return {
      text: this.cleanMessageText(text),
      userId,
      userName,
      channelId,
      threadTs,
      messageTs,
      mentionedAgents,
      isDirectMention,
      isTeamMention,
      isInActiveThread,
      isFromBot,
      files: files?.length ? files : undefined,
    };
  }

  // Check if another agent (not this one) is @mentioned
  private checkIfOtherAgentMentioned(text: string): boolean {
    // Agent Slack IDs
    const agentSlackIds: Record<string, LiveAgentName> = {
      U0AC3RA4JVB: 'maya',
      U0AC0SVD3MH: 'david',
      U0ACASZ36BW: 'rosa',
      U0AC582GXBQ: 'james',
      U0AC79NTDAN: 'patricia',
    };

    // Check for @mentions of other agents
    for (const [slackId, agentName] of Object.entries(agentSlackIds)) {
      if (agentName !== this.name && text.includes(`<@${slackId}>`)) {
        return true;
      }
    }
    return false;
  }

  // Extract which agents are mentioned in the text
  private extractMentionedAgents(text: string): {
    agents: LiveAgentName[];
    isTeamMention: boolean;
  } {
    const mentioned: LiveAgentName[] = [];
    const lowerText = text.toLowerCase();

    const allAgents: LiveAgentName[] = [
      'maya',
      'david',
      'rosa',
      'james',
      'patricia',
      'jodie',
      'marcus',
    ];

    // Check for @bd-team or @bdteam - mentions everyone
    if (lowerText.includes('@bd-team') || lowerText.includes('@bdteam')) {
      return { agents: allAgents, isTeamMention: true };
    }

    // Check if THIS agent is mentioned via Slack's <@USERID> format
    if (this.slackUserId && text.includes(`<@${this.slackUserId}>`)) {
      mentioned.push(this.name);
    }

    // Also check for text mentions like "@jodie" (fallback)
    for (const agent of allAgents) {
      if (lowerText.includes(`@${agent}`) && !mentioned.includes(agent)) {
        mentioned.push(agent);
      }
    }

    return { agents: mentioned, isTeamMention: false };
  }

  // Clean up Slack formatting from message text
  private cleanMessageText(text: string): string {
    // Remove user mentions formatting
    return text
      .replace(/<@[A-Z0-9]+>/g, (match) => {
        // Keep mentions but clean up format
        return match;
      })
      .trim();
  }

  // Main message handler
  async handleMessage(message: IncomingMessage): Promise<void> {
    // Agent-to-agent cooldown: If another agent @mentioned us, check if we already responded recently
    // This prevents response chains where agents keep tagging each other back and forth
    if (message.isDirectMention && message.isFromBot && message.threadTs) {
      const recentResponses = await getRecentThreadResponses(message.threadTs, 60); // 60 second cooldown
      const alreadyRespondedRecently = recentResponses.some((r) => r.agent === this.name);
      if (alreadyRespondedRecently) {
        console.log(
          `${this.displayName}: Already responded in this thread recently, skipping agent mention`
        );
        return;
      }
    }

    // Claim the message in Supabase to prevent duplicate responses across instances
    // This is CRITICAL for distributed deployments where multiple instances may receive the same event
    const claimed = await claimMessage(message.messageTs, this.name, message.threadTs);
    if (!claimed) {
      console.log(`${this.displayName}: Message already claimed by another instance, skipping`);
      return;
    }

    // Check if another agent JUST responded in this thread (within last 20 seconds)
    if (message.threadTs && !message.isDirectMention) {
      const recentResponses = await getRecentThreadResponses(message.threadTs, 20);
      const otherAgentJustResponded = recentResponses.some((r) => r.agent !== this.name);
      if (otherAgentJustResponded) {
        console.log(`${this.displayName}: Another agent just responded in thread, skipping`);
        return;
      }
    }

    // Check for handoffs from other agents
    let handoffContext = '';
    if (message.threadTs) {
      const handoff = await checkForHandoff(this.name, message.threadTs);
      if (handoff) {
        console.log(`${this.displayName}: Found handoff from ${handoff.from_agent}`);
        handoffContext = formatHandoffForPrompt(handoff);
        // Acknowledge the handoff
        if (handoff.id) {
          await acknowledgeHandoff(handoff.id);
        }
      }
    }

    // Check for rephrased questions (frustration detection)
    if (message.threadTs) {
      const rephraseCheck = await detectRephrasedQuestion(message.text, message.threadTs);
      if (rephraseCheck?.isRephrase) {
        console.log(`${this.displayName}: Detected rephrased question - user may be frustrated`);
      }
    }

    // Should we respond?
    const response = await this.generateResponse(message, handoffContext);

    // Add reaction if specified (even if not responding with text)
    if (response.reaction) {
      await this.addReaction(response.reaction, message.messageTs);
      console.log(`${this.displayName}: Added :${response.reaction}: reaction`);
    }

    if (response.shouldRespond) {
      // Add to active threads and persist participation
      if (message.threadTs) {
        this.activeThreads.add(message.threadTs);
        // Persist to database for recovery after restarts
        await recordThreadParticipation(this.name, message.threadTs, message.channelId);
      }

      // For @team mentions, add staggered delay so agents don't all respond at once
      let totalDelay = response.delayMs;
      if (message.isTeamMention) {
        const agentOrder: Record<string, number> = {
          maya: 0, // Scout responds first
          david: 1, // Analyst second
          rosa: 2, // Connector third
          james: 3, // Strategist fourth
          jodie: 4, // Writer fifth
          patricia: 5, // PM sixth
          marcus: 6, // Engineer last
        };
        const position = agentOrder[this.name] || 0;
        // 3-6 seconds stagger per agent + random jitter
        const staggerDelay = position * (3000 + Math.random() * 3000);
        totalDelay += staggerDelay;
        console.log(
          `${this.displayName}: @team detected, adding ${Math.round(staggerDelay)}ms stagger (position ${position})`
        );
      }

      // Wait for natural delay
      console.log(`${this.displayName}: Waiting ${totalDelay}ms before responding...`);
      await this.sleep(totalDelay);

      // Double-check another agent didn't respond while we were waiting
      // Skip this check for @team mentions since we want everyone to respond
      if (message.threadTs && !message.isDirectMention && !message.isTeamMention) {
        const recentResponses = await getRecentThreadResponses(message.threadTs, 15);
        const otherAgentJustResponded = recentResponses.some((r) => r.agent !== this.name);
        if (otherAgentJustResponded) {
          console.log(`${this.displayName}: Another agent responded while waiting, skipping`);
          return;
        }
      }

      // Append source citations if we have sources
      let responseText = response.text;
      if (response.sources.length > 0) {
        const sourceFooter = `\n\n_Sources: ${response.sources.join(', ')}_`;
        responseText += sourceFooter;
      }

      // Post response
      const postedMessage = await this.postMessage(
        responseText,
        message.threadTs || message.messageTs
      );

      // Track response for feedback learning
      if (postedMessage?.ts) {
        trackAgentResponse(
          postedMessage.ts,
          this.name,
          response.text,
          message.text, // original question
          message.threadTs
        );
      }

      // Log to agent_memory for auditing
      await logAgentMemory({
        agent: this.name,
        message_ts: message.messageTs,
        thread_ts: message.threadTs,
        response_text: response.text,
        sources: response.sources,
        confidence_level: response.confidenceLevel,
      });

      // Log team activity for coordination (async, non-blocking)
      // This enables other agents to see what this agent contributed
      this.logTeamContribution(message, response).catch((err) => {
        console.warn(`${this.displayName}: Team activity logging failed:`, err);
      });

      // Extract and store facts from the conversation (async, non-blocking)
      this.extractAndStoreFacts(message.text, response.text, message.threadTs).catch((err) => {
        console.warn(`${this.displayName}: Fact extraction failed:`, err);
      });

      // Check if we tagged another agent - create handoff
      const taggedAgent = detectAgentTag(response.text, AGENT_SLACK_IDS);
      if (taggedAgent && taggedAgent !== this.name && message.threadTs) {
        const threadContext = await this.loadThreadContext(message.threadTs, message.channelId);
        handoffToAgent(this.name, taggedAgent, message.threadTs, threadContext.messages).catch(
          (err) => {
            console.warn(`${this.displayName}: Handoff creation failed:`, err);
          }
        );
      }

      // Check if agent committed to a future action (async, non-blocking)
      this.parseAndSaveAction(
        response.text,
        message.text,
        message.channelId,
        message.threadTs || message.messageTs
      ).catch((err) => {
        console.warn(`${this.displayName}: Action parsing failed:`, err);
      });

      // Log sources to console for visibility
      if (response.sources.length > 0) {
        console.log(
          `${this.displayName}: Sources: ${response.sources.join(', ')} (${response.confidenceLevel} confidence)`
        );
      }
    }
  }

  // Extract facts from conversation and store with embeddings
  private async extractAndStoreFacts(
    userMessage: string,
    agentResponse: string,
    threadTs?: string
  ): Promise<void> {
    const client = getAnthropic();

    const prompt = `Extract any facts worth remembering from this exchange:

User: ${userMessage}
Agent: ${agentResponse}

Look for:
- User preferences ("I prefer...", "Don't...", "I like...", "I hate...")
- Decisions made ("Let's go with...", "Pass on this", "We're pursuing...")
- Important context ("We worked with X before", "Our NAICS is...", "We're 8(a) certified")
- Patterns ("We always...", "We never...", "Typically we...")
- TEAM ANNOUNCEMENTS (someone is offline, on vacation, unavailable, out sick, traveling, busy with something)

Return JSON array of facts (empty array if none found):
{
  "facts": [
    {"type": "preference|decision|context|pattern", "subject": "lapedra|tamara|company|team", "content": "the fact"}
  ]
}

IMPORTANT: Use subject "team" for anything about team member availability or status (offline, vacation, unavailable, busy, etc). These are shared with ALL agents.

Only extract clear, specific facts. Don't infer or guess.`;

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') return;

      const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.facts || parsed.facts.length === 0) return;

      // Save each extracted fact with embedding
      for (const fact of parsed.facts) {
        try {
          const factEmbedding = await embed(fact.content);
          await saveExtractedFact(
            {
              fact_type: fact.type || 'context',
              subject: fact.subject || 'company',
              content: fact.content,
              source_thread_ts: threadTs,
              extracted_by: this.name,
              confidence: 0.8,
              still_relevant: true,
            },
            factEmbedding
          );
          console.log(`${this.displayName}: Extracted fact: "${fact.content.slice(0, 50)}..."`);
        } catch (err) {
          console.warn(`${this.displayName}: Could not save extracted fact:`, err);
        }
      }
    } catch (err) {
      // Extraction failed, that's okay - it's best-effort
    }
  }

  // Parse agent response for action commitments and save them
  private async parseAndSaveAction(
    responseText: string,
    userMessage: string,
    channelId: string,
    threadTs: string
  ): Promise<void> {
    // Skip for certain agents that shouldn't commit to actions
    // Marcus can only commit to technical actions (handled in parseActionFromResponse)
    // Rosa shouldn't commit to actions (she's analysis only)
    if (this.name === 'rosa') {
      return;
    }

    const action = await parseActionFromResponse(
      this.name,
      responseText,
      userMessage.substring(0, 500),
      channelId,
      threadTs
    );

    if (action) {
      // Marcus can only commit to research/technical actions
      if (
        this.name === 'marcus' &&
        action.action_type !== 'research' &&
        action.action_type !== 'follow_up' &&
        action.action_type !== 'technical_review'
      ) {
        console.log(`${this.displayName}: Skipping non-technical action: ${action.action_type}`);
        return;
      }

      await createAction(action);
      console.log(
        `${this.displayName}: Committed to action: ${action.action_type} - ${action.description}`
      );
    }
  }

  // Log team contribution for coordination with other agents
  private async logTeamContribution(
    message: IncomingMessage,
    response: AgentResponse
  ): Promise<void> {
    if (!message.threadTs) return; // Only log for thread conversations

    // Determine action type based on response content
    const actionType = this.detectActionType(response.text);

    // Generate a 1-2 sentence summary of the contribution
    const summary = await this.generateContributionSummary(response.text);

    // Extract key facts mentioned
    const keyFacts = this.extractKeyFacts(response.text);

    // Extract recommendations if any
    const recommendations = this.extractRecommendations(response.text);

    // Determine sentiment
    const sentiment = this.detectSentiment(response.text);

    // Log to database
    await logTeamActivity({
      thread_ts: message.threadTs,
      channel_id: message.channelId,
      agent: this.name,
      action_type: actionType,
      summary,
      key_facts: keyFacts.length > 0 ? keyFacts : undefined,
      recommendations: recommendations.length > 0 ? recommendations : undefined,
      sentiment,
    });

    console.log(`${this.displayName}: Logged team activity (${actionType})`);
  }

  // Detect what type of action the agent took
  private detectActionType(text: string): TeamActivity['action_type'] {
    const lower = text.toLowerCase();

    if (
      lower.includes('recommend') ||
      lower.includes('suggest') ||
      lower.includes('my take') ||
      lower.includes('i think we should')
    ) {
      return 'recommendation';
    }
    if (lower.includes('partner') || lower.includes('teaming') || lower.includes('subcontract')) {
      return 'partner_search';
    }
    if (
      lower.includes('strategy') ||
      lower.includes('capture') ||
      lower.includes('win probability') ||
      lower.includes('go/no-go')
    ) {
      return 'strategy';
    }
    if (lower.includes('?') && !lower.includes('what if')) {
      return 'question';
    }
    if (
      lower.includes('alert') ||
      lower.includes('heads up') ||
      lower.includes('warning') ||
      lower.includes('red flag')
    ) {
      return 'alert';
    }
    if (
      lower.includes('incumbent') ||
      lower.includes('contract') ||
      lower.includes('analysis') ||
      lower.includes('data shows')
    ) {
      return 'analysis';
    }
    return 'research';
  }

  // Generate a brief summary of the contribution
  private async generateContributionSummary(text: string): Promise<string> {
    // For now, just take the first 1-2 sentences
    // Could be enhanced with AI summarization later
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const firstTwo = sentences.slice(0, 2).join('. ').trim();
    return firstTwo.length > 200 ? firstTwo.slice(0, 200) + '...' : firstTwo;
  }

  // Extract key facts from the response
  private extractKeyFacts(text: string): string[] {
    const facts: string[] = [];

    // Look for dollar amounts
    const dollarMatches = text.match(/\$[\d,.]+[MBK]?/g);
    if (dollarMatches) {
      facts.push(...dollarMatches.slice(0, 3));
    }

    // Look for company names after "incumbent" or "contractor"
    const incumbentMatch = text.match(/incumbent[:\s]+([A-Z][a-zA-Z\s]+)/i);
    if (incumbentMatch) {
      facts.push(`Incumbent: ${incumbentMatch[1].trim()}`);
    }

    // Look for percentages
    const percentMatches = text.match(/\d+%/g);
    if (percentMatches) {
      facts.push(...percentMatches.slice(0, 2));
    }

    return facts.slice(0, 5); // Max 5 facts
  }

  // Extract recommendations from the response
  private extractRecommendations(text: string): string[] {
    const recs: string[] = [];
    const lower = text.toLowerCase();

    if (lower.includes('recommend')) {
      const match = text.match(/recommend[s]?\s+(?:we\s+)?([^.!?]+)/i);
      if (match) recs.push(match[1].trim());
    }
    if (lower.includes('suggest')) {
      const match = text.match(/suggest[s]?\s+(?:we\s+)?([^.!?]+)/i);
      if (match) recs.push(match[1].trim());
    }
    if (lower.includes('should consider')) {
      const match = text.match(/should consider\s+([^.!?]+)/i);
      if (match) recs.push(match[1].trim());
    }

    return recs.slice(0, 3); // Max 3 recommendations
  }

  // Detect sentiment of the response
  private detectSentiment(text: string): TeamActivity['sentiment'] {
    const lower = text.toLowerCase();

    // Negative indicators
    const negativeWords = [
      'red flag',
      'concern',
      'risk',
      'warning',
      'avoid',
      'pass on',
      'not a fit',
      'wired',
      'risky',
    ];
    const hasNegative = negativeWords.some((w) => lower.includes(w));

    // Positive indicators
    const positiveWords = [
      'strong fit',
      'good match',
      'recommend',
      'opportunity',
      'promising',
      'solid',
      'great',
    ];
    const hasPositive = positiveWords.some((w) => lower.includes(w));

    // Cautious indicators
    const cautiousWords = ['need more', 'should check', 'verify', 'unclear', 'maybe', 'depends'];
    const hasCautious = cautiousWords.some((w) => lower.includes(w));

    if (hasNegative && !hasPositive) return 'negative';
    if (hasPositive && !hasNegative) return 'positive';
    if (hasCautious) return 'cautious';
    return 'neutral';
  }

  // Extract topic from message for interaction tracking
  private extractTopic(text: string): string | undefined {
    const lowerText = text.toLowerCase();

    // Agency detection
    const agencies = ['va', 'hhs', 'cms', 'dol', 'sba', 'ssa', 'gsa', 'dod', 'dhs'];
    for (const agency of agencies) {
      if (lowerText.includes(agency)) {
        return agency.toUpperCase();
      }
    }

    // Topic detection by keywords
    const topicKeywords: Record<string, string[]> = {
      teaming: ['partner', 'team', 'subcontract', 'prime'],
      pricing: ['price', 'cost', 'budget', 'bid'],
      incumbent: ['incumbent', 'current contractor'],
      compliance: ['far', 'dfar', 'compliance', 'regulation'],
      proposal: ['proposal', 'rfp', 'response', 'submission'],
      'past performance': ['past performance', 'cpars', 'reference'],
      certifications: ['8a', 'wosb', 'sdvosb', 'hubzone', 'small business'],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some((kw) => lowerText.includes(kw))) {
        return topic;
      }
    }

    return undefined;
  }

  // Build compact operational context for the user message
  protected buildOperationalContext(
    message: IncomingMessage,
    mood: string,
    guidance: string,
    agentMoodLine: string,
    companyContext: string,
    memoryContext: string,
    threadContext: string,
    researchContext: string,
    handoffContext: string,
    fileContext: string,
    userProfileContext: string,
    teamActivityContext: string,
    sharedContext: string,
    toolContext: string = ''
  ): string {
    return `RULES (follow these but don't let them flatten your personality):

Output: Respond in JSON — { "shouldRespond": bool, "confidence": 0-1, "response": "text", "sources": [], "confidenceLevel": "HIGH/MEDIUM/LOW", "reaction": "emoji or null" }

Sources: Cite where facts come from. No data = say so. Never invent numbers or links.

CRITICAL: You are stateless. NEVER say "I'll look into this", "give me X minutes", "let me check", or "I'll get back to you". You cannot follow up — you only know what's in your context RIGHT NOW. If you don't have the data, say so and stop.

When to respond: If @mentioned, yes. If another agent was @mentioned, no. If your point was already made, stay quiet. For short replies like "yes" — only respond if YOU were the one they're answering.

Confidence: Cite sources for high confidence. Say "pattern suggests" for medium. Say "gut feeling" for low.

SLACK FORMATTING (CRITICAL - follow exactly):
• Bold = SINGLE asterisk: *bold* — NEVER use **double asterisks**, they don't render in Slack
• Italic = underscores: _italic_
• Bullets = • character (not - or *)
• Code/IDs = backticks: \`notice-id\`
• Links = <URL|text> format

WRONG: **This is bold** (markdown - won't work)
RIGHT: *This is bold* (Slack native - will work)

Example response:
*Key Details:*
• *Agency:* Department of Veterans Affairs
• *Deadline:* March 15, 2026
• *Notice ID:* \`abc123def456\`

*My Take:*
This looks promising because...

Teammates — tag by expertise (NEVER tag yourself):
${this.name !== 'maya' ? 'Maya=<@U0AC3RA4JVB> opportunities and SAM.gov' : ''}
${this.name !== 'david' ? 'David=<@U0AC0SVD3MH> deep research, incumbents, USASpending, risk' : ''}
${this.name !== 'rosa' ? 'Rosa=<@U0ACASZ36BW> teaming, partnerships, introductions' : ''}
${this.name !== 'james' ? 'James=<@U0AC582GXBQ> strategy, go/no-go, capture' : ''}
${this.name !== 'patricia' ? 'Patricia=<@U0AC79NTDAN> deadlines, action items, tracking' : ''}
${this.name !== 'jodie' ? 'Jodie=<@U0ACP8LKFB3> proposal writing, compliance, drafts' : ''}
${this.name !== 'marcus' ? 'Marcus=<@U0ADSL3DL95> engineering lead, GitHub repos, architecture, FedRAMP, ATO, tech stack' : ''}

${agentMoodLine}
Mood detected: ${mood}. ${guidance}

Current date/time: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}

The humans: Lapedra (CEO, founder) and Tamara Tolson (COO). Treat both with respect.

---
${sharedContext}
${companyContext}
${userProfileContext}
${memoryContext}
${threadContext}
${handoffContext}
${researchContext || "\n⚠️ NO RESEARCH DATA LOADED. If asked about opportunities, contracts, or specific data — say you don't have it loaded right now. Do NOT make anything up.\n"}
${toolContext}
${fileContext}
${teamActivityContext}
---

MESSAGE from ${message.userName || 'team member'}:
"${message.text}"

Respond as ${this.displayName}.`;
  }

  // Generate a response using Claude
  async generateResponse(
    message: IncomingMessage,
    handoffContext: string = ''
  ): Promise<AgentResponse> {
    const client = getAnthropic();

    // Load thread context if in a thread (with hierarchical summarization for long threads)
    let threadContext = '';
    let threadMessages: Array<{ author: string; text: string; ts: string }> = [];
    if (message.threadTs) {
      const context = await this.loadThreadContext(message.threadTs, message.channelId);
      threadMessages = context.messages;

      if (context.messages.length > 0) {
        // Use hierarchical summarization for long threads
        try {
          const hierarchical = await buildHierarchicalContext(context.messages, message.threadTs);
          threadContext = '\n\n' + formatHierarchicalContext(hierarchical);
        } catch (err) {
          // Fallback to simple context
          console.warn(`${this.displayName}: Hierarchical context failed, using simple:`, err);
          threadContext =
            '\n\nTHREAD CONTEXT (previous messages):\n' +
            context.messages.map((m) => `${m.author}: ${m.text}`).join('\n');
        }
      }
    }

    // Load three-tier memory context (semantic search enabled)
    let memoryContext = '';
    try {
      const memory = await this.memoryManager.buildMemoryContext(message.text, threadMessages, {
        useSemanticSearch: true,
      });
      memoryContext = this.memoryManager.formatForPrompt(memory);
    } catch (err) {
      // Fallback to legacy memory retrieval
      console.warn(`${this.displayName}: Memory manager failed, using legacy:`, err);
      try {
        const context = await getConversationalContext();
        memoryContext = this.formatContext(context);
      } catch {
        // Memory not available yet, that's okay
      }
    }

    // Load research context (news, USASpending, SAM Entity, FAR)
    // For short replies in threads (like "yes", "go ahead"), use thread context for research
    let researchContext = '';
    try {
      let textForResearch = message.text;

      // If this is a short reply in an active thread, include recent thread context
      // so we can understand WHAT to research
      const isShortReply = message.text.trim().length < 30;
      if (isShortReply && message.isInActiveThread && threadContext) {
        // Combine thread context with the current message for better topic detection
        textForResearch = threadContext + '\n\nCurrent message: ' + message.text;
        console.log(`${this.displayName}: Using thread context for research (short reply)`);
      }

      const research = await gatherResearchContext(textForResearch, this.name);
      researchContext = formatResearchContext(research);
      if (researchContext) {
        console.log(`${this.displayName}: Gathered research context`);
      }
    } catch (err) {
      console.warn(`${this.displayName}: Research context failed:`, err);
    }

    // Load company context (profile, capabilities, past performance)
    let companyContext = '';
    try {
      const company = await loadCompanyContext();
      companyContext = formatCompanyContextForPrompt(company, this.displayName);
      if (company.loaded) {
        console.log(`${this.displayName}: Loaded company context`);
      }
    } catch (err) {
      console.warn(`${this.displayName}: Company context failed:`, err);
    }

    // Load user profile for personalization
    let userProfileContext = '';
    if (message.userId) {
      try {
        const userProfile = await getUserProfile(message.userId);
        userProfileContext = formatUserProfileForAgent(userProfile);
        if (userProfileContext) {
          console.log(`${this.displayName}: Loaded user profile for personalization`);
        }

        // Track this interaction for learning
        trackUserInteraction({
          slack_user_id: message.userId,
          agent: this.name,
          interaction_type: 'question',
          topic: this.extractTopic(message.text),
        });
      } catch (err) {
        // Don't block on profile loading
      }
    }

    // Load team activity context - what have other agents already contributed?
    let teamActivityContext = '';
    if (message.threadTs) {
      try {
        const activities = await getThreadActivity(message.threadTs);
        teamActivityContext = formatTeamActivityForAgent(activities, this.name);
        if (teamActivityContext) {
          console.log(
            `${this.displayName}: Loaded team activity context (${activities.length} contributions)`
          );
        }
      } catch (err) {
        // Don't block on team activity loading
      }
    }

    // Parse attached files if present
    let fileContext = '';
    if (message.files && message.files.length > 0 && this.app) {
      try {
        console.log(`${this.displayName}: Parsing ${message.files.length} attached file(s)...`);
        const botToken = this.getBotToken();
        if (botToken) {
          const parsedFiles = await parseSlackFiles(
            this.app.client,
            message.files as SlackFile[],
            botToken
          );
          fileContext = formatFilesForContext(parsedFiles);
          if (fileContext) {
            console.log(`${this.displayName}: File content extracted successfully`);
          }
        }
      } catch (err) {
        console.warn(`${this.displayName}: File parsing failed:`, err);
        fileContext = '\n📎 ATTACHED FILES:\n[Error: Could not read attached files]\n';
      }
    }

    // Detect mood
    const { mood, guidance } = this.detectMood(message.text);

    // Get personality texture for today's vibe
    const agentMoodLine = formatAgentMoodLine(this.name, message.threadTs);

    // Load shared context (pipeline, decisions, team facts, conversations)
    let sharedContext = '';
    try {
      const shared = await loadSharedContext();
      sharedContext = formatSharedContextForPrompt(shared);
      if (shared.pipeline.length > 0 || shared.decisions.length > 0) {
        console.log(
          `${this.displayName}: Loaded shared context (${shared.pipeline.length} pipeline, ${shared.decisions.length} decisions, ${shared.teamFacts.length} facts)`
        );
      }
    } catch (err) {
      console.warn(`${this.displayName}: Shared context failed:`, err);
    }

    // Get tool descriptions for this agent (if any)
    const toolContext = formatToolDescriptionsForAgent(this.name);
    const agentTools = getToolsForAgent(this.name);
    const toolDefinitions = getToolDefinitionsForAgent(this.name);

    if (agentTools.length > 0) {
      console.log(
        `${this.displayName}: ${agentTools.length} tools available: ${agentTools.map((t) => t.definition.name).join(', ')}`
      );
    }

    // Build compact operational context (goes in user message)
    const operationalContext = this.buildOperationalContext(
      message,
      mood,
      guidance,
      agentMoodLine,
      companyContext,
      memoryContext,
      threadContext,
      researchContext,
      handoffContext,
      fileContext,
      userProfileContext,
      teamActivityContext,
      sharedContext,
      toolContext
    );

    // Build warmup messages for natural conversation flow
    const warmupMessages = buildWarmupMessages(this.name);

    // Track sources from tool calls
    const toolSources: string[] = [];

    // Build initial messages array (will be extended during tool use loop)
    const messages: MessageParam[] = [
      ...(warmupMessages as MessageParam[]),
      { role: 'user', content: operationalContext },
    ];

    // Tool use loop (max 3 iterations to prevent runaway)
    const maxToolIterations = 3;
    let toolIteration = 0;

    // Retry logic for transient errors (429, 529)
    const maxRetries = 3;
    let lastError: unknown = null;

    while (toolIteration <= maxToolIterations) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Build API call - add tools if agent has any
          const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1200, // Increased for tool use responses
            system: this.systemPrompt,
            messages,
            ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
          });

          // Check if Claude wants to use tools
          if (response.stop_reason === 'tool_use') {
            toolIteration++;

            if (toolIteration > maxToolIterations) {
              console.warn(
                `${this.displayName}: Max tool iterations reached (${maxToolIterations})`
              );
              break;
            }

            console.log(`${this.displayName}: Tool use requested (iteration ${toolIteration})`);

            // Execute all tool calls
            const toolResults = await executeToolCalls(response.content, agentTools);

            // Collect source citations
            const newSources = extractSourceCitations(toolResults);
            toolSources.push(...newSources);

            if (newSources.length > 0) {
              console.log(`${this.displayName}: Tool sources: ${newSources.join(', ')}`);
            }

            // Add assistant's tool use to messages
            messages.push({
              role: 'assistant',
              content: response.content,
            } as MessageParam);

            // Add tool results to messages
            const toolResultMessages = formatToolResultsForClaude(toolResults);
            messages.push({
              role: 'user',
              content: toolResultMessages,
            } as MessageParam);

            // Continue the loop to get Claude's final response
            continue;
          }

          // Normal response (end_turn) - extract text
          const textBlock = response.content.find((b) => b.type === 'text');
          if (!textBlock || textBlock.type !== 'text') {
            return {
              text: '',
              shouldRespond: false,
              delayMs: 0,
              confidence: 0,
              sources: [],
              confidenceLevel: 'LOW' as const,
              reaction: null,
            };
          }

          // Parse JSON response
          let jsonText = textBlock.text;
          const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonText = jsonMatch[0];
          }

          const parsed = JSON.parse(jsonText);

          // Extract reaction if present
          const reaction = parsed.reaction || null;

          // Calculate delay (2-8 seconds, randomized) - fast enough to feel responsive
          const baseDelay = 2000 + Math.random() * 6000;
          const delay = message.isDirectMention ? baseDelay * 0.5 : baseDelay; // Faster for direct mentions

          // Normalize confidence level
          const rawLevel = (parsed.confidenceLevel || 'LOW').toUpperCase();
          const confidenceLevel = ['HIGH', 'MEDIUM', 'LOW'].includes(rawLevel)
            ? (rawLevel as 'HIGH' | 'MEDIUM' | 'LOW')
            : 'LOW';

          // Merge tool sources with parsed sources
          const allSources = [...(parsed.sources || []), ...toolSources];
          const uniqueSources = [...new Set(allSources)];

          return {
            text: parsed.response || '',
            shouldRespond: parsed.shouldRespond && parsed.response,
            delayMs: Math.floor(delay),
            confidence: parsed.confidence || 0.5,
            sources: uniqueSources,
            confidenceLevel,
            reaction,
          };
        } catch (error) {
          lastError = error;

          // Check if this is a retryable error (429 rate limit or 529 overloaded)
          const isRetryable =
            error instanceof Error &&
            'status' in error &&
            (error.status === 429 || error.status === 529);

          if (isRetryable && attempt < maxRetries) {
            // Exponential backoff: 2s, 4s, 8s
            const backoffMs = Math.pow(2, attempt) * 1000;
            console.log(
              `${this.displayName}: Claude API overloaded (attempt ${attempt}/${maxRetries}), retrying in ${backoffMs / 1000}s...`
            );
            await this.sleep(backoffMs);
            continue;
          }

          // Non-retryable error or max retries reached
          break;
        }
      }

      // If we get here without returning, break the tool loop
      break;
    }

    // All retries failed
    console.error(`${this.displayName}: Error generating response:`, lastError);
    return {
      text: '',
      shouldRespond: false,
      delayMs: 0,
      confidence: 0,
      sources: [],
      confidenceLevel: 'LOW' as const,
      reaction: null,
    };
  }

  // Load context from a thread
  async loadThreadContext(threadTs: string, channelId: string): Promise<ThreadContext> {
    if (!this.app) {
      return { threadTs, messages: [], participants: [] };
    }

    try {
      const result = await this.app.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 20,
      });

      const messages: ThreadMessage[] = [];
      const participants: Set<string> = new Set();

      for (const msg of result.messages || []) {
        // Determine author
        let author = 'unknown';
        if (msg.bot_id) {
          // Map bot to agent name based on username or other identifier
          author = (msg as any).username?.toLowerCase() || 'bot';
        } else if (msg.user) {
          // Look up user profile to get their name
          const userProfile = await getUserProfile(msg.user);
          author = userProfile?.user_name || 'team member';
          participants.add(msg.user);
        }

        messages.push({
          author,
          text: msg.text || '',
          ts: msg.ts || '',
        });
      }

      return {
        threadTs,
        messages,
        participants: Array.from(participants),
      };
    } catch (error) {
      console.error(`${this.displayName}: Error loading thread:`, error);
      return { threadTs, messages: [], participants: [] };
    }
  }

  // Post a message
  async postMessage(text: string, threadTs?: string): Promise<{ ts: string } | null> {
    if (!this.app) return null;

    try {
      const result = await this.app.client.chat.postMessage({
        channel: this.channelId,
        text,
        thread_ts: threadTs,
        unfurl_links: false,
        unfurl_media: false,
      });
      console.log(`${this.displayName}: Posted response`);
      return { ts: result.ts as string };
    } catch (error) {
      console.error(`${this.displayName}: Error posting message:`, error);
      return null;
    }
  }

  // Add reaction to a message
  async addReaction(emoji: string, messageTs: string): Promise<void> {
    if (!this.app) return;

    try {
      await this.app.client.reactions.add({
        channel: this.channelId,
        timestamp: messageTs,
        name: emoji,
      });
    } catch (error) {
      const slackError = error as { data?: { error?: string } };
      console.warn(
        `${this.displayName}: Failed to add reaction: ${slackError?.data?.error || error}`
      );
    }
  }

  // Disconnect
  async disconnect(): Promise<void> {
    // Stop event processor first
    this.stopEventProcessor();

    if (this.app) {
      await this.app.stop();
      console.log(`${this.displayName}: Disconnected`);
    }
  }

  // ============================================================
  // Event Processor Methods
  // ============================================================

  /**
   * Start the event processor for this agent
   * This enables the agent to react to events from other agents
   */
  async startEventProcessor(): Promise<void> {
    if (this.eventProcessor) {
      console.log(`${this.displayName}: Event processor already running`);
      return;
    }

    const handlers = getHandlersForAgent(this.name);
    if (handlers.size === 0) {
      console.log(`${this.displayName}: No event handlers registered, skipping event processor`);
      return;
    }

    this.eventProcessor = createEventProcessor(this.name, handlers, {
      pollIntervalMs: 5000, // Poll every 5 seconds
      claimLimit: 5,
      onError: (error, event) => {
        console.error(`${this.displayName}: Event processor error:`, error);
        if (event) {
          console.error(`  Event: ${event.event_type} from ${event.source_agent}`);
        }
      },
      onEventProcessed: (event, result) => {
        console.log(
          `${this.displayName}: Processed event ${event.event_type} (success: ${result.success})`
        );
      },
    });

    this.eventProcessor.start();
    console.log(
      `${this.displayName}: Event processor started (handling: ${Array.from(handlers.keys()).join(', ')})`
    );
  }

  /**
   * Stop the event processor
   */
  stopEventProcessor(): void {
    if (this.eventProcessor) {
      this.eventProcessor.stop();
      this.eventProcessor = null;
      console.log(`${this.displayName}: Event processor stopped`);
    }
  }

  /**
   * Check if event processor is running
   */
  isEventProcessorActive(): boolean {
    return this.eventProcessor?.isActive() ?? false;
  }

  /**
   * Publish an event from this agent
   */
  protected async publishEvent(
    eventType: EventType,
    payload: Record<string, unknown>,
    options?: {
      targetAgent?: LiveAgentName;
      priority?: number;
      channelId?: string;
      threadTs?: string;
    }
  ): Promise<PublishResult> {
    return publishEvent({
      eventType,
      sourceAgent: this.name,
      payload,
      targetAgent: options?.targetAgent,
      priority: options?.priority,
      channelId: options?.channelId || this.channelId,
      threadTs: options?.threadTs,
    });
  }

  // Sleep helper
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Detect mood from message style
  protected detectMood(text: string): { mood: string; guidance: string } {
    const lowerText = text.toLowerCase();

    // Short responses = busy or frustrated
    if (text.length < 20 && !text.includes('?')) {
      return { mood: 'busy', guidance: 'Keep response brief. They seem busy or distracted.' };
    }

    // Lots of questions = engaged
    const questionCount = (text.match(/\?/g) || []).length;
    if (questionCount >= 2) {
      return {
        mood: 'engaged',
        guidance: 'They are curious and engaged. Go deeper, share details.',
      };
    }

    // Lol, emoji, haha = relaxed
    if (
      lowerText.includes('lol') ||
      lowerText.includes('haha') ||
      lowerText.includes('😂') ||
      lowerText.includes('🤣')
    ) {
      return { mood: 'relaxed', guidance: 'Casual vibe. Be playful, jokes are welcome.' };
    }

    // ALL CAPS = stressed or excited
    const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
    if (capsRatio > 0.5 && text.length > 10) {
      return {
        mood: 'stressed',
        guidance: 'They seem stressed or very excited. Be supportive, acknowledge the energy.',
      };
    }

    // Ellipsis or "..." = uncertain or trailing off
    if (text.includes('...') || text.includes('idk') || lowerText.includes("i don't know")) {
      return {
        mood: 'uncertain',
        guidance: 'They seem uncertain. Be supportive, help them think through it.',
      };
    }

    // Enthusiastic punctuation
    if ((text.match(/!/g) || []).length >= 2) {
      return { mood: 'excited', guidance: 'They are excited! Match their energy.' };
    }

    return { mood: 'neutral', guidance: 'Normal conversation. Be natural.' };
  }

  // Format conversational context for the prompt
  protected formatContext(context: Awaited<ReturnType<typeof getConversationalContext>>): string {
    let formatted = '';

    if (context.userContext.length > 0) {
      formatted += '\nTHINGS YOU KNOW ABOUT LAPEDRA/TAMARA:\n';
      context.userContext.forEach((c) => {
        formatted += `- ${c.content} (${c.context_type})\n`;
      });
    }

    if (context.memories.length > 0) {
      formatted += '\nPAST CONVERSATIONS TO REFERENCE:\n';
      context.memories.forEach((m) => {
        formatted += `- ${m.summary}\n`;
      });
    }

    if (context.insideJokes.length > 0) {
      formatted += '\nINSIDE JOKES/REFERENCES (use sparingly):\n';
      context.insideJokes.forEach((j) => {
        formatted += `- "${j.reference}" = ${j.full_context}\n`;
      });
    }

    if (context.decisionPatterns.length > 0) {
      formatted += '\nRECENT DECISION PATTERNS:\n';
      context.decisionPatterns.forEach((d) => {
        formatted += `- ${d.decision.toUpperCase()}: ${d.reasoning || 'no reason given'}\n`;
      });
    }

    return formatted;
  }
}
