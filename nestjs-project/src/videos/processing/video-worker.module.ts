import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import databaseConfig from '../../config/database.config';
import videoQueueConfig from '../../config/video-queue.config';
import videoStorageConfig from '../../config/video-storage.config';
import { User } from '../../users/entities/user.entity';
import { Video } from '../entities/video.entity';
import { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { VideoStorageService } from '../video-storage.service';
import { VideosRepository } from '../videos.repository';
import { VideoMediaService } from './video-media.service';
import { VideoOutboxDispatcher } from './video-outbox-dispatcher';
import { VideoProcessingQueue } from './video-processing-queue';
import { VideoProcessor } from './video-processor';
import { VideoWorkerRuntime } from './video-worker-runtime';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, videoStorageConfig, videoQueueConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: db.host,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.name,
        entities: [Video, VideoProcessingOutbox, Channel, User],
        synchronize: false,
      }),
    }),
  ],
  providers: [
    VideoStorageService,
    VideosRepository,
    VideoMediaService,
    VideoOutboxDispatcher,
    VideoProcessingQueue,
    VideoProcessor,
    VideoWorkerRuntime,
  ],
})
export class VideoWorkerModule {}
