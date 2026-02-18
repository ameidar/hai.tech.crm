import crypto from 'crypto';
import { NotFoundError, UnauthorizedError } from '../../../common/errors/index.js';
import { apiKeysRepository, ApiKeysRepository, ApiKeyFilters, PaginationParams } from '../repositories/api-keys.repository.js';
import { CreateApiKeyInput, UpdateApiKeyInput, ApiKeyScope } from '../validators/api-keys.js';

/**
 * API Key response (without sensitive data)
 */
export interface ApiKeyResponse {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimit: number;
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  createdBy: {
    id: string;
    email: string;
    name: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * API Key creation response (includes the raw key, shown only once)
 */
export interface CreateApiKeyResponse extends ApiKeyResponse {
  key: string; // The raw API key - only shown on creation!
}

/**
 * Validated API Key (for auth middleware)
 */
export interface ValidatedApiKey {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  createdBy: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

/**
 * API Keys Service - Business logic for API key management
 */
export class ApiKeysService {
  private readonly KEY_PREFIX = 'haitech_';
  private readonly KEY_LENGTH = 32; // 32 bytes = 64 hex chars

  constructor(private repository: ApiKeysRepository) {}

  /**
   * Generate a secure random API key
   */
  private generateKey(): { key: string; hash: string; prefix: string } {
    // Generate random bytes
    const randomBytes = crypto.randomBytes(this.KEY_LENGTH);
    const randomPart = randomBytes.toString('hex');
    
    // Create full key with prefix
    const key = `${this.KEY_PREFIX}${randomPart}`;
    
    // Hash the key for storage
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    
    // Prefix for quick lookups (first 8 chars after prefix)
    const prefix = `${this.KEY_PREFIX}${randomPart.substring(0, 8)}`;
    
    return { key, hash, prefix };
  }

  /**
   * Hash an API key for lookup
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Create a new API key
   */
  async create(userId: string, input: CreateApiKeyInput): Promise<CreateApiKeyResponse> {
    const { key, hash, prefix } = this.generateKey();

    const apiKey = await this.repository.create({
      name: input.name,
      keyHash: hash,
      keyPrefix: prefix,
      scopes: input.scopes,
      rateLimit: input.rateLimit,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      createdById: userId,
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      key, // Only returned on creation!
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      isActive: apiKey.isActive,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
      lastUsedIp: apiKey.lastUsedIp,
      createdBy: apiKey.createdBy,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
    };
  }

  /**
   * Get all API keys (paginated)
   */
  async findAll(filters: ApiKeyFilters, pagination: PaginationParams) {
    const { items, total } = await this.repository.findMany(filters, pagination);

    return {
      items: items.map(apiKey => ({
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        rateLimit: apiKey.rateLimit,
        isActive: apiKey.isActive,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        lastUsedIp: apiKey.lastUsedIp,
        createdBy: apiKey.createdBy,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
      })),
      total,
      pagination,
    };
  }

  /**
   * Get an API key by ID
   */
  async findById(id: string): Promise<ApiKeyResponse> {
    const apiKey = await this.repository.findById(id);

    if (!apiKey) {
      throw new NotFoundError('API Key');
    }

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      isActive: apiKey.isActive,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
      lastUsedIp: apiKey.lastUsedIp,
      createdBy: apiKey.createdBy,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
    };
  }

  /**
   * Update an API key
   */
  async update(id: string, input: UpdateApiKeyInput): Promise<ApiKeyResponse> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('API Key');
    }

    const apiKey = await this.repository.update(id, {
      name: input.name,
      scopes: input.scopes,
      rateLimit: input.rateLimit,
      isActive: input.isActive,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      isActive: apiKey.isActive,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
      lastUsedIp: apiKey.lastUsedIp,
      createdBy: apiKey.createdBy,
      createdAt: apiKey.createdAt,
      updatedAt: apiKey.updatedAt,
    };
  }

  /**
   * Delete an API key
   */
  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new NotFoundError('API Key');
    }

    await this.repository.delete(id);
  }

  /**
   * Validate an API key (for auth middleware)
   */
  async validateKey(key: string, clientIp: string): Promise<ValidatedApiKey> {
    // Validate format
    if (!key.startsWith(this.KEY_PREFIX)) {
      throw new UnauthorizedError('Invalid API key format');
    }

    // Hash and lookup
    const hash = this.hashKey(key);
    const apiKey = await this.repository.findByHash(hash);

    if (!apiKey) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Check if active
    if (!apiKey.isActive) {
      throw new UnauthorizedError('API key is disabled');
    }

    // Check expiration
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedError('API key has expired');
    }

    // Update last used (fire and forget)
    this.repository.updateLastUsed(apiKey.id, clientIp).catch(() => {
      // Ignore errors - this is non-critical
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      createdBy: apiKey.createdBy,
    };
  }

  /**
   * Check if an API key has a required scope
   */
  hasScope(apiKey: ValidatedApiKey, requiredScope: ApiKeyScope): boolean {
    // Full access
    if (apiKey.scopes.includes('*')) {
      return true;
    }

    // Exact match
    if (apiKey.scopes.includes(requiredScope)) {
      return true;
    }

    // Wildcard match (e.g., 'read:*' matches 'read:customers')
    const [action] = requiredScope.split(':');
    if (apiKey.scopes.includes(`${action}:*`)) {
      return true;
    }

    return false;
  }
}

export const apiKeysService = new ApiKeysService(apiKeysRepository);
