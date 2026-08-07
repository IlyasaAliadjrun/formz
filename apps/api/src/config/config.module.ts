import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv, type Env } from './env.schema';

/** Token untuk inject object env yang sudah tervalidasi & ter-coerce tipenya. */
export const APP_ENV = Symbol('APP_ENV');

/**
 * Membungkus @nestjs/config sekaligus menyediakan `APP_ENV` — object `Env`
 * yang tipenya sudah pasti, jadi provider lain tidak perlu `config.get()` string-based.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Dijalankan dari apps/api (pnpm --filter) maupun dari root repo.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
  ],
  providers: [
    {
      provide: APP_ENV,
      useFactory: (): Env => validateEnv(process.env),
    },
  ],
  exports: [APP_ENV, ConfigModule],
})
export class AppConfigModule {}
