import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthTokens, AuthenticatedUser } from '@formz/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  type LoginDto,
  type LogoutDto,
  type RefreshDto,
} from './dto/auth.dto';

@Controller('admin/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** POST /admin/auth/login — tukar email + password dengan sepasang token. */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginDto,
  ): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    return this.authService.login(body);
  }

  /**
   * POST /admin/auth/refresh — tukar refresh token dengan pasangan token baru.
   * Refresh token lama langsung dicabut (rotasi), jadi tidak bisa dipakai dua kali.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshDto,
  ): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }> {
    return this.authService.refresh(body.refreshToken);
  }

  /**
   * POST /admin/auth/logout — mencabut refresh token yang dikirim.
   *
   * Access token yang sudah terbit tetap berlaku sampai kedaluwarsa; itu
   * konsekuensi JWT stateless, dan alasan masa berlakunya dibuat pendek (15 menit).
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutDto): Promise<void> {
    await this.authService.logout(body.refreshToken);
  }

  /** GET /admin/auth/me — user yang sedang login beserta role & permission-nya. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
