import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';
import { PublishedFormCacheService } from './published-form-cache.service';

/**
 * CRUD form + versioning schema (JSONB di PostgreSQL).
 *
 * Cache versi terpublish tinggal di sini, bukan di PublicModule, karena yang
 * membatalkannya adalah aksi admin (publish, ubah whitelist, arsip). Menaruhnya
 * dekat dengan penulisnya membuat sulit ada jalur perubahan yang lupa
 * membatalkan cache.
 */
@Module({
  controllers: [FormsController],
  providers: [FormsService, PublishedFormCacheService],
  exports: [FormsService, PublishedFormCacheService],
})
export class FormsModule {}
