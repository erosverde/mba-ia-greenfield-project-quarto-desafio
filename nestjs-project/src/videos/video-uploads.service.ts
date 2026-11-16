import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ChannelsService } from '../channels/channels.service';
import {
  StartVideoUploadDto,
  VideoStatusDto,
  VideoUploadPartDto,
  VideoUploadSessionDto,
  VideoUploadStateDto,
} from './dto/video-upload.dto';
import { Video, VideoStatus } from './entities/video.entity';
import {
  VideoNotFoundException,
  VideoPartInvalidException,
  VideoUploadExpiredException,
  VideoUploadIncompleteException,
  VideoUploadStateException,
} from './video.exceptions';
import { VideoStorageService } from './video-storage.service';
import {
  VIDEO_PART_BYTES,
  VIDEO_SIGNED_URL_TTL_SECONDS,
  VIDEO_UPLOAD_TTL_MS,
  videoPartCount,
  videoPartLength,
} from './video-upload.constants';
import { VideosRepository } from './videos.repository';

@Injectable()
export class VideoUploadsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoUploadsService.name);
  private expiryTimer?: NodeJS.Timeout;

  constructor(
    private readonly videos: VideosRepository,
    private readonly channels: ChannelsService,
    private readonly storage: VideoStorageService,
  ) {}

  onModuleInit(): void {
    // The loop checks a bounded set and schedules another tick only after completion.
    this.expiryTimer = setTimeout(
      () => void this.expireAndReschedule(),
      60_000,
    ).unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
  }

  private async expireAndReschedule(): Promise<void> {
    try {
      await this.expireUploads();
    } catch {
      this.logger.warn('Could not scan expired video uploads');
    } finally {
      if (this.expiryTimer) this.onModuleInit();
    }
  }

  async start(
    userId: string,
    input: StartVideoUploadDto,
  ): Promise<VideoUploadSessionDto> {
    const channel = await this.channels.findByUserId(userId);
    if (!channel) throw new VideoNotFoundException();
    const id = randomUUID();
    const originalKey = `videos/${id}/original.mp4`;
    const expiresAt = new Date(Date.now() + VIDEO_UPLOAD_TTL_MS);
    const uploadId = await this.storage.begin(originalKey, id);
    try {
      await this.videos.createDraft({
        id,
        title: input.title,
        channel_id: channel.id,
        size_bytes: String(input.sizeBytes),
        original_key: originalKey,
        upload_id: uploadId,
        upload_expires_at: expiresAt,
      });
    } catch (error) {
      try {
        await this.storage.abort(originalKey, uploadId);
      } catch {
        this.logger.warn(`Could not abort multipart upload for video ${id}`);
      }
      throw error;
    }

    return {
      id,
      status: VideoStatus.Draft,
      partSizeBytes: VIDEO_PART_BYTES,
      partCount: videoPartCount(input.sizeBytes),
      expiresAt,
    };
  }

  async signPart(
    userId: string,
    id: string,
    partNumber: number,
  ): Promise<VideoUploadPartDto> {
    const video = await this.requireOwnedVideo(userId, id);
    const uploadId = this.requireOpenUpload(video);
    const size = Number(video.size_bytes);
    if (
      !Number.isSafeInteger(partNumber) ||
      partNumber < 1 ||
      partNumber > videoPartCount(size)
    ) {
      throw new VideoPartInvalidException();
    }
    const contentLength = videoPartLength(size, partNumber);
    const validForSeconds = Math.min(
      VIDEO_SIGNED_URL_TTL_SECONDS,
      Math.floor((video.upload_expires_at.getTime() - Date.now()) / 1000),
    );
    if (validForSeconds < 1) throw new VideoUploadExpiredException();

    const url = await this.storage.signPart(
      video.original_key,
      uploadId,
      partNumber,
      contentLength,
      validForSeconds,
    );
    return { url, contentLength, validForSeconds };
  }

  async complete(userId: string, id: string): Promise<VideoUploadStateDto> {
    const current = await this.requireOwnedVideo(userId, id);
    return this.videos.withLockedVideo(id, async (video, manager) => {
      if (!video || video.channel_id !== current.channel_id) {
        throw new VideoNotFoundException();
      }
      if (
        video.status === VideoStatus.Error &&
        video.error_code === 'VIDEO_UPLOAD_EXPIRED'
      ) {
        throw new VideoUploadExpiredException();
      }
      if (video.status !== VideoStatus.Draft) {
        return { id, status: video.status };
      }

      if (!(await this.hasCompletedObject(video))) {
        const uploadId = this.requireOpenUpload(video);
        const size = Number(video.size_bytes);
        const parts = await this.storage.listParts(
          video.original_key,
          uploadId,
        );
        if (!parts || parts.length !== videoPartCount(size)) {
          throw new VideoUploadIncompleteException();
        }

        parts.sort((a, b) => a.partNumber - b.partNumber);
        if (
          parts.some(
            (part, index) =>
              part.partNumber !== index + 1 ||
              part.size !== videoPartLength(size, part.partNumber),
          )
        ) {
          throw new VideoUploadIncompleteException();
        }

        await this.storage.complete(video.original_key, uploadId, parts);
        if (!(await this.hasCompletedObject(video))) {
          throw new VideoUploadIncompleteException();
        }
      }

      await this.videos.markProcessing(video, manager);
      return { id, status: video.status };
    });
  }

  async status(userId: string, id: string): Promise<VideoStatusDto> {
    const video = await this.requireOwnedVideo(userId, id);
    return {
      id,
      title: video.title,
      status: video.status,
      sizeBytes: Number(video.size_bytes),
      durationMs: video.duration_ms === null ? null : Number(video.duration_ms),
      metadata: video.metadata,
      errorCode: video.error_code,
      streamUrl:
        video.status === VideoStatus.Ready ? `/videos/${id}/stream` : null,
      thumbnailUrl:
        video.status === VideoStatus.Ready ? `/videos/${id}/thumbnail` : null,
      downloadUrl:
        video.status === VideoStatus.Ready ? `/videos/${id}/download` : null,
    };
  }

  async expireUploads(): Promise<void> {
    const drafts = await this.videos.findExpiredDrafts(new Date());
    for (const draft of drafts) {
      try {
        await this.videos.withLockedVideo(draft.id, async (video, manager) => {
          if (
            !video ||
            video.status !== VideoStatus.Draft ||
            video.upload_expires_at.getTime() > Date.now()
          )
            return;

          if (await this.hasCompletedObject(video)) {
            await this.videos.markProcessing(video, manager);
            return;
          }

          if (video.upload_id)
            await this.storage.abort(video.original_key, video.upload_id);
          video.upload_id = null;
          video.status = VideoStatus.Error;
          video.error_code = 'VIDEO_UPLOAD_EXPIRED';
          await manager.save(Video, video);
        });
      } catch {
        this.logger.warn(
          `Could not reconcile expired upload for video ${draft.id}`,
        );
      }
    }
  }

  private async requireOwnedVideo(userId: string, id: string): Promise<Video> {
    const video = await this.videos.findOwnedBy(id, userId);
    if (!video) throw new VideoNotFoundException();
    return video;
  }

  private requireOpenUpload(video: Video): string {
    if (
      video.error_code === 'VIDEO_UPLOAD_EXPIRED' ||
      (video.status === VideoStatus.Draft &&
        video.upload_expires_at.getTime() <= Date.now())
    ) {
      throw new VideoUploadExpiredException();
    }
    if (video.status !== VideoStatus.Draft || !video.upload_id) {
      throw new VideoUploadStateException();
    }
    return video.upload_id;
  }

  private async hasCompletedObject(video: Video): Promise<boolean> {
    const object = await this.storage.head(video.original_key);
    if (!object) return false;
    if (
      object.videoId !== video.id ||
      object.size !== Number(video.size_bytes)
    ) {
      throw new VideoUploadIncompleteException();
    }
    return true;
  }
}
