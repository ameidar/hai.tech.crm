/**
 * Provider-neutral WhatsApp bot reply generation (OpenAI gpt-4o or Anthropic Claude).
 *
 * Env flags — every default reproduces the pre-existing behavior (a single gpt-4o call):
 *   BOT_LLM_PROVIDER            openai (default) | anthropic
 *   BOT_OPENAI_MODEL            default gpt-4o
 *   BOT_ANTHROPIC_MODEL_STRONG  default claude-sonnet-5   (tier 'strong', and whenever routing is off)
 *   BOT_ANTHROPIC_MODEL_FAST    default claude-haiku-4-5  (tier 'fast' — Jev-routed small talk only)
 *   BOT_LLM_FALLBACK            off (default) | on — when the primary provider fails (429/5xx/timeout/network/
 *                               billing/auth/refusal), call the other provider once. Skipped if its key is missing.
 *   ANTHROPIC_API_KEY           required only for the anthropic provider / fallback.
 *
 * The OpenAI request body is exactly today's: { model, messages: [system(head+tail), ...history], max_tokens: 500,
 * temperature: 0.7 }, with no per-request options unless fallback is on (then a 12s timeout so we can fall back).
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export type LlmProvider = 'openai' | 'anthropic';
export type ModelTier = 'strong' | 'fast';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SystemParts {
  /** Static prefix: system prompt + knowledge base (identical across conversations → cacheable). */
  head: string;
  /** Per-conversation context + anti-loop rule. */
  tail: string;
}

export interface GenerateReplyParams {
  system: SystemParts;
  history: ChatTurn[];
  tier?: ModelTier;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface LlmReplyResult {
  text: string | null;
  provider: LlmProvider;
  model: string;
  usage: LlmUsage | null;
  fellBack: boolean;
}

export const LLM_REPLY_MAX_TOKENS = 500;
export const LLM_REPLY_TEMPERATURE = 0.7;
export const LLM_FALLBACK_TIMEOUT_MS = 12_000;

/** Appended to the cached system block for Claude models only (Haiku/Sonnet emitted **markdown** in the offline run). */
export const CLAUDE_WHATSAPP_FORMAT_NOTE = `
---
## WhatsApp formatting
WhatsApp formatting: no Markdown (no **bold**, no [text](url) links, no # headings). Write plain text and paste URLs as-is.
`;

export function getBotProvider(): LlmProvider {
  return (process.env.BOT_LLM_PROVIDER || '').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
}

export function getOpenAIModel(): string {
  return process.env.BOT_OPENAI_MODEL?.trim() || 'gpt-4o';
}

export function getAnthropicModel(tier: ModelTier): string {
  if (tier === 'fast') return process.env.BOT_ANTHROPIC_MODEL_FAST?.trim() || 'claude-haiku-4-5';
  return process.env.BOT_ANTHROPIC_MODEL_STRONG?.trim() || 'claude-sonnet-5';
}

export function isFallbackEnabled(): boolean {
  const raw = (process.env.BOT_LLM_FALLBACK || '').trim().toLowerCase();
  return raw === 'on' || raw === 'true' || raw === '1';
}

function hasKey(provider: LlmProvider): boolean {
  return Boolean(provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY);
}

let openaiClient: OpenAI | null = null;
let anthropicClient: Anthropic | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: LLM_FALLBACK_TIMEOUT_MS, maxRetries: 1 });
  }
  return anthropicClient;
}

/** Test hook: drop cached SDK clients so env changes / module mocks take effect. */
export function resetLlmClients(): void {
  openaiClient = null;
  anthropicClient = null;
}

/** Thrown when Claude stops with stop_reason=refusal. */
export class LlmRefusalError extends Error {
  constructor(public readonly model: string) {
    super(`Model ${model} refused to answer`);
    this.name = 'LlmRefusalError';
  }
}

/** Thrown when the primary provider failed and the fallback provider failed too. */
export class LlmBothProvidersFailedError extends Error {
  constructor(
    public readonly primaryProvider: LlmProvider,
    public readonly primaryError: unknown,
    public readonly fallbackError: unknown,
  ) {
    super(`Both LLM providers failed (primary=${primaryProvider})`);
    this.name = 'LlmBothProvidersFailedError';
  }
}

// ---------------------------------------------------------------------------
// Request builders (pure — exported for tests)
// ---------------------------------------------------------------------------

export function buildOpenAIRequest(params: GenerateReplyParams, model = getOpenAIModel()) {
  return {
    model,
    messages: [
      { role: 'system' as const, content: params.system.head + params.system.tail },
      ...params.history.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: LLM_REPLY_MAX_TOKENS,
    temperature: LLM_REPLY_TEMPERATURE,
  };
}

/** Anthropic needs a leading user turn and strict alternation: drop leading assistant turns, merge same-role runs. */
export function toAnthropicMessages(history: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const m of history) {
    if (!out.length && m.role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

/** Sonnet 5+ rejects `temperature` and runs adaptive thinking unless disabled (which would eat the 500-token cap). */
function rejectsTemperature(model: string): boolean {
  return /^claude-(sonnet|opus|fable|mythos)-5/.test(model);
}

// SDK 1.x types no longer list `temperature`; Haiku 4.5 still accepts it (offline run used 0.7, matching gpt-4o).
export type AnthropicReplyRequest = Anthropic.MessageCreateParamsNonStreaming & { temperature?: number };

export function buildAnthropicRequest(params: GenerateReplyParams, model: string): AnthropicReplyRequest {
  const body: AnthropicReplyRequest = {
    model,
    max_tokens: LLM_REPLY_MAX_TOKENS,
    system: [
      { type: 'text', text: params.system.head + CLAUDE_WHATSAPP_FORMAT_NOTE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: params.system.tail },
    ],
    messages: toAnthropicMessages(params.history),
  };
  if (rejectsTemperature(model)) body.thinking = { type: 'disabled' };
  else body.temperature = LLM_REPLY_TEMPERATURE;
  return body;
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

async function callOpenAI(params: GenerateReplyParams, withTimeout: boolean): Promise<LlmReplyResult> {
  const body = buildOpenAIRequest(params);
  const completion = withTimeout
    ? await getOpenAI().chat.completions.create(body, { timeout: LLM_FALLBACK_TIMEOUT_MS, maxRetries: 1 })
    : await getOpenAI().chat.completions.create(body);
  const usage = completion.usage
    ? { inputTokens: completion.usage.prompt_tokens, outputTokens: completion.usage.completion_tokens }
    : null;
  return { text: completion.choices[0].message.content || null, provider: 'openai', model: body.model, usage, fellBack: false };
}

async function callAnthropic(params: GenerateReplyParams, tier: ModelTier): Promise<LlmReplyResult> {
  const model = getAnthropicModel(tier);
  const res = await getAnthropic().messages.create(buildAnthropicRequest(params, model));
  if (res.stop_reason === 'refusal') throw new LlmRefusalError(model);
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const u = res.usage;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  return {
    text: text || null,
    provider: 'anthropic',
    model,
    usage: {
      inputTokens: u.input_tokens + cacheRead + cacheWrite,
      outputTokens: u.output_tokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    },
    fellBack: false,
  };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function errStatus(err: any): number | undefined {
  return err?.status ?? err?.statusCode ?? err?.response?.status;
}

function errText(err: any): string {
  return `${err?.code || ''} ${err?.error?.code || ''} ${err?.message || ''} ${err?.error?.message || ''} ${err?.error?.error?.message || ''}`.toLowerCase();
}

/** Anthropic billing problems come back as 400 "credit balance is too low" (or 402/403 billing errors). */
export function isAnthropicCreditError(error: unknown): boolean {
  const status = errStatus(error);
  const text = errText(error);
  return (status === 400 || status === 402 || status === 403) && (text.includes('credit balance') || text.includes('billing'));
}

/** Errors worth retrying on the other provider: refusal, rate limit, 5xx/529, timeout/network, billing or auth. */
export function shouldFallBack(error: unknown): boolean {
  if (error instanceof LlmRefusalError) return true;
  const status = errStatus(error);
  if (status === 401 || status === 403 || status === 408 || status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (isAnthropicCreditError(error)) return true;
  const name = (error as any)?.name || '';
  const text = errText(error);
  return (
    status === undefined &&
    (/timeout|connection/i.test(name) || /timeout|timed out|econnreset|econnrefused|enotfound|socket|network|fetch failed/.test(text))
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Generate one bot reply. Primary provider = BOT_LLM_PROVIDER. `tier` only affects Anthropic (fast = Haiku).
 * Fallback (BOT_LLM_FALLBACK=on): Anthropic → OpenAI model, OpenAI → Claude strong model, once.
 * Throws the primary error when there is no fallback, or LlmBothProvidersFailedError when both failed.
 */
export async function generateReply(params: GenerateReplyParams): Promise<LlmReplyResult> {
  const primary = getBotProvider();
  const tier: ModelTier = params.tier ?? 'strong';
  const fallback: LlmProvider = primary === 'openai' ? 'anthropic' : 'openai';
  const fallbackOn = isFallbackEnabled() && hasKey(fallback);

  try {
    return primary === 'openai' ? await callOpenAI(params, fallbackOn) : await callAnthropic(params, tier);
  } catch (primaryError) {
    if (!fallbackOn || !shouldFallBack(primaryError)) throw primaryError;
    console.warn(
      `[WA][LLM] ${primary} failed (${errStatus(primaryError) ?? (primaryError as any)?.name ?? 'error'}), falling back to ${fallback}`,
    );
    try {
      const res = fallback === 'openai' ? await callOpenAI(params, true) : await callAnthropic(params, 'strong');
      return { ...res, fellBack: true };
    } catch (fallbackError) {
      throw new LlmBothProvidersFailedError(primary, primaryError, fallbackError);
    }
  }
}
