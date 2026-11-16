import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import videoStorageConfig from '../config/video-storage.config';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { Video } from './entities/video.entity';
import { VideoDeliveryService } from './video-delivery.service';
import { VideoMediaController } from './video-media.controller';
import { VideoStorageService } from './video-storage.service';
import { VideoUploadsService } from './video-uploads.service';
import { VideosController } from './videos.controller';
import { VideosRepository } from './videos.repository';

@Module({
  imports: [
    ChannelsModule,
    ConfigModule.forFeature(videoStorageConfig),
    TypeOrmModule.forFeature([Video, VideoProcessingOutbox]),
  ],
  controllers: [VideosController, VideoMediaController],
  providers: [
    VideosRepository,
    VideoStorageService,
    VideoUploadsService,
    VideoDeliveryService,
  ],
  exports: [VideosRepository, VideoStorageService],
})
export class VideosModule {}
