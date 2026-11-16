import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { Video, VideoStatus } from './entities/video.entity';

@Injectable()
export class VideosRepository {
  constructor(private readonly dataSource: DataSource) {}

  findById(id: string): Promise<Video | null> {
    return this.dataSource.getRepository(Video).findOneBy({ id });
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
