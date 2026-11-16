import 'dotenv/config';
import {
  AbortMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  S3ServiceException,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplicationContext } from '@nestjs/common';
import { Queue } from 'bullmq';
import { setTimeout as delay } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { VideoWorkerModule } from '../src/videos/processing/video-worker.module';
import { VIDEO_PART_BYTES } from '../src/videos/video-upload.constants';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { User } from '../src/users/entities/user.entity';
import { VideoProcessingOutbox } from '../src/videos/entities/video-processing-outbox.entity';
import {
  MAX_VIDEO_BYTES,
  Video,
  VideoStatus,
} from '../src/videos/entities/video.entity';

interface Session {
  id: string;
  partCount: number;
  partSizeBytes: number;
}

async function measureUpload(): Promise<void> {
  const smoke = process.argv.includes('--smoke');
  const size = smoke ? VIDEO_PART_BYTES + 3 : MAX_VIDEO_BYTES;
  const databaseName = process.env.DB_NAME;
  assert(
    databaseName && databaseName !== 'streamtube',
    'Set DB_NAME to a migrated test database with no running worker',
  );
  const nonce = randomUUID();
  const queueName = `video-limit-${nonce}`;
  process.env.VIDEO_QUEUE_NAME = queueName;
  const bucket = `video-limit-${nonce}`;
  const endpoint = process.env.VIDEO_STORAGE_ENDPOINT ?? 'http://minio:9000';
  process.env.VIDEO_STORAGE_BUCKET = bucket;
  process.env.VIDEO_STORAGE_PUBLIC_ENDPOINT = endpoint;
  const storage = new S3Client({
    endpoint,
    region: process.env.VIDEO_STORAGE_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.VIDEO_STORAGE_ACCESS_KEY ?? 'streamtube-dev',
      secretAccessKey:
        process.env.VIDEO_STORAGE_SECRET_KEY ?? 'streamtube-dev-secret',
    },
  });

  const directory = await mkdtemp(join(tmpdir(), 'streamtube-video-limit-'));
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const dataSource = app.get(DataSource);
  const users = dataSource.getRepository(User);
  const channels = dataSource.getRepository(Channel);
  const videos = dataSource.getRepository(Video);
  let userId: string | undefined;
  let channelId: string | undefined;
  let videoId: string | undefined;
  let worker: INestApplicationContext | undefined;
  try {
    const file = join(directory, 'fixture.mp4');
    await promisify(execFile)(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=s=96x64:r=10:d=1',
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-movflags',
        '+faststart',
        file,
      ],
      { timeout: 15_000 },
    );
    const mp4 = await readFile(file);
    // ISO BMFF free box with a 64-bit length. Stream its padding without storing a source file.
    const box = Buffer.alloc(16);
    box.writeUInt32BE(1, 0);
    box.write('free', 4);
    box.writeBigUInt64BE(BigInt(size - mp4.length), 8);

    const email = `${nonce}@example.test`;
    const user = await users.save({ email, password: 'fixture-hash' });
    userId = user.id;
    const channel = await channels.save({
      name: '10 GB acceptance',
      nickname: nonce,
      user_id: user.id,
    });
    channelId = channel.id;
    const token = await app.get(JwtService).signAsync({ sub: user.id, email });
    const auth = { Authorization: `Bearer ${token}` };
    const startUpload = (sizeBytes: number) =>
      fetch(`${base}/videos/uploads`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '10 GB acceptance', sizeBytes }),
      });

    const aboveLimit = await startUpload(MAX_VIDEO_BYTES + 1);
    assert.equal(aboveLimit.status, 400);
    await aboveLimit.arrayBuffer();
    const accepted = await startUpload(size);
    if (accepted.status !== 201)
      throw new Error(
        `Initiation returned ${accepted.status}: ${await accepted.text()}`,
      );
    const session = (await accepted.json()) as Session;
    videoId = session.id;
    assert.equal(
      (await videos.findOneByOrFail({ id: videoId })).status,
      VideoStatus.Draft,
    );

    const zeroes = new Uint8Array(session.partSizeBytes);
    const first = new Uint8Array(session.partSizeBytes);
    first.set(mp4);
    first.set(box, mp4.length);
    let part = 1;
    let uploaded = 0;
    const upload = async () => {
      while (part <= session.partCount) {
        const number = part++;
        const response = await fetch(
          `${base}/videos/${session.id}/uploads/parts/${number}`,
          {
            method: 'POST',
            headers: auth,
          },
        );
        if (response.status !== 200)
          throw new Error(`Signing part ${number} returned ${response.status}`);
        const { url, contentLength } = (await response.json()) as {
          url: string;
          contentLength: number;
        };
        const bytes = number === 1 ? first : zeroes.subarray(0, contentLength);
        assert.equal(bytes.length, contentLength);
        const result = await fetch(url, {
          method: 'PUT',
          body: bytes,
          signal: AbortSignal.timeout(120_000),
        });
        const detail = await result.text();
        if (!result.ok)
          throw new Error(
            `PUT part ${number} returned ${result.status}: ${detail}`,
          );
        uploaded += bytes.length;
        if (number === 1 || number % 25 === 0 || number === session.partCount) {
          console.log(
            `Part ${number}/${session.partCount}, ${uploaded} bytes accepted`,
          );
        }
      }
    };
    // Wait for both streams to settle before cleaning up a failed upload.
    const results = await Promise.allSettled([upload(), upload()]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure)
      throw new Error('Multipart upload failed', { cause: failure.reason });
    assert.equal(uploaded, size);

    const confirmed = await fetch(
      `${base}/videos/${videoId}/uploads/complete`,
      { method: 'POST', headers: auth },
    );
    if (confirmed.status !== 202)
      throw new Error(
        `Confirmation returned ${confirmed.status}: ${await confirmed.text()}`,
      );
    await confirmed.arrayBuffer();
    const video = await videos.findOneByOrFail({ id: videoId });
    assert.equal(video.status, VideoStatus.Processing);
    assert.equal(
      await dataSource
        .getRepository(VideoProcessingOutbox)
        .countBy({ video_id: videoId }),
      1,
    );
    const head = await storage.send(
      new HeadObjectCommand({ Bucket: bucket, Key: video.original_key }),
    );
    assert.equal(head.ContentLength, size);
    const end = size - 1;
    const tail = await storage.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: video.original_key,
        Range: `bytes=${end - 63}-${end}`,
      }),
    );
    assert.equal(tail.ContentRange, `bytes ${end - 63}-${end}/${size}`);
    assert.deepEqual(
      await tail.Body?.transformToByteArray(),
      new Uint8Array(64),
    );
    if (smoke) {
      worker = await NestFactory.createApplicationContext(VideoWorkerModule, {
        logger: false,
      });
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const processed = await videos.findOneByOrFail({ id: videoId });
        if (processed.status === VideoStatus.Error)
          throw new Error(processed.error_code ?? 'Worker error');
        if (processed.status === VideoStatus.Ready) break;
        await delay(250);
      }
      assert.equal(
        (await videos.findOneByOrFail({ id: videoId })).status,
        VideoStatus.Ready,
      );
      const media = await fetch(`${base}/videos/${videoId}/stream`, {
        headers: { Range: 'bytes=0-7' },
      });
      assert.equal(media.status, 206);
      assert.equal((await media.arrayBuffer()).byteLength, 8);
      const thumbnail = await fetch(`${base}/videos/${videoId}/thumbnail`);
      assert.equal(thumbnail.headers.get('content-type'), 'image/jpeg');
      assert.equal(
        Buffer.from(await thumbnail.arrayBuffer())
          .slice(0, 2)
          .toString('hex'),
        'ffd8',
      );
      console.log('Worker reached READY and served playback and JPEG.');
    }
    console.log(
      JSON.stringify({
        transmittedBytes: uploaded,
        storedBytes: head.ContentLength,
        parts: session.partCount,
        videoStatus: (await videos.findOneByOrFail({ id: videoId })).status,
      }),
    );
  } finally {
    try {
      if (worker) {
        await worker.close();
        const queue = new Queue(queueName, {
          connection: {
            host: process.env.VIDEO_REDIS_HOST ?? 'redis',
            port: Number(process.env.VIDEO_REDIS_PORT ?? 6379),
          },
        });
        try {
          await queue.obliterate({ force: true });
        } finally {
          await queue.close();
        }
      }
      if (videoId) {
        const video = await videos.findOneBy({ id: videoId });
        if (video?.upload_id) {
          await storage.send(
            new AbortMultipartUploadCommand({
              Bucket: bucket,
              Key: video.original_key,
              UploadId: video.upload_id,
            }),
          );
        }
        if (video) {
          await storage.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: video.original_key,
            }),
          );
          for (const artifact of [video.playback_key, video.thumbnail_key]) {
            if (artifact)
              await storage.send(
                new DeleteObjectCommand({ Bucket: bucket, Key: artifact }),
              );
          }
          await videos.delete(video.id);
        }
      }
      await storage
        .send(new DeleteBucketCommand({ Bucket: bucket }))
        .catch((error: unknown) => {
          if (
            !(error instanceof S3ServiceException) ||
            error.$metadata.httpStatusCode !== 404
          )
            throw error;
        });
      if (channelId) await channels.delete(channelId);
      if (userId) await users.delete(userId);
    } finally {
      storage.destroy();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
}

measureUpload().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
