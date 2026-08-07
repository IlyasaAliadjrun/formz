import { Module } from '@nestjs/common';

/**
 * Autentikasi dashboard admin: login, JWT access + refresh token, logout.
 * Endpoint publik (embed) tidak pernah lewat modul ini.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class AuthModule {}
