import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import videoQueueConfig from '../../config/video-queue.config';
import {
  VIDEO_PROCESSING_ATTEMPTS,
  VIDEO_PROCESSING_BACKOFF_MS,
  VIDEO_PROCESSING_JOB,
  VideoProcessingJob,
} from './video-processing-job';

@Injectable()
export class VideoProcessingQueue {
  private readonly logger = new Logger(VideoProcessingQueue.name);
  private client?: Awaited<Queue['client']>;
  private readonly queue: Queue<
    VideoProcessingJob,
    void,
    typeof VIDEO_PROCESSING_JOB
  >;

  constructor(
    @Inject(videoQueueConfig.KEY) config: ConfigType<typeof videoQueueConfig>,
  ) {
    this.queue = new Queue(config.name, {
      connection: {
        host: config.host,
        port: config.port,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        commandTimeout: 5_000,
      },
    });
    this.queue.on('error', () =>
      this.logger.warn('Video queue is unavailable'),
    );
    void this.queue.client
      .then((client) => {
        this.client = client;
      })
      .catch(() => undefined);
  }

  close(): Promise<void> {
    return this.queue.close();
  }

  getJob(videoId: string) {
    this.requireConnection();
    return this.queue.getJob(videoId);
  }

  publish(videoId: string) {
    this.requireConnection();
    return this.queue.add(
      VIDEO_PROCESSING_JOB,
      { version: 1, videoId },
      {
        jobId: videoId,
        attempts: VIDEO_PROCESSING_ATTEMPTS,
        backoff: { type: 'exponential', delay: VIDEO_PROCESSING_BACKOFF_MS },
      },
    );
  }
  private requireConnection(): void {
    if (this.client?.status !== 'ready')
      throw new Error('Video queue is not ready');
  }
}
