// Model IDs for Claude API calls. Centralized so model changes touch one file.
// Generation (per-matter narrative writing): claude-sonnet-5
// Single-entry edit operations (expand, shorten, formal, rephrase, translate): claude-haiku-4-5

export const MODELS = {
  generation: 'claude-sonnet-5',
  edit: 'claude-haiku-4-5-20251001',
} as const;

// API configuration
export const API_CONFIG = {
  anthropicApiUrl: 'https://api.anthropic.com/v1/messages',
  anthropicVersion: '2023-06-01',
  maxTokens: 4096,
  // Retry once on parse failure with stricter instruction
  maxRetries: 1,
} as const;
