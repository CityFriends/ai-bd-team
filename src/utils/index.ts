// Get a random delay within a range
export function getRandomDelay(range: [number, number]): number {
  const [min, max] = range;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Format a date for display
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Format a date relative to now
export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return `${Math.abs(diffDays)} days ago`;
  } else if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Tomorrow';
  } else if (diffDays <= 7) {
    return `${diffDays} days`;
  } else if (diffDays <= 14) {
    return '~2 weeks';
  } else if (diffDays <= 30) {
    return '~1 month';
  } else {
    return formatDate(d);
  }
}

// Truncate text with ellipsis
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// Sleep for a given number of milliseconds
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse a currency string to a number range
export function parseEstimatedValue(value: string): { min: number; max: number } | null {
  if (!value) return null;

  // Remove $ and commas
  const cleaned = value.replace(/[$,]/g, '');

  // Handle ranges like "5M-10M" or "5-10M"
  const rangeMatch = cleaned.match(
    /(\d+(?:\.\d+)?)\s*[MmKk]?\s*[-–]\s*(\d+(?:\.\d+)?)\s*([MmKk])?/
  );
  if (rangeMatch) {
    const multiplier = getMultiplier(rangeMatch[3] || rangeMatch[1].slice(-1));
    return {
      min: parseFloat(rangeMatch[1]) * multiplier,
      max: parseFloat(rangeMatch[2]) * multiplier,
    };
  }

  // Handle single values like "10M"
  const singleMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*([MmKk])?/);
  if (singleMatch) {
    const multiplier = getMultiplier(singleMatch[2]);
    const value = parseFloat(singleMatch[1]) * multiplier;
    return { min: value, max: value };
  }

  return null;
}

function getMultiplier(suffix?: string): number {
  switch (suffix?.toUpperCase()) {
    case 'M':
      return 1000000;
    case 'K':
      return 1000;
    default:
      return 1;
  }
}

// Format a number as currency
export function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  } else {
    return `$${value.toFixed(0)}`;
  }
}

// Check if a string looks like a valid email
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Sanitize text for Slack markdown
export function sanitizeForSlack(text: string): string {
  // Escape special characters that might interfere with Slack formatting
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Generate a simple hash for deduplication
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
