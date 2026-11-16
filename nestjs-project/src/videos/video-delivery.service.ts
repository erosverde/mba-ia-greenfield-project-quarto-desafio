import { Injectable } from '@nestjs/common';
import { VideoStatus } from './entities/video.entity';
import { VideoNotFoundException } from './video.exceptions';
import { VideoStorageService } from './video-storage.service';
import { VIDEO_SIGNED_URL_TTL_SECONDS } from './video-upload.constants';
import { VideosRepository } from './videos.repository';

type MediaRoute = 'stream' | 'thumbnail' | 'download';

@Injectable()
export class VideoDeliveryService {
  constructor(
    private readonly videos: VideosRepository,
    private readonly storage: VideoStorageService,
  ) {}

  async redirect(id: string, route: MediaRoute): Promise<{ url: string }> {
    const video = await this.videos.findById(id);
    if (!video || video.status !== VideoStatus.Ready)
      throw new VideoNotFoundException();

    const key = {
      stream: video.playback_key,
      thumbnail: video.thumbnail_key,
      download: video.original_key,
    }[route];
    if (!key) throw new VideoNotFoundException();

    return {
      url: await this.storage.signGet(
        key,
        route === 'download'
          ? `attachment; filename="${video.id}.mp4"`
          : 'inline',
        VIDEO_SIGNED_URL_TTL_SECONDS,
      ),
    };
  }
}
