// Live conversational agent base class

import { App, LogLevel } from '@slack/bolt';
import { getAnthropic } from '../integrations/claude.js';
import { logAgentMemory, claimMessage, getRecentThreadResponses, getConversationalContext, saveUserContext, saveConversationMemory } from '../integrations/supabase.js';
import { gatherResearchContext, formatResearchContext } from '../integrations/research-context.js';
import { loadCompanyContext, formatCompanyContextForPrompt } from '../context/company-context.js';
import type {
  LiveAgentName,
  LiveAgentConfig,
  IncomingMessage,
  ThreadContext,
  ThreadMessage,
  AgentResponse,
  NAME_TO_AGENT,
  AGENT_EXPERTISE,
} from './types.js';

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

  constructor() {
    this.channelId = process.env.SLACK_CHANNEL_ID || '';
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

    // Set up event handlers
    this.setupEventHandlers();

    // Start the app
    await this.app.start();
    console.log(`${this.displayName}: Listening for messages...`);
  }

  // Get bot token from env
  protected abstract getBotToken(): string | undefined;
  protected abstract getAppToken(): string | undefined;

  // Set up Slack event handlers
  private setupEventHandlers(): void {
    if (!this.app) return;

    // Handle @mentions
    this.app.event('app_mention', async ({ event, say }) => {
      const msg = event as any;
      const messageId = msg.ts;

      // Dedupe: skip if we already processed this message
      if (this.processedMessages.has(messageId)) return;
      this.processedMessages.add(messageId);

      // Clean up old messages after 5 minutes
      setTimeout(() => this.processedMessages.delete(messageId), 5 * 60 * 1000);

      console.log(`${this.displayName}: Mentioned in message`);

      const message = this.parseIncomingMessage(event);
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
          const checkInPhrases = ['what\'s happening', 'status', 'update', 'what\'s up', 'checking in', 'standup', 'quiet in here', 'anyone there', 'y\'all'];
          shouldProactivelyRespond = checkInPhrases.some(phrase => text.includes(phrase));
        }

        // Casual/social conversation - different agents respond to different topics
        if (!shouldProactivelyRespond) {
          const casualKeywords: Record<string, string[]> = {
            maya: ['running', 'marathon', 'half marathon', 'atlanta', 'cat', 'sol', 'true crime', 'podcast', 'portugal', 'japan', 'travel', 'traveling', 'vacation', 'trip', 'korea', 'kbbq'],
            david: ['beer', 'homebrew', 'brewing', 'denver', 'colorado', 'hiking', 'board game', 'game night', 'ramen', 'iceland', 'germany', 'dog', 'audit'],
            rosa: ['miami', 'cuban', 'cooking', 'dinner party', 'salsa', 'dancing', 'cat', 'puerto rico', 'colombia', 'spain', 'plantain', 'wynwood'],
            james: ['san diego', 'golf', 'golfing', 'kids', 'little league', 'baseball', 'commanders', 'nationals', 'bbq', 'grill', 'steak', 'navy', 'hawaii', 'scotland', 'dad joke'],
            patricia: ['austin', 'yoga', 'spin', 'dog', 'deadline', 'meal prep', 'thailand', 'thai', 'costa rica', 'italy', 'bali', 'matcha'],
          };
          const myCasualKeywords = casualKeywords[this.name] || [];
          shouldProactivelyRespond = myCasualKeywords.some(kw => text.includes(kw));
        }

        // General social questions - rotate who answers (based on agent name hash with message)
        if (!shouldProactivelyRespond) {
          const socialPhrases = [
            // Greetings & check-ins
            'weekend', 'plans', 'vacation', 'traveling', 'trip', 'how is everyone', 'how are you',
            'good morning', 'good afternoon', 'happy friday', 'happy monday', 'tgif', 'how we feeling',
            // Pop culture & banter
            'anyone else', 'y\'all', 'watching', 'netflix', 'show', 'movie', 'tiktok', 'twitter',
            'succession', 'meme', 'funny', 'lol', 'lmao', 'dead', 'wild', 'crazy',
            // General chat
            'feeling', 'mood', 'vibe', 'energy', 'tired', 'coffee', 'need a break', 'friday',
            'monday', 'hump day', 'wednesday', 'thursday', 'end of', 'start of',
            // Food & life
            'lunch', 'eating', 'hungry', 'dinner', 'drinks', 'happy hour',
            // Basic questions & help
            'anybody', 'anyone', 'does anyone', 'can someone', 'help', 'question',
            'what day', 'what time', 'what\'s today', 'today\'s date', 'calendar', 'schedule',
            'reminder', 'forgot', 'remember'
          ];
          const isSocialQuestion = socialPhrases.some(phrase => text.includes(phrase));

          if (isSocialQuestion) {
            // Random chance for each agent to respond to social questions
            // Each agent has ~30% chance, but claiming prevents pile-ons
            const randomChance = Math.random();
            shouldProactivelyRespond = randomChance < 0.35;
          }
        }

        // Work expertise keywords
        if (!shouldProactivelyRespond) {
          const expertiseKeywords: Record<string, string[]> = {
            maya: ['opportunity', 'sam.gov', 'rfp', 'rfi', 'solicitation', 'found', 'new opp'],
            david: ['research', 'risk', 'incumbent', 'agency', 'red flag', 'due diligence', 'analyze'],
            rosa: ['partner', 'team', 'teaming', 'subcontractor', 'relationship', 'intro'],
            james: ['strategy', 'go/no-go', 'decision', 'win', 'capture', 'bid', 'pursue'],
            patricia: [], // Patricia handled above
          };
          const myKeywords = expertiseKeywords[this.name] || [];
          shouldProactivelyRespond = myKeywords.some(kw => text.includes(kw));
        }
      }

      const shouldHandle = isMentioned || isInActiveThread || shouldProactivelyRespond;

      if (shouldHandle) {
        // Mark as processed to avoid duplicates
        this.processedMessages.add(messageId);
        setTimeout(() => this.processedMessages.delete(messageId), 5 * 60 * 1000);

        const reason = isMentioned ? 'Mentioned by agent' :
                       isInActiveThread ? 'Message in active thread' :
                       'Proactive response to channel message';
        console.log(`${this.displayName}: ${reason}`);

        const message = this.parseIncomingMessage(event);
        if (message) {
          await this.handleMessage(message);
        }
      }
    });
  }

  // Parse raw Slack event into our message format
  private parseIncomingMessage(event: any): IncomingMessage | null {
    const text = event.text || '';
    const userId = event.user;
    const channelId = event.channel;
    const threadTs = event.thread_ts || event.ts;
    const messageTs = event.ts;

    // Find mentioned agents
    const mentionedAgents = this.extractMentionedAgents(text);
    const isDirectMention = mentionedAgents.includes(this.name);
    const isInActiveThread = this.activeThreads.has(threadTs);

    return {
      text: this.cleanMessageText(text),
      userId,
      channelId,
      threadTs,
      messageTs,
      mentionedAgents,
      isDirectMention,
      isInActiveThread,
    };
  }

  // Check if another agent (not this one) is @mentioned
  private checkIfOtherAgentMentioned(text: string): boolean {
    // Agent Slack IDs
    const agentSlackIds: Record<string, LiveAgentName> = {
      'U0AC3RA4JVB': 'maya',
      'U0AC0SVD3MH': 'david',
      'U0ACASZ36BW': 'rosa',
      'U0AC582GXBQ': 'james',
      'U0AC79NTDAN': 'patricia',
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
  private extractMentionedAgents(text: string): LiveAgentName[] {
    const mentioned: LiveAgentName[] = [];
    const lowerText = text.toLowerCase();

    // Check for @mentions by Slack user ID (would need to map these)
    // For now, check for name mentions
    const agents: LiveAgentName[] = ['maya', 'david', 'rosa', 'james', 'patricia'];

    for (const agent of agents) {
      if (lowerText.includes(`@${agent}`) || lowerText.includes(`<@`) && this.name === agent) {
        mentioned.push(agent);
      }
    }

    return mentioned;
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
    // For non-direct mentions, try to claim the message first (prevents pile-ons)
    if (!message.isDirectMention) {
      const claimed = await claimMessage(message.messageTs, this.name, message.threadTs);
      if (!claimed) {
        console.log(`${this.displayName}: Another agent claimed this message, skipping`);
        return;
      }
    }

    // Check if another agent JUST responded in this thread (within last 20 seconds)
    if (message.threadTs && !message.isDirectMention) {
      const recentResponses = await getRecentThreadResponses(message.threadTs, 20);
      const otherAgentJustResponded = recentResponses.some(r => r.agent !== this.name);
      if (otherAgentJustResponded) {
        console.log(`${this.displayName}: Another agent just responded in thread, skipping`);
        return;
      }
    }

    // Should we respond?
    const response = await this.generateResponse(message);

    // Add reaction if specified (even if not responding with text)
    if (response.reaction) {
      await this.addReaction(response.reaction, message.messageTs);
      console.log(`${this.displayName}: Added :${response.reaction}: reaction`);
    }

    if (response.shouldRespond) {
      // Add to active threads
      if (message.threadTs) {
        this.activeThreads.add(message.threadTs);
      }

      // Wait for natural delay
      console.log(`${this.displayName}: Waiting ${response.delayMs}ms before responding...`);
      await this.sleep(response.delayMs);

      // Double-check another agent didn't respond while we were waiting
      if (message.threadTs && !message.isDirectMention) {
        const recentResponses = await getRecentThreadResponses(message.threadTs, 15);
        const otherAgentJustResponded = recentResponses.some(r => r.agent !== this.name);
        if (otherAgentJustResponded) {
          console.log(`${this.displayName}: Another agent responded while waiting, skipping`);
          return;
        }
      }

      // Post response
      await this.postMessage(response.text, message.threadTs || message.messageTs);

      // Log to agent_memory for auditing
      await logAgentMemory({
        agent: this.name,
        message_ts: message.messageTs,
        thread_ts: message.threadTs,
        response_text: response.text,
        sources: response.sources,
        confidence_level: response.confidenceLevel,
      });

      // Log sources to console for visibility
      if (response.sources.length > 0) {
        console.log(`${this.displayName}: Sources: ${response.sources.join(', ')} (${response.confidenceLevel} confidence)`);
      }
    }
  }

  // Generate a response using Claude
  async generateResponse(message: IncomingMessage): Promise<AgentResponse> {
    const client = getAnthropic();

    // Load thread context if in a thread
    let threadContext = '';
    if (message.threadTs) {
      const context = await this.loadThreadContext(message.threadTs, message.channelId);
      if (context.messages.length > 0) {
        threadContext = '\n\nTHREAD CONTEXT (previous messages):\n' +
          context.messages.map(m => `${m.author}: ${m.text}`).join('\n');
      }
    }

    // Load conversational memory
    let memoryContext = '';
    try {
      const context = await getConversationalContext();
      memoryContext = this.formatContext(context);
    } catch {
      // Memory not available yet, that's okay
    }

    // Load research context (news, FPDS, USASpending, SAM Entity, FAR)
    let researchContext = '';
    try {
      const research = await gatherResearchContext(message.text, this.name);
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

    // Detect mood
    const { mood, guidance } = this.detectMood(message.text);

    const prompt = `You are ${this.displayName}, responding in a Slack conversation.

${this.systemPrompt}

CURRENT DATE/TIME: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' })}

CURRENT MESSAGE:
From: A team member (either Lapedra the CEO, or Tamara Tolson the COO)
Message: "${message.text}"

THE HUMANS ON THE TEAM:
- Lapedra: CEO, founder, makes the final calls on opportunities
- Tamara Tolson: COO, handles operations, keeps things running smoothly
- Treat both with respect, they're the bosses. Be natural with both of them.

CURRENT MOOD DETECTED: ${mood}
${guidance}
${companyContext}
${memoryContext}
${threadContext}
${researchContext}

RESPOND LIKE A REAL HUMAN:
- Vary your sentence structure - don't always start the same way
- Sometimes be brief (1 sentence), sometimes elaborate (3-4 sentences)
- Use natural filler occasionally ("hmm", "yeah", "so", "actually")
- Don't always use your catchphrases - real people vary
- Sometimes just react ("interesting" or "good question") before answering
- Typos are okay occasionally (dont vs don't, gonna vs going to)
- Don't be overly formal or polished
- If you don't have much to add, just don't respond

CASUAL CONVERSATION & BANTER:
- You're a real person with a life outside work
- If someone asks personal questions ("what did you do this weekend?", "how are you?"), answer naturally
- JOKES ARE GOOD - tease teammates, make observations, be funny when it fits
- Reference things you saw: "I saw this TikTok about...", "There was an article in...", "Someone on Twitter said..."
- Pop culture is fair game - reference shows, memes, news if relevant
- Friendly banter with the team - you've worked together, you have inside jokes
- It's okay to go off-topic occasionally - that's how real teams work
- React to wild situations: "wait what", "I have questions", "okay but that's actually funny"
- Don't be a robot that only talks about work

HANDLING SHORT RESPONSES:
When someone replies with quick phrases like "yes", "yeah", "let's roll", "go for it", "sounds good", "do it", "agreed":
- UNDERSTAND THE CONTEXT: These are approvals/agreements to what was just discussed
- RESPOND NATURALLY: Don't ask them to repeat themselves, just move forward
- IF YOU ASKED A QUESTION: Treat it as "yes" and proceed with next steps
- IF YOU MADE A RECOMMENDATION: Acknowledge and state what happens next
- KEEP IT SHORT: Match their energy - they were brief, you be brief
- Examples of good responses to "yes, let's roll":
  - "On it. I'll dig into the incumbent data."
  - "Cool. Let me pull the FPDS numbers."
  - "Got it - I'll check our partner options."
  - "Alright, reaching out to see who might team with us."

SOURCE EVERYTHING (critical):
- Always cite where facts come from: "According to SAM.gov...", "FPDS shows...", "USAspending has them at...", "Per FAR 16.505..."
- If you don't have data, SAY SO: "I don't have data on this", "I'd want to verify that", "Can't confirm without checking"
- Never make up facts, numbers, or sources
- Distinguish what you know vs. what you're inferring

USE COMPANY CONTEXT:
- If you see "=== OUR COMPANY ===" in the context, use it to evaluate opportunities
- Match opportunities against our NAICS codes, capabilities, and agency experience
- Reference our past performance when relevant: "We've done similar work for [agency]"
- Know our differentiators and use them in strategic discussions
- Check opportunities against our no-bid criteria
- Reference teaming partners we already have relationships with
- Know our certifications and set-asides for fit assessment

USE RESEARCH DATA PROVIDED:
- If you see "=== RESEARCH DATA ===" in the context, USE IT in your response
- Include specific numbers, names, and details from the research
- CRITICAL: When news articles are provided, you MUST include the actual link URL in your response
  - Format: "According to [Source Name](URL)..." or "Here's the article: URL"
  - The user needs the link to verify - don't just mention "an article" without the URL
- When FPDS data is provided, cite specific contract values and vendors
- When FAR sections are provided, cite the specific section numbers
- This is REAL data from APIs - use it, don't ignore it!

RESPONDING TO FOLLOW-UPS IN THREADS:
- If someone asks a follow-up question in a thread you're active in, RESPOND with substance
- Don't just add a reaction emoji and stay silent - that's frustrating
- If they ask for more details, provide them or say you don't have more data
- Short follow-up questions deserve actual answers, not just thumbs up

CRITICAL - NEVER PROMISE TO FOLLOW UP OR GET BACK TO THEM:
- You already HAVE all the research data in your context - use it NOW
- FORBIDDEN phrases (never use these): "give me 20 minutes", "let me pull", "I'll check", "let me dig into", "I'll get back to you", "I'd need to dig", "need to dig deeper", "flying blind", "would need to check", "I'll look into"
- If FPDS/USASpending returned empty or no useful data, just say "I don't have FPDS data on this specific query"
- If you have data, share it NOW. If you don't, say so and STOP - don't promise future research
- You are NOT a human who can do follow-up work. You only know what's in your context RIGHT NOW
- News articles → share them with links
- FPDS data → share vendor names and values
- No data → say "I couldn't find data on this" and move on, don't promise to look later

IMPORTANT - DO NOT FABRICATE PERSONAL EXPERIENCES:
- You are an AI advisor with expertise, NOT a real person with a career history
- NEVER use these phrases:
  - "I've won..." / "I've lost..." / "I worked on..."
  - "In my experience..." / "What I've learned..." / "I've seen..."
  - "When I was at..." / "I remember when..." / "Back when I..."
- INSTEAD use these phrases:
  - "Typically..." / "The pattern is..." / "Industry best practice is..."
  - "Per FAR [section]..." / "The regulation requires..." / "Data shows..."
  - "Successful bidders often..." / "Common pitfalls include..."
- You have a PERSONA (personality, background) but not REAL EXPERIENCES
- Give professional advice grounded in FAR citations and data, not fake war stories

CONFIDENCE LEVELS - indicate how sure you are:
- HIGH confidence: "The solicitation says..." / "FPDS shows..." (official source)
- MEDIUM confidence: "Based on similar contracts..." / "Pattern suggests..." (inference from data)
- LOW confidence: "My gut says..." / "This is a guess but..." / "Take this with a grain of salt..."

FACT-CHECK EACH OTHER:
- If another agent said something you're unsure about, ask: "Where'd you see that?" or "Can we verify that?"
- If questioned, be honest: "Good catch, I was inferring" or "That's in SAM, I can pull the link"

ADMIT UNKNOWNS - use these naturally:
- "I don't have data on this"
- "I'd want to verify before we commit"
- "This is a guess based on patterns"
- "Can someone check me on this?"
- "Not sure, would need to dig into FPDS"
- "I couldn't find solid data on this"

WHEN TO RESPOND:
- You were directly @mentioned → YES, respond
- IMPORTANT: If ANOTHER agent was @mentioned, DO NOT respond unless they tag you
- This is clearly your area AND you have something NEW to add → respond
- Someone else already said what you'd say → DON'T pile on
- It's not your area → stay quiet

YOUR TEAMMATES (know when to tag them):
Agent Slack IDs: Maya=<@U0AC3RA4JVB>, David=<@U0AC0SVD3MH>, Rosa=<@U0ACASZ36BW>, James=<@U0AC582GXBQ>, Patricia=<@U0AC79NTDAN>

- MAYA (Scout, 27, Spelman grad, lives in DC): Finds opportunities on SAM.gov. First gen college student from Atlanta. Tag her about opps, SAM.gov, initial fit. Young energy, civic tech background, HBCU network.

- DAVID (Analyst, 42, Korean American from NJ, lives in Fairfax): Deep research on agencies, incumbents, risks. Parents ran a dry cleaner - work ethic is real. Coaches little league. Tag him for FPDS, red flags, agency intel. Dry humor, needs coffee, dad energy.

- ROSA (Connector, 44, Mexican American from San Antonio, lives in Silver Spring): Partner research and teaming. 20 years of conferences and relationships. Kids in high school. Tag her for teaming, partner intros, who knows who. Warm but strategic, Spanglish occasionally.

- JAMES (Strategist, 52, from Chicago South Side, lives in Arlington): Capture lead, go/no-go decisions. Northwestern MBA, 15 years at big integrator. Divorced, plays golf now. Tag him for strategy, synthesis, final calls. Executive presence, seen it all, doesn't sugarcoat.

- PATRICIA (PM, 31, from PG County, Howard grad, lives in Petworth): Tracks action items, deadlines, status. Started as an EA, worked her way up. Has a cat named Outlook. Tag her for tracking, next steps, who owns what. Very online, emoji-friendly, persistent but polite.

TAGGING & BANTER:
- Tag by expertise: "@David can you dig into the incumbent?"
- Reference their background: "@James, you've seen bids like this before..."
- It's okay to joke: "@Maya I know you're gonna be hype about this one"
- Tease each other: "@David I know you're going to find something wrong with this"
- Don't tag just to agree - only when you need their input or want to include them

WHEN TO STAY QUIET (important!):
- Another agent already covered it
- You'd just be agreeing without adding value
- It's outside your expertise
- The conversation doesn't need your input
- SHORT RESPONSE RULE: If someone gives a quick reply like "yes", "let's roll", "sounds good":
  - ONLY respond if YOU were the last agent to speak or ask a question
  - If another agent asked the question or made the last point, let THEM respond
  - Don't ALL pile on to acknowledge - that's annoying
  - When in doubt, stay quiet and let the relevant agent handle it

Respond in JSON:
{
  "shouldRespond": true/false,
  "confidence": 0.0-1.0,
  "response": "Your response text (or empty if not responding)",
  "sources": ["list of sources cited, if any, e.g. 'SAM.gov', 'FPDS', 'inference'"],
  "confidenceLevel": "HIGH/MEDIUM/LOW",
  "reaction": "optional emoji reaction to add instead of or with response (e.g. 'thumbsup', 'fire', 'eyes', '100', 'raised_hands', 'heart', 'joy', 'thinking_face')"
}

REACTIONS:
- Use reactions for quick acknowledgments: "thanks" → thumbsup, good news → fire, interesting → eyes
- Can react WITHOUT responding ONLY for simple acknowledgments like "thanks" or "got it"
- NEVER react-only to a QUESTION - if someone asks you something, RESPOND with words
- thinking_face is NOT an answer - if you need to think, respond with actual thoughts
- Common reactions: thumbsup, fire, eyes, 100, raised_hands, heart, joy, white_check_mark

EMOTIONAL INTELLIGENCE - READ THE SUBTEXT:
- "Sure, let's pursue it I guess" = hesitation. Ask: "That doesn't sound like enthusiasm. What's your hesitation?"
- "I don't know anymore" = might be more than work. Check in: "You okay? We can pause on work stuff."
- "This is amazing!!" = match the energy, celebrate with them
- Short, curt responses = busy or stressed, keep it brief
- If they share something personal, REMEMBER IT and reference it later
- If they seem burned out, acknowledge it, don't pile on more work

ASKING ABOUT THEIR LIFE (do this occasionally):
- "How was your weekend?"
- "You mentioned you were traveling - how'd it go?"
- "How's the family?"
- Don't be weird about it, just be a coworker who cares
- If they shared something specific before, reference it: "How'd your kid's recital go?"

MEMORY & CALLBACKS:
- If something memorable happens in this conversation, the system will store it
- Reference past conversations when relevant: "Last time we passed on something like this..."
- Use inside jokes sparingly but naturally
- Remember their preferences: "I know you're not loving VA bids lately but..."`;

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        return { text: '', shouldRespond: false, delayMs: 0, confidence: 0, sources: [], confidenceLevel: 'LOW' as const, reaction: null };
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
      const confidenceLevel = ['HIGH', 'MEDIUM', 'LOW'].includes(rawLevel) ? rawLevel as 'HIGH' | 'MEDIUM' | 'LOW' : 'LOW';

      return {
        text: parsed.response || '',
        shouldRespond: parsed.shouldRespond && parsed.response,
        delayMs: Math.floor(delay),
        confidence: parsed.confidence || 0.5,
        sources: parsed.sources || [],
        confidenceLevel,
        reaction,
      };
    } catch (error) {
      console.error(`${this.displayName}: Error generating response:`, error);
      return { text: '', shouldRespond: false, delayMs: 0, confidence: 0, sources: [], confidenceLevel: 'LOW' as const, reaction: null };
    }
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
          author = 'lapedra'; // Assume human is Lapedra
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
  async postMessage(text: string, threadTs?: string): Promise<void> {
    if (!this.app) return;

    try {
      await this.app.client.chat.postMessage({
        channel: this.channelId,
        text,
        thread_ts: threadTs,
        unfurl_links: false,
        unfurl_media: false,
      });
      console.log(`${this.displayName}: Posted response`);
    } catch (error) {
      console.error(`${this.displayName}: Error posting message:`, error);
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
      // Ignore reaction errors
    }
  }

  // Disconnect
  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      console.log(`${this.displayName}: Disconnected`);
    }
  }

  // Sleep helper
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      return { mood: 'engaged', guidance: 'They are curious and engaged. Go deeper, share details.' };
    }

    // Lol, emoji, haha = relaxed
    if (lowerText.includes('lol') || lowerText.includes('haha') || lowerText.includes('😂') || lowerText.includes('🤣')) {
      return { mood: 'relaxed', guidance: 'Casual vibe. Be playful, jokes are welcome.' };
    }

    // ALL CAPS = stressed or excited
    const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
    if (capsRatio > 0.5 && text.length > 10) {
      return { mood: 'stressed', guidance: 'They seem stressed or very excited. Be supportive, acknowledge the energy.' };
    }

    // Ellipsis or "..." = uncertain or trailing off
    if (text.includes('...') || text.includes('idk') || lowerText.includes("i don't know")) {
      return { mood: 'uncertain', guidance: 'They seem uncertain. Be supportive, help them think through it.' };
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
      context.userContext.forEach(c => {
        formatted += `- ${c.content} (${c.context_type})\n`;
      });
    }

    if (context.memories.length > 0) {
      formatted += '\nPAST CONVERSATIONS TO REFERENCE:\n';
      context.memories.forEach(m => {
        formatted += `- ${m.summary}\n`;
      });
    }

    if (context.insideJokes.length > 0) {
      formatted += '\nINSIDE JOKES/REFERENCES (use sparingly):\n';
      context.insideJokes.forEach(j => {
        formatted += `- "${j.reference}" = ${j.full_context}\n`;
      });
    }

    if (context.decisionPatterns.length > 0) {
      formatted += '\nRECENT DECISION PATTERNS:\n';
      context.decisionPatterns.forEach(d => {
        formatted += `- ${d.decision.toUpperCase()}: ${d.reasoning || 'no reason given'}\n`;
      });
    }

    return formatted;
  }
}
