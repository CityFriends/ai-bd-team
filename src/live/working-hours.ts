/**
 * Working Hours Gate
 *
 * Controls when agents should respond vs. queue messages for later.
 * Prevents agents from responding at 2am, on weekends, or outside
 * configured business hours.
 */

// Configuration
const WORKING_HOURS_CONFIG = {
  timezone: 'America/New_York',
  workdayStart: 9, // 9 AM
  workdayEnd: 18, // 6 PM
  workdays: [1, 2, 3, 4, 5], // Monday = 1, Friday = 5
};

/**
 * Check if current time is within working hours
 *
 * Working hours: Monday-Friday, 9am-6pm Eastern
 * Returns true if agents should respond immediately
 */
export function isWorkingHours(): boolean {
  const now = new Date();

  // Get current time in Eastern timezone
  const options: Intl.DateTimeFormatOptions = {
    timeZone: WORKING_HOURS_CONFIG.timezone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  };

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(now);

  const hourPart = parts.find((p) => p.type === 'hour');
  const weekdayPart = parts.find((p) => p.type === 'weekday');

  if (!hourPart || !weekdayPart) {
    // If we can't determine, default to allowing responses
    return true;
  }

  const hour = parseInt(hourPart.value, 10);
  const weekday = weekdayPart.value;

  // Map weekday string to number (0 = Sunday, 1 = Monday, etc.)
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayNumber = weekdayMap[weekday] ?? -1;

  // Check if it's a workday
  const isWorkday = WORKING_HOURS_CONFIG.workdays.includes(dayNumber);
  if (!isWorkday) {
    return false;
  }

  // Check if within work hours
  const isWithinHours =
    hour >= WORKING_HOURS_CONFIG.workdayStart && hour < WORKING_HOURS_CONFIG.workdayEnd;

  return isWithinHours;
}

/**
 * Check if message contains @urgent tag
 */
export function isUrgentMessage(text: string): boolean {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes('@urgent') ||
    lowerText.includes('urgent:') ||
    lowerText.includes('🚨') ||
    lowerText.includes('asap') ||
    lowerText.includes('emergency')
  );
}

/**
 * Get a human-readable message about when agents will respond
 */
export function getOffHoursMessage(): string {
  const now = new Date();

  // Get current Eastern time info
  const options: Intl.DateTimeFormatOptions = {
    timeZone: WORKING_HOURS_CONFIG.timezone,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const currentTime = formatter.format(now);

  // Calculate next available time
  const nextAvailable = getNextWorkingTime();
  const nextFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: WORKING_HOURS_CONFIG.timezone,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const nextTime = nextFormatter.format(nextAvailable);

  return `It's currently ${currentTime} ET (outside working hours). The team will respond ${nextTime} ET. Use @urgent if this can't wait.`;
}

/**
 * Get the next time that falls within working hours
 */
function getNextWorkingTime(): Date {
  const now = new Date();

  // Convert to Eastern timezone for calculation
  const eastern = new Date(
    now.toLocaleString('en-US', { timeZone: WORKING_HOURS_CONFIG.timezone })
  );

  // Start from next hour
  eastern.setMinutes(0, 0, 0);
  eastern.setHours(eastern.getHours() + 1);

  // Keep advancing until we hit working hours
  for (let i = 0; i < 7 * 24; i++) {
    // Max 1 week search
    const hour = eastern.getHours();
    const day = eastern.getDay();

    const isWorkday = WORKING_HOURS_CONFIG.workdays.includes(day);
    const isWithinHours =
      hour >= WORKING_HOURS_CONFIG.workdayStart && hour < WORKING_HOURS_CONFIG.workdayEnd;

    if (isWorkday && isWithinHours) {
      return eastern;
    }

    // If it's a workday but before work hours, jump to work start
    if (isWorkday && hour < WORKING_HOURS_CONFIG.workdayStart) {
      eastern.setHours(WORKING_HOURS_CONFIG.workdayStart, 0, 0, 0);
      return eastern;
    }

    // Otherwise advance to next day at work start
    eastern.setDate(eastern.getDate() + 1);
    eastern.setHours(WORKING_HOURS_CONFIG.workdayStart, 0, 0, 0);
  }

  return eastern;
}

/**
 * Determine if an agent should respond given working hours constraints
 *
 * @param messageText - The incoming message text
 * @param isDirectMention - Whether the agent was directly @mentioned
 * @returns Object with shouldRespond and optional queueReason
 */
export function checkWorkingHoursGate(
  messageText: string,
  isDirectMention: boolean
): {
  shouldRespond: boolean;
  reason?: string;
  offHoursMessage?: string;
} {
  // Always respond to urgent messages
  if (isUrgentMessage(messageText)) {
    return {
      shouldRespond: true,
      reason: 'Urgent message - overriding working hours',
    };
  }

  // Check if within working hours
  if (isWorkingHours()) {
    return {
      shouldRespond: true,
    };
  }

  // Outside working hours
  // For direct mentions, we want to at least acknowledge
  // but for non-direct mentions, we stay completely silent
  if (isDirectMention) {
    return {
      shouldRespond: false,
      reason: 'Outside working hours (direct mention - will queue)',
      offHoursMessage: getOffHoursMessage(),
    };
  }

  return {
    shouldRespond: false,
    reason: 'Outside working hours',
  };
}
