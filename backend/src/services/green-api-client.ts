type GreenApiRole = 'primary' | 'fallback';

interface GreenApiCredentials {
  role: GreenApiRole;
  instanceId: string;
  token: string;
}

interface GreenApiHealth {
  healthy: boolean;
  stateInstance?: string;
  statusInstance?: string;
  error?: string;
}

export interface GreenApiSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  instanceId?: string;
  role?: GreenApiRole;
}

const DEFAULT_HEALTH_CACHE_MS = 60_000;
const healthCacheMs = Number(process.env.GREEN_API_HEALTH_CACHE_MS || DEFAULT_HEALTH_CACHE_MS);
const healthCache = new Map<string, { checkedAt: number; health: GreenApiHealth }>();

function getPrimaryCredentials(): GreenApiCredentials | null {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const token = process.env.GREEN_API_TOKEN;
  if (!instanceId || !token) return null;
  return { role: 'primary', instanceId, token };
}

function getFallbackCredentials(): GreenApiCredentials | null {
  const instanceId = process.env.GREEN_API_FALLBACK_INSTANCE_ID;
  const token = process.env.GREEN_API_FALLBACK_TOKEN;
  if (!instanceId || !token) return null;
  return { role: 'fallback', instanceId, token };
}

function baseUrl(credentials: GreenApiCredentials): string {
  return `https://api.green-api.com/waInstance${credentials.instanceId}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | any }> {
  const response = await fetch(url, init);
  if (typeof (response as any).text !== 'function' && typeof (response as any).json === 'function') {
    return { ok: response.ok, status: response.status || 200, data: await (response as any).json() };
  }

  const text = await response.text();

  try {
    return { ok: response.ok, status: response.status, data: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: response.ok, status: response.status, data: { message: text } };
  }
}

async function checkHealth(credentials: GreenApiCredentials): Promise<GreenApiHealth> {
  const cacheKey = credentials.instanceId;
  const cached = healthCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < healthCacheMs) {
    return cached.health;
  }

  try {
    const [state, status] = await Promise.all([
      fetchJson<{ stateInstance?: string }>(`${baseUrl(credentials)}/getStateInstance/${credentials.token}`),
      fetchJson<{ statusInstance?: string }>(`${baseUrl(credentials)}/getStatusInstance/${credentials.token}`),
    ]);

    const stateInstance = state.data?.stateInstance;
    const statusInstance = status.data?.statusInstance;
    const healthy = state.ok && status.ok && stateInstance === 'authorized' && statusInstance === 'online';
    const health: GreenApiHealth = { healthy, stateInstance, statusInstance };
    healthCache.set(cacheKey, { checkedAt: Date.now(), health });
    return health;
  } catch (error: any) {
    const health: GreenApiHealth = { healthy: false, error: error.message || 'Green API health check failed' };
    healthCache.set(cacheKey, { checkedAt: Date.now(), health });
    return health;
  }
}

async function sendWithCredentials(
  credentials: GreenApiCredentials,
  endpoint: 'sendMessage' | 'sendPoll',
  body: Record<string, unknown>
): Promise<GreenApiSendResult> {
  try {
    const response = await fetchJson<{ idMessage?: string; message?: string }>(
      `${baseUrl(credentials)}/${endpoint}/${credentials.token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );

    if (response.ok && response.data?.idMessage) {
      console.log(`[GreenAPI] ${endpoint} sent via ${credentials.role} ${credentials.instanceId}: ${response.data.idMessage}`);
      return {
        success: true,
        messageId: response.data.idMessage,
        instanceId: credentials.instanceId,
        role: credentials.role,
      };
    }

    const error = response.data?.message || JSON.stringify(response.data) || `HTTP ${response.status}`;
    console.warn(`[GreenAPI] ${endpoint} failed via ${credentials.role} ${credentials.instanceId}: ${error}`);
    return { success: false, error, instanceId: credentials.instanceId, role: credentials.role };
  } catch (error: any) {
    console.warn(`[GreenAPI] ${endpoint} error via ${credentials.role} ${credentials.instanceId}: ${error.message}`);
    return {
      success: false,
      error: error.message || 'Green API send failed',
      instanceId: credentials.instanceId,
      role: credentials.role,
    };
  }
}

function shouldTryFallbackDespiteUncertainState(health: GreenApiHealth): boolean {
  return health.statusInstance === 'online' && !health.stateInstance && !health.error;
}

async function sendWithFallback(
  endpoint: 'sendMessage' | 'sendPoll',
  body: Record<string, unknown>
): Promise<GreenApiSendResult> {
  const primary = getPrimaryCredentials();
  const fallback = getFallbackCredentials();

  if (!primary && !fallback) {
    return { success: false, error: 'Green API not configured' };
  }

  if (primary) {
    const health = await checkHealth(primary);
    if (health.healthy) {
      const primaryResult = await sendWithCredentials(primary, endpoint, body);
      if (primaryResult.success || !fallback) return primaryResult;
      console.warn(`[GreenAPI] retrying ${endpoint} with fallback after primary send failure`);
    } else {
      console.warn(
        `[GreenAPI] primary ${primary.instanceId} skipped: state=${health.stateInstance || 'unknown'} status=${health.statusInstance || 'unknown'} error=${health.error || 'none'}`
      );
      if (!fallback) {
        return {
          success: false,
          error: `Primary Green API unavailable: state=${health.stateInstance || 'unknown'} status=${health.statusInstance || 'unknown'}`,
          instanceId: primary.instanceId,
          role: primary.role,
        };
      }
    }
  }

  if (!fallback) {
    return { success: false, error: 'Green API fallback not configured' };
  }

  const fallbackHealth = await checkHealth(fallback);
  if (!fallbackHealth.healthy) {
    if (shouldTryFallbackDespiteUncertainState(fallbackHealth)) {
      console.warn(
        `[GreenAPI] fallback ${fallback.instanceId} state unknown but status=online; attempting ${endpoint}`
      );
      return sendWithCredentials(fallback, endpoint, body);
    }

    return {
      success: false,
      error: `Fallback Green API unavailable: state=${fallbackHealth.stateInstance || 'unknown'} status=${fallbackHealth.statusInstance || 'unknown'}`,
      instanceId: fallback.instanceId,
      role: fallback.role,
    };
  }

  return sendWithCredentials(fallback, endpoint, body);
}

export async function sendGreenApiMessage(chatId: string, message: string): Promise<GreenApiSendResult> {
  return sendWithFallback('sendMessage', { chatId, message });
}

export async function sendGreenApiPoll(params: {
  chatId: string;
  question: string;
  options: string[];
}): Promise<GreenApiSendResult> {
  return sendWithFallback('sendPoll', {
    chatId: params.chatId,
    message: params.question,
    options: params.options.map((optionName) => ({ optionName })),
    multipleAnswers: false,
  });
}

export function clearGreenApiHealthCacheForTests(): void {
  if (process.env.NODE_ENV === 'test') {
    healthCache.clear();
  }
}
