import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PERMISSIONS } from '@formz/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RequirePermission } from './decorators/require-permission.decorator';
import {
  createRoleSchema,
  listRolesSchema,
  updateRoleSchema,
  type CreateRoleDto,
  type ListRolesDto,
  type UpdateRoleDto,
} from './dto/roles.dto';
import { RolesService, type RoleResponse } from './roles.service';

/**
 * Pengelolaan role untuk dashboard.
 *
 * Permission-nya `user.manage`, sama dengan manajemen user: siapa pun yang bisa
 * mengubah daftar permission sebuah role sebenarnya bisa memberi dirinya sendiri
 * hak apa pun lewat role itu, jadi memisahkannya jadi permission tersendiri hanya
 * akan menciptakan kesan pembatasan yang tidak benar-benar membatasi.
 */
@Controller('admin/roles')
@RequirePermission('user.manage')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listRolesSchema)) query: ListRolesDto) {
    return this.roles.list(query);
  }

  /**
   * Katalog permission yang bisa dicentang, lengkap dengan deskripsinya.
   *
   * Dashboard sebenarnya bisa mengimpor `PERMISSIONS` langsung dari
   * `@formz/shared`, tapi yang berlaku sesungguhnya adalah isi tabel
   * `permissions` — dan keduanya bisa berbeda kalau seed belum dijalankan setelah
   * katalog bertambah. Endpoint ini melaporkan keduanya sekaligus supaya
   * perbedaan itu terlihat di layar, bukan jadi centang yang gagal disimpan.
   *
   * Harus dideklarasikan sebelum `:id`, karena Express mencocokkan rute sesuai
   * urutan pendaftaran.
   */
  @Get('permissions')
  permissions() {
    return { data: PERMISSIONS };
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RoleResponse> {
    return this.roles.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleDto,
  ): Promise<RoleResponse> {
    return this.roles.create(body);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleDto,
  ): Promise<RoleResponse> {
    return this.roles.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.remove(id);
  }
}
