import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiUnauthorizedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import {
  StartVideoUploadDto,
  VideoStatusDto,
  VideoUploadPartDto,
  VideoUploadSessionDto,
  VideoUploadStateDto,
} from './dto/video-upload.dto';
import { VideoUploadsService } from './video-uploads.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'JWT ausente ou inválido' })
@Controller('videos')
export class VideosController {
  constructor(private readonly uploads: VideoUploadsService) {}

  @Post('uploads')
  @ApiCreatedResponse({ type: VideoUploadSessionDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelope })
  @ApiNotFoundResponse({ type: ApiErrorEnvelope })
  @ApiServiceUnavailableResponse({ type: ApiErrorEnvelope })
  start(
    @CurrentUser() user: JwtPayload,
    @Body() body: StartVideoUploadDto,
  ): Promise<VideoUploadSessionDto> {
    return this.uploads.start(user.sub, body);
  }

  @Post(':id/uploads/parts/:partNumber')
  @HttpCode(200)
  @Throttle({ default: { limit: 200, ttl: 60_000 } })
  @ApiOkResponse({ type: VideoUploadPartDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelope })
  @ApiNotFoundResponse({ type: ApiErrorEnvelope })
  @ApiConflictResponse({ type: ApiErrorEnvelope })
  @ApiGoneResponse({ type: ApiErrorEnvelope })
  @ApiServiceUnavailableResponse({ type: ApiErrorEnvelope })
  signPart(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('partNumber', new ParseIntPipe()) partNumber: number,
  ): Promise<VideoUploadPartDto> {
    return this.uploads.signPart(user.sub, id, partNumber);
  }

  @Post(':id/uploads/complete')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: VideoUploadStateDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelope })
  @ApiNotFoundResponse({ type: ApiErrorEnvelope })
  @ApiConflictResponse({ type: ApiErrorEnvelope })
  @ApiGoneResponse({ type: ApiErrorEnvelope })
  @ApiServiceUnavailableResponse({ type: ApiErrorEnvelope })
  complete(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<VideoUploadStateDto> {
    return this.uploads.complete(user.sub, id);
  }

  @Get(':id')
  @ApiOkResponse({ type: VideoStatusDto })
  @ApiBadRequestResponse({ type: ApiErrorEnvelope })
  @ApiNotFoundResponse({ type: ApiErrorEnvelope })
  status(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<VideoStatusDto> {
    return this.uploads.status(user.sub, id);
  }
}
