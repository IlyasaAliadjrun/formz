import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { AuthTokens } from '@formz/shared';
import type Redis from 'ioredis';
import { APP_ENV } from '../../config/config.module';
import type { Env } from '../../config/env.schema';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';

/** Payload access token. `sub` = user id. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
}

/** Payload refresh token. `jti` menjadi kunci sesi di Redis. */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

/** Kunci Redis untuk satu refresh token aktif. */
const sessionKey = (jti: string): string => `auth:refresh:${jti}`;
/** Set berisi seluruh jti aktif milik satu user — dipakai untuk logout-all & revokasi. */
const userSessionsKey = (userId: string): string => `auth:sessions:${userId}`;

/**
 * `expiresIn` di @types/jsonwebtoken bertipe template literal (`15m`, `7d`, ...),
 * sedangkan nilai dari environment selalu `string`. Formatnya sudah divalidasi
 * regex di env.schema.ts saat boot, jadi cast di sini aman.
 */
const signOptions = (secret: string, expiresIn: string): JwtSignOptions =>
  ({ secret, expiresIn }) as JwtSignOptions;

/**
 * Menerbitkan, memutar, dan mencabut token.
 *
 * Refresh token disimpan di Redis (bukan tabel Postgres) karena butuh TTL
 * otomatis dan penghapusan cepat — persis yang disebut ARCHITECTURE.md bagian 3.4
 * soal peran Redis sebagai penyimpan session. Redis di compose sudah `appendonly yes`
 * sehingga sesi tidak hilang saat container restart.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async issueTokens(user: { id: string; email: string }): Promise<AuthTokens> {
    const jti = randomUUID();

    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email } satisfies AccessTokenPayload,
      signOptions(this.env.JWT_SECRET, this.env.JWT_EXPIRES_IN),
    );

    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, jti } satisfies RefreshTokenPayload,
      signOptions(this.env.JWT_REFRESH_SECRET, this.env.JWT_REFRESH_EXPIRES_IN),
    );

    await this.registerSession(user.id, jti, refreshToken);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: await this.secondsUntilExpiry(accessToken, this.env.JWT_SECRET),
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.JWT_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Access token tidak valid atau sudah kedaluwarsa');
    }
  }

  /**
   * Memutar refresh token: token lama langsung dicabut, lalu diterbitkan pasangan baru.
   *
   * Kalau token valid secara kriptografis tapi jti-nya sudah tidak ada di Redis,
   * artinya token itu sudah pernah dipakai — indikasi token dicuri dan diputar ulang.
   * Dalam kasus itu seluruh sesi user dicabut, bukan cuma request ini yang ditolak.
   */
  async rotateRefreshToken(refreshToken: string): Promise<{ userId: string }> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Refresh token tidak valid atau sudah kedaluwarsa');
    }

    const storedUserId = await this.redis.get(sessionKey(payload.jti));

    if (!storedUserId) {
      this.logger.warn(
        `Refresh token dipakai ulang untuk user ${payload.sub} — semua sesi dicabut`,
      );
      await this.revokeAllSessions(payload.sub);
      throw new UnauthorizedException('Refresh token sudah tidak berlaku');
    }

    if (storedUserId !== payload.sub) {
      await this.revokeAllSessions(payload.sub);
      throw new UnauthorizedException('Refresh token tidak cocok dengan pemiliknya');
    }

    await this.revokeSession(payload.sub, payload.jti);

    return { userId: payload.sub };
  }

  /** Logout: mencabut satu sesi yang diwakili refresh token ini. */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.env.JWT_REFRESH_SECRET,
      });
    } catch {
      // Logout bersifat idempotent — token yang sudah kedaluwarsa tetap dianggap sukses.
      return;
    }

    await this.revokeSession(payload.sub, payload.jti);
  }

  /** Mencabut seluruh sesi user, misal saat akunnya dinonaktifkan atau role-nya berubah. */
  async revokeAllSessions(userId: string): Promise<void> {
    const jtis = await this.redis.smembers(userSessionsKey(userId));

    if (jtis.length > 0) {
      await this.redis.del(...jtis.map(sessionKey));
    }

    await this.redis.del(userSessionsKey(userId));
  }

  private async registerSession(userId: string, jti: string, refreshToken: string): Promise<void> {
    const ttlSeconds = await this.secondsUntilExpiry(refreshToken, this.env.JWT_REFRESH_SECRET);

    await this.redis
      .multi()
      .set(sessionKey(jti), userId, 'EX', ttlSeconds)
      .sadd(userSessionsKey(userId), jti)
      // TTL set diperpanjang mengikuti sesi terbaru supaya key ini tidak menumpuk selamanya.
      .expire(userSessionsKey(userId), ttlSeconds)
      .exec();
  }

  private async revokeSession(userId: string, jti: string): Promise<void> {
    await this.redis.multi().del(sessionKey(jti)).srem(userSessionsKey(userId), jti).exec();
  }

  /** Membaca klaim `exp` dari token yang baru dibuat, supaya TTL tidak dihitung dua kali. */
  private async secondsUntilExpiry(token: string, secret: string): Promise<number> {
    const decoded = await this.jwtService.verifyAsync<{ exp: number }>(token, { secret });
    return Math.max(1, decoded.exp - Math.floor(Date.now() / 1000));
  }
}
