import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Video, VideoProcessingOutbox])],
  providers: [VideosRepository],
  exports: [VideosRepository],
})
export class VideosModule {}
