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
import type { AuthenticatedUser } from '@formz/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import {
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
  type CreateUserDto,
  type ListUsersDto,
  type UpdateUserDto,
} from './dto/users.dto';
import { UsersService, type UserResponse } from './users.service';

/**
 * Manajemen user dashboard.
 *
 * Seluruh endpoint di sini butuh permission `user.manage`; decorator dipasang di
 * level class sehingga endpoint baru otomatis ikut terlindungi.
 */
@Controller('admin/users')
@RequirePermission('user.manage')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listUsersSchema)) query: ListUsersDto) {
    return this.usersService.list(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponse> {
    return this.usersService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.create(body);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserDto,
  ): Promise<UserResponse> {
    return this.usersService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.usersService.remove(id, actor.id);
  }
}
