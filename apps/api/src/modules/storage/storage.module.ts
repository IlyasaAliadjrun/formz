import { Module } from '@nestjs/common';

/**
 * File upload ke MinIO (S3-compatible) lewat presigned URL,
 * supaya file besar tidak melewati proses API.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class StorageModule {}
