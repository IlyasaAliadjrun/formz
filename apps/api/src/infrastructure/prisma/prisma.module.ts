import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global supaya modul fitur tinggal inject PrismaService tanpa mengimpor
 * modul ini berulang kali.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
