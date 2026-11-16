import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';
import { MAX_VIDEO_BYTES, VideoStatus } from '../entities/video.entity';
import type { VideoMetadata } from '../entities/video.entity';

export class StartVideoUploadDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 200)
  title: string;

  @ApiProperty({ minimum: 1, maximum: MAX_VIDEO_BYTES })
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_BYTES)
  sizeBytes: number;
}

export class VideoUploadStateDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;
}

export class VideoUploadSessionDto extends VideoUploadStateDto {
  @ApiProperty()
  partSizeBytes: number;

  @ApiProperty()
  partCount: number;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt: Date;
}

export class VideoUploadPartDto {
  @ApiProperty()
  url: string;

  @ApiProperty()
  contentLength: number;

  @ApiProperty()
  validForSeconds: number;
}

export class VideoStatusDto extends VideoUploadStateDto {
  @ApiProperty()
  title: string;

  @ApiProperty()
  sizeBytes: number;

  @ApiProperty({ type: Number, nullable: true })
  durationMs: number | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata: VideoMetadata | null;

  @ApiProperty({ type: String, nullable: true })
  errorCode: string | null;

  @ApiProperty({ type: String, nullable: true })
  streamUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  thumbnailUrl: string | null;

  @ApiProperty({ type: String, nullable: true })
  downloadUrl: string | null;
}
