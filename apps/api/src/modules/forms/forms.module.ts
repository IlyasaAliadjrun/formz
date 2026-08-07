import { Module } from '@nestjs/common';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';

/**
 * CRUD form + versioning schema (JSONB di PostgreSQL).
 * Endpoint publik untuk form renderer (GET /public/forms/:formKey/schema)
 * menyusul di part embed.
 */
@Module({
  controllers: [FormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
