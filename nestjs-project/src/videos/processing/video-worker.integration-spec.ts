import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { VideoProcessingOutbox } from '../entities/video-processing-outbox.entity';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideoStorageService } from '../video-storage.service';
import { VideosRepository } from '../videos.repository';
import { PROCESSING_FAILED, UNSUPPORTED_VIDEO } from './video-processing-job';
import { VideoWorkerModule } from './video-worker.module';

const exec = promisify(execFile);

async function eventually<T>(
  read: () => Promise<T>,
  matches: (item: T) => boolean,
  label: string,
  timeout = 25_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const item = await read();
    if (matches(item)) return item;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('Video worker (integration)', () => {
  let app: INestApplicationContext;
  let dataSource: DataSource;
  let queue: Queue;
  let client: S3Client;
  let directory: string;
  let fixture: Buffer;
  let channel: Channel;
  const testId = randomUUID();
  const queueName = `video-processing-test-${testId}`;
  const bucket = `video-test-${testId}`;
  const initialBucket = process.env.VIDEO_STORAGE_BUCKET;
  const initialQueue = process.env.VIDEO_QUEUE_NAME;
  const fixtures: Video[] = [];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'streamtube-worker-spec-'));
    const file = join(directory, 'fixture.mp4');
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=96x64:r=10:d=1',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        file,
      ],
      { timeout: 15_000 },
    );
    fixture = await readFile(file);

    process.env.VIDEO_STORAGE_BUCKET = bucket;
    process.env.VIDEO_QUEUE_NAME = queueName;
    app = await NestFactory.createApplicationContext(VideoWorkerModule, {
      logger: false,
      abortOnError: false,
    });
    dataSource = app.get(DataSource);
    queue = new Queue(queueName, {
      connection: {
        host: process.env.VIDEO_REDIS_HOST ?? 'redis',
        port: Number(process.env.VIDEO_REDIS_PORT ?? 6379),
      },
    });
    await queue.waitUntilReady();

    const storage = app.get(VideoStorageService);
    const bootstrapKey = 'videos/initialize.mp4';
    const uploadId = await storage.begin(bootstrapKey, testId);
    await storage.abort(bootstrapKey, uploadId);

    client = new S3Client({
      endpoint: process.env.VIDEO_STORAGE_ENDPOINT ?? 'http://minio:9000',
      region: process.env.VIDEO_STORAGE_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.VIDEO_STORAGE_ACCESS_KEY ?? 'streamtube-dev',
        secretAccessKey:
          process.env.VIDEO_STORAGE_SECRET_KEY ?? 'streamtube-dev-secret',
      },
    });

    const user = await dataSource.getRepository(User).save({
      email: `${testId}@example.test`,
      password: 'fixture-hash',
    });
    channel = await dataSource.getRepository(Channel).save({
      user_id: user.id,
      name: 'Worker test',
      nickname: testId,
    });
  }, 30_000);

  afterAll(async () => {
    try {
      try {
        if (channel) {
          await dataSource.getRepository(Channel).delete(channel.id);
          await dataSource.getRepository(User).delete(channel.user_id);
        }
      } finally {
        await app?.close();
      }
      if (queue) {
        await queue.obliterate({ force: true });
      }
      if (client) {
        const objects = fixtures.flatMap(({ id, original_key }) => [
          { Key: original_key },
          { Key: `videos/${id}/playback.mp4` },
          { Key: `videos/${id}/thumbnail.jpg` },
        ]);
        if (objects.length) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: objects },
            }),
          );
        }
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
    } finally {
      await queue?.close();
      client?.destroy();
      if (directory) await rm(directory, { recursive: true, force: true });
      if (initialBucket === undefined) delete process.env.VIDEO_STORAGE_BUCKET;
      else process.env.VIDEO_STORAGE_BUCKET = initialBucket;
      if (initialQueue === undefined) delete process.env.VIDEO_QUEUE_NAME;
      else process.env.VIDEO_QUEUE_NAME = initialQueue;
    }
  }, 30_000);

  afterEach(async () => {
    // Keep the worker connected until the fixtures finish or are removed.
    for (const video of fixtures) {
      await dataSource.getRepository(Video).delete(video.id);
    }
  });

  async function putOriginal(video: Video, body: Buffer): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: video.original_key,
        Body: body,
        ContentType: 'video/mp4',
      }),
    );
  }

  async function createVideo(
    data: Buffer,
    storeOriginal: boolean,
    published = false,
  ): Promise<Video> {
    const id = randomUUID();
    const videos = dataSource.getRepository(Video);
    const video = await videos.save(
      videos.create({
        id,
        channel_id: channel.id,
        title: 'Worker fixture',
        size_bytes: String(data.length),
        original_key: `videos/${id}/original.mp4`,
        upload_expires_at: new Date(Date.now() + 60_000),
      }),
    );
    fixtures.push(video);
    if (storeOriginal) await putOriginal(video, data);

    await dataSource.transaction(async (manager) => {
      await app.get(VideosRepository).markProcessing(video, manager);
      if (published) {
        await manager.update(
          VideoProcessingOutbox,
          { video_id: id },
          { published_at: new Date() },
        );
      }
    });
    return video;
  }

  function waitForStatus(video: Video, status: VideoStatus) {
    return eventually(
      () => dataSource.getRepository(Video).findOneByOrFail({ id: video.id }),
      (record) => record.status === status,
      status,
    );
  }

  it('recovers a lost queue job and writes faststart playback, JPEG and metadata', async () => {
    const video = await createVideo(fixture, true, true);
    const ready = await waitForStatus(video, VideoStatus.Ready);
    expect(ready).toMatchObject({
      duration_ms: '1000',
      metadata: {
        format: 'mp4',
        width: 96,
        height: 64,
        videoCodec: 'h264',
        audioCodec: 'aac',
      },
      playback_key: `videos/${video.id}/playback.mp4`,
      thumbnail_key: `videos/${video.id}/thumbnail.jpg`,
    });

    const jpeg = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: ready.thumbnail_key! }),
    );
    const jpegBytes = await jpeg.Body?.transformToByteArray();
    expect(jpeg.ContentType).toBe('image/jpeg');
    expect(jpegBytes?.slice(0, 3)).toEqual(Uint8Array.from([0xff, 0xd8, 0xff]));

    const playback = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: ready.playback_key! }),
    );
    const bytes = Buffer.from(
      (await playback.Body?.transformToByteArray()) ?? [],
    );
    const moov = bytes.indexOf('moov');
    expect(moov).toBeGreaterThan(0);
    expect(moov).toBeLessThan(bytes.indexOf('mdat'));

    const job = await eventually(
      () => queue.getJob(video.id),
      (current) => current?.finishedOn !== undefined,
      'completion in Redis',
    );
    expect(job?.attemptsMade).toBe(1);
    expect(await queue.getJobState(video.id)).toBe('completed');
    await queue.add(
      'process-video',
      { version: 1, videoId: video.id },
      { jobId: video.id },
    );
    expect(await queue.getCompletedCount()).toBe(1);
    expect(await queue.getWaitingCount()).toBe(0);
  }, 35_000);

  it('records permanent format errors without retrying', async () => {
    const video = await createVideo(Buffer.from('invalid video'), true);
    const failed = await waitForStatus(video, VideoStatus.Error);
    expect(failed).toMatchObject({
      error_code: UNSUPPORTED_VIDEO,
      playback_key: null,
      thumbnail_key: null,
    });
    const job = await queue.getJob(video.id);
    expect(job?.attemptsMade).toBe(1);
    expect(await job?.getState()).toBe('failed');
  }, 35_000);

  it('retries a transient storage failure and completes once the source is available', async () => {
    const video = await createVideo(fixture, false);
    await eventually(
      () => queue.getJob(video.id),
      (job) => job?.attemptsMade === 1,
      'first attempt failure',
    );
    expect(await queue.getJobState(video.id)).toBe('delayed');
    await putOriginal(video, fixture);
    await waitForStatus(video, VideoStatus.Ready);
    const job = await eventually(
      () => queue.getJob(video.id),
      (current) => current?.finishedOn !== undefined,
      'recovered job completion',
    );
    expect(job?.attemptsMade).toBe(2);
  }, 35_000);

  it('reconciles the final failure after exhausting the three attempts', async () => {
    const video = await createVideo(fixture, false);
    const failed = await waitForStatus(video, VideoStatus.Error);
    expect(failed.error_code).toBe(PROCESSING_FAILED);
    const job = await queue.getJob(video.id);
    expect(job?.attemptsMade).toBe(3);
    expect(await job?.getState()).toBe('failed');
  }, 35_000);
});
