import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DependencyHealth, HealthResponse } from '@formz/shared';
import type Redis from 'ioredis';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { REDIS_CLIENT } from '../infrastructure/redis/redis.module';

const CHECK_TIMEOUT_MS = 3_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthResponse> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    const allUp = postgres.status === 'up' && redis.status === 'up';

    return {
      status: allUp ? 'ok' : 'degraded',
      service: 'formz-api',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      dependencies: { postgres, redis },
    };
  }

  private async checkPostgres(): Promise<DependencyHealth> {
    return this.measure('postgres', async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });
  }

  private async checkRedis(): Promise<DependencyHealth> {
    return this.measure('redis', async () => {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Balasan PING tidak terduga: ${pong}`);
      }
    });
  }

  private async measure(name: string, probe: () => Promise<void>): Promise<DependencyHealth> {
    const startedAt = Date.now();

    try {
      await withTimeout(probe(), CHECK_TIMEOUT_MS, `${name} tidak merespons dalam 3 detik`);
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Health check ${name} gagal: ${message}`);
      return { status: 'down', latencyMs: Date.now() - startedAt, error: message };
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}
