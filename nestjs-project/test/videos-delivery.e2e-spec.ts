import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { User } from '../src/users/entities/user.entity';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

const exec = promisify(execFile);

describe('Video delivery (e2e)', () => {
  const id = randomUUID();
  const pendingId = randomUUID();
  const bucket = `video-delivery-test-${id}`;
  const endpoint = process.env.VIDEO_STORAGE_ENDPOINT ?? 'http://minio:9000';
  const keys = {
    original: `videos/${id}/original.mp4`,
    playback: `videos/${id}/playback.mp4`,
    thumbnail: `videos/${id}/thumbnail.jpg`,
  };
  const routes = {
    streamUrl: `/videos/${id}/stream`,
    thumbnailUrl: `/videos/${id}/thumbnail`,
    downloadUrl: `/videos/${id}/download`,
  };
  const initialBucket = process.env.VIDEO_STORAGE_BUCKET;
  const initialEndpoint = process.env.VIDEO_STORAGE_PUBLIC_ENDPOINT;
  let app: INestApplication<App>;
  let apiUrl: string;
  let database: DataSource;
  let storage: S3Client;
  let directory: string;
  let channel: Channel;
  let ownerToken: string;
  let original: Buffer;
  let playback: Buffer;
  let thumbnail: Buffer;

  beforeAll(async () => {
    process.env.VIDEO_STORAGE_BUCKET = bucket;
    process.env.VIDEO_STORAGE_PUBLIC_ENDPOINT = endpoint;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.listen(0, '127.0.0.1');
    apiUrl = await app.getUrl();
    database = app.get(DataSource);

    directory = await mkdtemp(join(tmpdir(), 'streamtube-delivery-spec-'));
    const originalFile = join(directory, 'original.mp4');
    const playbackFile = join(directory, 'playback.mp4');
    const thumbnailFile = join(directory, 'thumbnail.jpg');
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
        '-c:v',
        'libx264',
        '-threads',
        '1',
        originalFile,
      ],
      { timeout: 15_000 },
    );
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-i',
        originalFile,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        playbackFile,
      ],
      { timeout: 15_000 },
    );
    await exec(
      'ffmpeg',
      [
        '-nostdin',
        '-v',
        'error',
        '-i',
        originalFile,
        '-frames:v',
        '1',
        '-threads',
        '1',
        '-update',
        '1',
        thumbnailFile,
      ],
      { timeout: 15_000 },
    );
    [original, playback, thumbnail] = await Promise.all([
      readFile(originalFile),
      readFile(playbackFile),
      readFile(thumbnailFile),
    ]);

    storage = new S3Client({
      endpoint,
      region: process.env.VIDEO_STORAGE_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.VIDEO_STORAGE_ACCESS_KEY ?? 'streamtube-dev',
        secretAccessKey:
          process.env.VIDEO_STORAGE_SECRET_KEY ?? 'streamtube-dev-secret',
      },
    });
    await storage.send(new CreateBucketCommand({ Bucket: bucket }));
    await Promise.all([
      storage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.original,
          Body: original,
          ContentType: 'video/mp4',
        }),
      ),
      storage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.playback,
          Body: playback,
          ContentType: 'video/mp4',
        }),
      ),
      storage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.thumbnail,
          Body: thumbnail,
          ContentType: 'image/jpeg',
        }),
      ),
    ]);

    const email = `${id}@example.test`;
    const owner = await database
      .getRepository(User)
      .save({ email, password: 'fixture-hash' });
    channel = await database
      .getRepository(Channel)
      .save({ name: 'Media test', nickname: id, user_id: owner.id });
    ownerToken = await app.get(JwtService).signAsync({ sub: owner.id, email });
    const base = {
      channel_id: channel.id,
      title: 'Media test',
      size_bytes: String(original.length),
      upload_expires_at: new Date(),
    };
    await database.getRepository(Video).insert([
      {
        ...base,
        id,
        status: VideoStatus.Ready,
        original_key: keys.original,
        playback_key: keys.playback,
        thumbnail_key: keys.thumbnail,
      },
      {
        ...base,
        id: pendingId,
        status: VideoStatus.Draft,
        original_key: `videos/${pendingId}/original.mp4`,
      },
    ]);
  }, 45_000);

  afterAll(async () => {
    try {
      if (channel) {
        await database.getRepository(Video).delete([id, pendingId]);
        await database.getRepository(Channel).delete(channel.id);
        await database.getRepository(User).delete(channel.user_id);
      }
      if (storage) {
        await storage.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: Object.values(keys).map((Key) => ({ Key })) },
          }),
        );
        await storage.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
    } finally {
      storage?.destroy();
      await app?.close();
      if (directory) await rm(directory, { recursive: true, force: true });
      if (initialBucket === undefined) delete process.env.VIDEO_STORAGE_BUCKET;
      else process.env.VIDEO_STORAGE_BUCKET = initialBucket;
      if (initialEndpoint === undefined)
        delete process.env.VIDEO_STORAGE_PUBLIC_ENDPOINT;
      else process.env.VIDEO_STORAGE_PUBLIC_ENDPOINT = initialEndpoint;
    }
  });

  it('returns 404 for unpublished media and exposes stable routes only in READY', async () => {
    const http = request(apiUrl);
    await http.get(`/videos/${id}`).expect(401);
    await http
      .get(`/videos/${id}`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: unknown }) =>
        expect(body).toMatchObject(routes),
      );
    await http
      .get(`/videos/${pendingId}`)
      .auth(ownerToken, { type: 'bearer' })
      .expect(200)
      .expect(({ body }: { body: unknown }) =>
        expect(body).toMatchObject({
          streamUrl: null,
          thumbnailUrl: null,
          downloadUrl: null,
        }),
      );
    for (const status of [
      VideoStatus.Draft,
      VideoStatus.Processing,
      VideoStatus.Error,
    ]) {
      await database.getRepository(Video).update(pendingId, { status });
      for (const media of ['stream', 'thumbnail', 'download']) {
        await http.get(`/videos/${pendingId}/${media}`).expect(404);
      }
    }
    await http.get(`/videos/${randomUUID()}/stream`).expect(404);
  });

  it('follows the public 307 and streams only the requested byte range', async () => {
    const url = apiUrl + routes.streamUrl;
    const redirect = await fetch(url, {
      redirect: 'manual',
      headers: { Range: 'bytes=16-31' },
    });
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get('cache-control')).toBe('private, no-store');
    const signed = new URL(redirect.headers.get('location')!);
    expect(signed.origin).toBe(endpoint);
    expect(signed.pathname).toBe(`/${bucket}/${keys.playback}`);
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).not.toContain(
      'range',
    );
    await redirect.arrayBuffer();

    const partial = await fetch(url, { headers: { Range: 'bytes=16-31' } });
    expect(partial.redirected).toBe(true);
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(
      `bytes 16-31/${playback.length}`,
    );
    expect(partial.headers.get('content-disposition')).toBe('inline');
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(
      playback.subarray(16, 32),
    );

    const unsatisfiable = await fetch(url, {
      headers: { Range: `bytes=${playback.length}-` },
    });
    expect(unsatisfiable.status).toBe(416);
    await unsatisfiable.arrayBuffer();
  });

  it('serves the thumbnail inline and downloads the original bytes as an attachment', async () => {
    const image = await fetch(apiUrl + routes.thumbnailUrl);
    expect(image.status).toBe(200);
    expect(image.redirected).toBe(true);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
    expect(image.headers.get('content-disposition')).toBe('inline');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(thumbnail);

    const download = await fetch(apiUrl + routes.downloadUrl);
    expect(download.status).toBe(200);
    expect(download.redirected).toBe(true);
    expect(download.headers.get('content-disposition')).toBe(
      `attachment; filename="${id}.mp4"`,
    );
    expect(Buffer.from(await download.arrayBuffer())).toEqual(original);
  });

  it('issues fresh signatures using the same stable route', async () => {
    const sign = async () => {
      const response = await fetch(apiUrl + routes.streamUrl, {
        redirect: 'manual',
      });
      expect(response.status).toBe(307);
      const url = new URL(response.headers.get('location')!);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      await response.arrayBuffer();
      return url;
    };
    const first = await sign();
    await delay(1100);
    const renewed = await sign();
    expect(renewed.pathname).toBe(first.pathname);
    expect(renewed.searchParams.get('X-Amz-Date')).not.toBe(
      first.searchParams.get('X-Amz-Date'),
    );
    const response = await fetch(renewed, { headers: { Range: 'bytes=0-7' } });
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      playback.subarray(0, 8),
    );
  });
});
