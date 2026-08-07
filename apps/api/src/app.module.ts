import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { FormsModule } from './modules/forms/forms.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { QueueModule } from './modules/queue/queue.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { StorageModule } from './modules/storage/storage.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    // Infrastruktur
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    HealthModule,

    // Modul fitur — masih kosong, diisi di part berikutnya
    AuthModule,
    UsersModule,
    RbacModule,
    FormsModule,
    SubmissionsModule,
    IntegrationsModule,
    ReportingModule,
    StorageModule,
    QueueModule,
  ],
})
export class AppModule {}
