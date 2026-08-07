import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { FormsModule } from './modules/forms/forms.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { QueueModule } from './modules/queue/queue.module';
import { PermissionsGuard } from './modules/rbac/guards/permissions.guard';
import { RbacModule } from './modules/rbac/rbac.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { StorageModule } from './modules/storage/storage.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // Infrastruktur
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,

    // Auth & RBAC
    RbacModule,
    AuthModule,
    UsersModule,

    // Modul fitur — masih kosong, diisi di part berikutnya
    FormsModule,
    SubmissionsModule,
    IntegrationsModule,
    ReportingModule,
    StorageModule,
    QueueModule,
  ],
  providers: [
    // Urutan penting: autentikasi dulu (mengisi request.user), baru otorisasi.
    // Keduanya global supaya endpoint baru tertutup secara default (fail closed).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
