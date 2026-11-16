import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Redirect,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTemporaryRedirectResponse,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { VideoDeliveryService } from './video-delivery.service';

@ApiTags('videos')
@ApiBadRequestResponse({ type: ApiErrorEnvelope })
@ApiNotFoundResponse({ type: ApiErrorEnvelope })
@ApiServiceUnavailableResponse({ type: ApiErrorEnvelope })
@ApiTemporaryRedirectResponse({
  description: 'URL temporária e pré-assinada do objeto',
  headers: {
    Location: { schema: { type: 'string', format: 'uri' } },
    'Cache-Control': {
      schema: { type: 'string', example: 'private, no-store' },
    },
  },
})
@Controller('videos')
export class VideoMediaController {
  constructor(private readonly delivery: VideoDeliveryService) {}

  @Public()
  @Get(':id/stream')
  @ApiHeader({
    name: 'Range',
    required: false,
    description:
      'Intervalo em bytes. O storage responde 206 para intervalos válidos e 416 para intervalos insatisfazíveis.',
  })
  @Header('Cache-Control', 'private, no-store')
  @Redirect(undefined, 307)
  stream(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ url: string }> {
    return this.delivery.redirect(id, 'stream');
  }

  @Public()
  @Get(':id/thumbnail')
  @Header('Cache-Control', 'private, no-store')
  @Redirect(undefined, 307)
  thumbnail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ url: string }> {
    return this.delivery.redirect(id, 'thumbnail');
  }

  @Public()
  @Get(':id/download')
  @Header('Cache-Control', 'private, no-store')
  @Redirect(undefined, 307)
  download(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ url: string }> {
    return this.delivery.redirect(id, 'download');
  }
}
