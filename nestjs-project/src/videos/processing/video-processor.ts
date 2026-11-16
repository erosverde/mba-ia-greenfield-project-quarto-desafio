import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import { VideoStatus } from '../entities/video.entity';
import { VideoStorageService } from '../video-storage.service';
import { VideosRepository } from '../videos.repository';
import {
  VideoMediaService,
  UnsupportedVideoError,
} from './video-media.service';
import {
  PROCESSING_FAILED,
  UNSUPPORTED_VIDEO,
  VIDEO_PROCESSING_JOB,
} from './video-processing-job';
import type { VideoProcessingJob } from './video-processing-job';

@Injectable()
export class VideoProcessor {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly videos: VideosRepository,
    private readonly storage: VideoStorageService,
    private readonly media: VideoMediaService,
  ) {}

  async process(job: Job<VideoProcessingJob>, token?: string): Promise<void> {
    const { videoId, version } = job.data;
    if (
      version !== 1 ||
      job.name !== VIDEO_PROCESSING_JOB ||
      job.id !== videoId
    ) {
      throw new UnrecoverableError(PROCESSING_FAILED);
    }
    const video = await this.videos.findById(videoId);
    if (video?.status !== VideoStatus.Processing) return;

    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), 'streamtube-video-'));
      const original = join(directory, 'original.mp4');
      const playback = join(directory, 'playback.mp4');
      const thumbnail = join(directory, 'thumbnail.jpg');

      await this.storage.downloadToFile(video.original_key, original);
      if ((await stat(original)).size !== Number(video.size_bytes))
        throw new Error(PROCESSING_FAILED);

      const { durationMs, metadata } = await this.media.read(
        original,
        thumbnail,
        playback,
      );
      const playbackKey = `videos/${videoId}/playback.mp4`;
      const thumbnailKey = `videos/${videoId}/thumbnail.jpg`;

      await this.storage.uploadFile(
        playbackKey,
        playback,
        'video/mp4',
        videoId,
      );
      await this.storage.uploadFile(
        thumbnailKey,
        thumbnail,
        'image/jpeg',
        videoId,
      );

      if (!token || !(await job.extendLock(token, 30_000)))
        throw new Error(PROCESSING_FAILED);
      await this.videos.markReady(videoId, {
        durationMs,
        metadata,
        playbackKey,
        thumbnailKey,
      });
    } catch (error) {
      if (error instanceof UnsupportedVideoError)
        throw new UnrecoverableError(UNSUPPORTED_VIDEO);
      this.logger.warn(
        `Video ${videoId} processing attempt ${job.attemptsMade + 1} failed`,
      );
      throw new Error(PROCESSING_FAILED);
    } finally {
      if (directory) {
        await rm(directory, { recursive: true, force: true }).catch(() => {
          this.logger.warn(
            `Could not remove temporary files for video ${videoId}`,
          );
        });
      }
    }
  }
}
