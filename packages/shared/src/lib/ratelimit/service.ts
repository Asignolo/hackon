import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible'
import { createLogger } from '../logger'
import { parseRedisUrl } from '../redis/connection'
import { getTelemetryRuntime } from '../telemetry/runtime'
import type {
  RateLimitConfig,
  RateLimitGlobalConfig,
  RateLimitLeaseConfig,
  RateLimitLeaseResult,
  RateLimitResult,
} from './types'

const logger = createLogger('ratelimit')

/** Narrow interface for the ioredis client — only the methods we actually use. */
interface RedisClient {
  disconnect(): void
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>
}

const ACQUIRE_LEASE_SCRIPT = `
local redisTime = redis.call('TIME')
local nowMs = (tonumber(redisTime[1]) * 1000) + math.floor(tonumber(redisTime[2]) / 1000)
local expiresAt = nowMs + tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', nowMs)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], expiresAt, ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`

const RELEASE_LEASE_SCRIPT = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`

export class RateLimiterService {
  private globalConfig: RateLimitGlobalConfig
  private limiters = new Map<string, RateLimiterMemory | RateLimiterRedis>()
  private redisClient: RedisClient | null = null
  private memoryLeases = new Map<string, Map<string, number>>()

  readonly trustProxyDepth: number

  constructor(globalConfig: RateLimitGlobalConfig) {
    this.globalConfig = globalConfig
    this.trustProxyDepth = globalConfig.trustProxyDepth ?? 0
  }

  async initialize(): Promise<void> {
    if (this.globalConfig.strategy === 'redis' && this.globalConfig.redisUrl) {
      const { default: Redis } = await import('ioredis')
      this.redisClient = new Redis({
        ...parseRedisUrl(this.globalConfig.redisUrl),
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      })
    }
  }

  async consume(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.globalConfig.enabled) {
      return this.disabledResult(config)
    }

    const limiter = this.getOrCreateLimiter(config)

    try {
      const res = await limiter.consume(key, 1)
      return this.toResult(res, true)
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        return this.toResult(error, false)
      }
      logger.error('Rate limiter unavailable, request was not counted', {
        err: error,
        keyPrefix: config.keyPrefix,
        strategy: this.globalConfig.strategy,
      })
      return this.degradedResult(config)
    }
  }

  async get(key: string, config: RateLimitConfig): Promise<RateLimitResult | null> {
    if (!this.globalConfig.enabled) return null

    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.get(key)
    return res ? this.toResult(res, res.remainingPoints > 0) : null
  }

  async delete(key: string, config: RateLimitConfig): Promise<void> {
    if (!this.globalConfig.enabled) return
    const limiter = this.getOrCreateLimiter(config)
    await limiter.delete(key)
  }

  async penalty(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.globalConfig.enabled) {
      return this.disabledResult(config)
    }
    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.penalty(key, points)
    return this.toResult(res, res.remainingPoints > 0)
  }

  async reward(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.globalConfig.enabled) {
      return this.disabledResult(config)
    }
    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.reward(key, points)
    return this.toResult(res, true)
  }

  async block(key: string, durationSec: number, config: RateLimitConfig): Promise<void> {
    if (!this.globalConfig.enabled) return
    const limiter = this.getOrCreateLimiter(config)
    await limiter.block(key, durationSec)
  }

  async acquireLease(
    key: string,
    holderId: string,
    config: RateLimitLeaseConfig,
  ): Promise<RateLimitLeaseResult> {
    if (!this.globalConfig.enabled) return { allowed: false, degraded: true }
    const leaseKey = this.leaseKey(key, config)
    const now = Date.now()
    if (this.globalConfig.strategy === 'redis') {
      if (!this.redisClient) return { allowed: false, degraded: true }
      try {
        const acquired = await this.redisClient.eval(
          ACQUIRE_LEASE_SCRIPT,
          1,
          leaseKey,
          config.limit,
          holderId,
          config.ttlMs,
        )
        return { allowed: Number(acquired) === 1 }
      } catch {
        logger.error('Rate limiter lease acquisition failed', { keyPrefix: config.keyPrefix, strategy: 'redis' })
        getTelemetryRuntime()?.reportError(new Error('[internal] Rate limiter lease acquisition failed.'), {
          module: 'ratelimit',
          code: 'ratelimit.lease_acquisition_failed',
          attributes: { keyPrefix: config.keyPrefix, strategy: 'redis' },
        })
        return { allowed: false, degraded: true }
      }
    }
    const holders = this.memoryLeases.get(leaseKey) ?? new Map<string, number>()
    for (const [activeHolderId, expiresAt] of holders) {
      if (expiresAt <= now) holders.delete(activeHolderId)
    }
    if (holders.size >= config.limit) return { allowed: false }
    holders.set(holderId, now + config.ttlMs)
    this.memoryLeases.set(leaseKey, holders)
    return { allowed: true }
  }

  async releaseLease(key: string, holderId: string, config: RateLimitLeaseConfig): Promise<void> {
    if (!this.globalConfig.enabled) return
    const leaseKey = this.leaseKey(key, config)
    if (this.globalConfig.strategy === 'redis') {
      if (!this.redisClient) return
      try {
        await this.redisClient.eval(RELEASE_LEASE_SCRIPT, 1, leaseKey, holderId)
      } catch {
        logger.error('Rate limiter lease release failed', { keyPrefix: config.keyPrefix, strategy: 'redis' })
        getTelemetryRuntime()?.reportError(new Error('[internal] Rate limiter lease release failed.'), {
          module: 'ratelimit',
          code: 'ratelimit.lease_release_failed',
          attributes: { keyPrefix: config.keyPrefix, strategy: 'redis' },
        })
      }
      return
    }
    const holders = this.memoryLeases.get(leaseKey)
    holders?.delete(holderId)
    if (holders?.size === 0) this.memoryLeases.delete(leaseKey)
  }

  async destroy(): Promise<void> {
    if (this.redisClient) {
      this.redisClient.disconnect()
    }
    this.limiters.clear()
    this.memoryLeases.clear()
  }

  private disabledResult(config: RateLimitConfig): RateLimitResult {
    return { allowed: true, remainingPoints: config.points, msBeforeNext: 0, consumedPoints: 0 }
  }

  private degradedResult(config: RateLimitConfig): RateLimitResult {
    return { ...this.disabledResult(config), degraded: true }
  }

  private getOrCreateLimiter(config: RateLimitConfig): RateLimiterMemory | RateLimiterRedis {
    const cacheKey = `${config.keyPrefix ?? 'default'}:${config.points}:${config.duration}:${config.blockDuration ?? 0}`

    let limiter = this.limiters.get(cacheKey)
    if (limiter) return limiter

    const prefix = [this.globalConfig.keyPrefix, config.keyPrefix].filter(Boolean).join(':')

    const baseOpts = {
      keyPrefix: prefix,
      points: config.points,
      duration: config.duration,
      blockDuration: config.blockDuration ?? 0,
    }

    if (this.globalConfig.strategy === 'redis' && this.redisClient) {
      const insuranceLimiter = new RateLimiterMemory(baseOpts)
      limiter = new RateLimiterRedis({
        ...baseOpts,
        storeClient: this.redisClient,
        insuranceLimiter,
        rejectIfRedisNotReady: false,
      })
    } else {
      limiter = new RateLimiterMemory(baseOpts)
    }

    this.limiters.set(cacheKey, limiter)
    return limiter
  }

  private leaseKey(key: string, config: RateLimitLeaseConfig): string {
    return [this.globalConfig.keyPrefix, config.keyPrefix ?? 'lease', key].filter(Boolean).join(':')
  }

  private toResult(res: RateLimiterRes, allowed: boolean): RateLimitResult {
    return {
      allowed,
      remainingPoints: Math.max(res.remainingPoints, 0),
      msBeforeNext: res.msBeforeNext,
      consumedPoints: res.consumedPoints,
    }
  }
}
