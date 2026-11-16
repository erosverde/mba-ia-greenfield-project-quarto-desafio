import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Worker } from 'bullmq';
import videoQueueConfig from '../../config/video-queue.config';
import { VideoOutboxDispatcher } from './video-outbox-dispatcher';
import { VideoProcessingQueue } from './video-processing-queue';
import type { VideoProcessingJob } from './video-processing-job';
import { VideoProcessor } from './video-processor';

@Injectable()
export class VideoWorkerRuntime
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(VideoWorkerRuntime.name);
  private worker?: Worker<VideoProcessingJob, void>;

  constructor(
    @Inject(videoQueueConfig.KEY)
    private readonly config: ConfigType<typeof videoQueueConfig>,
    private readonly processor: VideoProcessor,
    private readonly dispatcher: VideoOutboxDispatcher,
    private readonly queue: VideoProcessingQueue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker<VideoProcessingJob, void>(
      this.config.name,
      (job, token) => this.processor.process(job, token),
      {
        autorun: false,
        concurrency: 1,
        connection: {
          host: this.config.host,
          port: this.config.port,
          maxRetriesPerRequest: null,
        },
      },
    );
    this.worker.on('error', () =>
      this.logger.warn('Video worker queue connection failed'),
    );
    await this.worker.waitUntilReady();
    void this.worker
      .run()
      .catch(() => this.logger.error('Video worker loop stopped'));
    this.dispatcher.start();
    this.logger.log('Video worker and outbox dispatcher are running');
  }

  async beforeApplicationShutdown(): Promise<void> {
    try {
      await this.dispatcher.stop();
      await this.worker?.close();
    } finally {
      await this.queue.close();
    }
  }
}
