import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, LessThanOrEqual } from 'typeorm';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { Video, VideoStatus } from './entities/video.entity';

@Injectable()
export class VideosRepository {
  constructor(private readonly dataSource: DataSource) {}

  findById(id: string): Promise<Video | null> {
    return this.dataSource.getRepository(Video).findOneBy({ id });
  }

  async createDraft(
    draft: Pick<
      Video,
      | 'id'
      | 'channel_id'
      | 'title'
      | 'size_bytes'
      | 'original_key'
      | 'upload_id'
      | 'upload_expires_at'
    >,
  ): Promise<void> {
    await this.dataSource.getRepository(Video).insert(draft);
  }

  findOwnedBy(id: string, userId: string): Promise<Video | null> {
    return this.dataSource.getRepository(Video).findOneBy({
      id,
      channel: { user_id: userId },
    });
  }

  findExpiredDrafts(deadline: Date): Promise<Video[]> {
    return this.dataSource.getRepository(Video).find({
      select: { id: true },
      where: {
        status: VideoStatus.Draft,
        upload_expires_at: LessThanOrEqual(deadline),
      },
      order: { upload_expires_at: 'ASC', id: 'ASC' },
      take: 100,
    });
  }

  withLockedVideo<T>(
    id: string,
    action: (video: Video | null, manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const video = await manager.findOne(Video, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      return action(video, manager);
    });
  }

  async markProcessing(video: Video, manager: EntityManager): Promise<Video> {
    video.status = VideoStatus.Processing;
    video.upload_id = null;
    await manager.save(Video, video);
    await manager.insert(VideoProcessingOutbox, { video_id: video.id });
    return video;
  }
}
