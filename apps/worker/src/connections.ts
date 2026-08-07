import Redis from 'ioredis';
import { Pool } from 'pg';
import { buildDatabaseUrl, buildRedisUrl, env } from './env';
import { createLogger } from './logger';

const logger = createLogger('connections');

/**
 * BullMQ butuh koneksi Redis dengan `maxRetriesPerRequest: null`
 * supaya blocking command (BRPOPLPUSH) tidak di-timeout klien.
 */
export const redis = new Redis(buildRedisUrl(), {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
});

redis.on('error', (error: Error) => logger.error(`Redis error: ${error.message}`));
redis.on('ready', () => logger.info('Redis siap'));

export const pool = new Pool({
  connectionString: buildDatabaseUrl(),
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (error) => logger.error(`Postgres idle client error: ${error.message}`));

export async function verifyConnections(): Promise<void> {
  await pool.query('SELECT 1');
  logger.info(`Postgres terhubung (${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB})`);

  const pong = await redis.ping();
  if (pong !== 'PONG') throw new Error(`Balasan PING Redis tidak terduga: ${pong}`);
  logger.info(`Redis terhubung (${env.REDIS_HOST}:${env.REDIS_PORT})`);
}

export async function closeConnections(): Promise<void> {
  await Promise.allSettled([pool.end(), redis.quit()]);
}
