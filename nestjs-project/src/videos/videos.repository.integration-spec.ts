import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { createTestDataSource } from '../test/create-test-data-source';
import { VideoProcessingOutbox } from './entities/video-processing-outbox.entity';
import { MAX_VIDEO_BYTES, Video, VideoStatus } from './entities/video.entity';
import { VideosRepository } from './videos.repository';

describe('VideosRepository (integration)', () => {
  let dataSource: DataSource;
  let repository: VideosRepository;
  let videoId: string;
  let userId: string;
  let channelId: string;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [Video, VideoProcessingOutbox, Channel, User],
      { synchronize: false },
    );
    await dataSource.initialize();
    repository = new VideosRepository(dataSource);
  });

  beforeEach(async () => {
    const user = await dataSource.getRepository(User).save({
      email: `${randomUUID()}@example.test`,
      password: 'fixture-hash',
    });
    userId = user.id;
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Video integration',
      nickname: randomUUID(),
      user_id: userId,
    });
    channelId = channel.id;
    videoId = randomUUID();
    await dataSource.getRepository(Video).insert({
      id: videoId,
      title: 'Example',
      size_bytes: String(MAX_VIDEO_BYTES),
      channel_id: channelId,
      original_key: `videos/${videoId}/original.mp4`,
      upload_expires_at: new Date(Date.now() + 60_000),
    });
  });

  afterEach(async () => {
    await dataSource.getRepository(Video).delete(videoId);
    await dataSource.getRepository(Channel).delete(channelId);
    await dataSource.getRepository(User).delete(userId);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('stores a 10 GB draft linked to its channel', async () => {
    await expect(repository.findById(videoId)).resolves.toMatchObject({
      status: VideoStatus.Draft,
      channel_id: channelId,
      size_bytes: '10000000000',
    });
  });

  it('enforces the size limit, channel foreign key and unique ID', async () => {
    const draft = await dataSource.getRepository(Video).findOneByOrFail({
      id: videoId,
    });
    const videos = dataSource.getRepository(Video);
    await expect(videos.insert(draft)).rejects.toMatchObject({ code: '23505' });
    await expect(
      videos.insert({ ...draft, id: randomUUID(), channel_id: randomUUID() }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      videos.insert({ ...draft, id: randomUUID(), size_bytes: '10000000001' }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('commits status and outbox intent together and rolls both back on failure', async () => {
    const operation = async (fail: boolean) =>
      repository.withLockedVideo(videoId, async (video, manager) => {
        if (!video) throw new Error('Missing fixture');
        await repository.markProcessing(video, manager);
        if (fail) throw new Error('rollback');
      });

    const outbox = dataSource.getRepository(VideoProcessingOutbox);
    await expect(operation(true)).rejects.toThrow('rollback');
    await expect(repository.findById(videoId)).resolves.toMatchObject({
      status: VideoStatus.Draft,
    });
    await expect(outbox.countBy({ video_id: videoId })).resolves.toBe(0);

    await operation(false);
    await expect(repository.findById(videoId)).resolves.toMatchObject({
      status: VideoStatus.Processing,
    });
    await expect(outbox.countBy({ video_id: videoId })).resolves.toBe(1);
  });
});
