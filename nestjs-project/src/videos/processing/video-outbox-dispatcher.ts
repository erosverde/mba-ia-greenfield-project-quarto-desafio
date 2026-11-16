import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { PROCESSING_FAILED, UNSUPPORTED_VIDEO } from './video-processing-job';
import { VideoProcessingQueue } from './video-processing-queue';

const POLL_INTERVAL_MS = 1_000;
const RECONCILE_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 25;

@Injectable()
export class VideoOutboxDispatcher {
  private readonly logger = new Logger(VideoOutboxDispatcher.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly queue: VideoProcessingQueue,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    clearTimeout(this.timer);
    await this.active;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      this.active = this.dispatch()
        .catch(() => {
          this.logger.warn('Could not scan the video outbox');
        })
        .finally(() => {
          if (this.running) this.schedule(POLL_INTERVAL_MS);
        });
    }, delay);
  }

  async dispatch(): Promise<void> {
    const rows = await this.dataSource
      .getRepository(VideoProcessingOutbox)
      .createQueryBuilder('outbox')
      .innerJoin('outbox.video', 'video', 'video.status = :status', {
        status: VideoStatus.Processing,
      })
      .where('outbox.next_attempt_at <= now()')
      .orderBy('outbox.next_attempt_at', 'ASC')
      .addOrderBy('outbox.video_id', 'ASC')
      .take(MAX_BATCH_SIZE)
      .getMany();

    for (const row of rows) await this.reconcile(row.video_id);
  }

  private reconcile(videoId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(VideoProcessingOutbox, {
        where: { video_id: videoId },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });
      if (!row || row.next_attempt_at.getTime() > Date.now()) return;

      const video = await manager.findOneBy(Video, { id: videoId });
      if (video?.status !== VideoStatus.Processing) return;

      try {
        const job = await this.queue.getJob(videoId);
        if (job) {
          const state = await job.getState();
          if (state === 'failed' || state === 'completed') {
            // Terminal state and the job fields are read in separate Redis calls.
            const failedReason =
              state === 'failed'
                ? (await this.queue.getJob(videoId))?.failedReason
                : undefined;
            const errorCode =
              failedReason === UNSUPPORTED_VIDEO
                ? UNSUPPORTED_VIDEO
                : PROCESSING_FAILED;
            await manager.update(
              Video,
              { id: videoId, status: VideoStatus.Processing },
              { status: VideoStatus.Error, error_code: errorCode },
            );
          }
        } else {
          await this.queue.publish(videoId);
        }
      } catch {
        row.attempts += 1;
        const delay = Math.min(
          60_000,
          POLL_INTERVAL_MS * 2 ** Math.min(row.attempts, 6),
        );
        row.next_attempt_at = new Date(Date.now() + delay);
        await manager.save(row);
        this.logger.warn(`Could not publish or reconcile video ${videoId}`);
        return;
      }

      row.published_at ??= new Date();
      row.attempts = 0;
      row.next_attempt_at = new Date(Date.now() + RECONCILE_INTERVAL_MS);
      await manager.save(row);
    });
  }
}
