import { Module } from '@nestjs/common';
import { RateLimitModule } from '../../infrastructure/rate-limit/rate-limit.module';
import { FormsModule } from '../forms/forms.module';
import { QueueModule } from '../queue/queue.module';
import { FormOriginGuard } from './guards/form-origin.guard';
import { FormRateLimitGuard } from './guards/form-rate-limit.guard';
import { PublicFormsController } from './public-forms.controller';
import { PublicFormsService } from './public-forms.service';

/**
 * Namespace /public — dipakai form renderer yang di-embed di website lain.
 * Tanpa auth, tanpa akses ke data admin. Perlindungannya bertumpu pada tiga hal:
 * formKey yang tidak bisa ditebak, whitelist domain per form, dan rate limit.
 */
@Module({
  imports: [FormsModule, RateLimitModule, QueueModule],
  controllers: [PublicFormsController],
  providers: [PublicFormsService, FormOriginGuard, FormRateLimitGuard],
  exports: [PublicFormsService],
})
export class PublicModule {}
