import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
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
import { VideoUploadsService } from '../src/videos/video-uploads.service';
import { VIDEO_PART_BYTES } from '../src/videos/video-upload.constants';

describe('Direct video upload (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: S3Client;
  let ownerToken: string;
  let otherToken: string;
  let ownerChannel: Channel;
  let otherChannel: Channel;

  const bucket = process.env.VIDEO_STORAGE_BUCKET ?? 'streamtube-videos';
  const endpoint = process.env.VIDEO_STORAGE_ENDPOINT ?? 'http://minio:9000';

  function http() {
    return request(app.getHttpServer());
  }

  async function makeChannel(): Promise<{ channel: Channel; token: string }> {
    const email = `${randomUUID()}@example.test`;
    const user = await dataSource
      .getRepository(User)
      .save({ email, password: 'fixture-hash' });
    const channel = await dataSource.getRepository(Channel).save({
      user_id: user.id,
      name: 'Video test',
      nickname: randomUUID(),
    });
    return {
      channel,
      token: await app.get(JwtService).signAsync({ sub: user.id, email }),
    };
  }

  async function start(sizeBytes: number): Promise<string> {
    const response = await http()
      .post('/videos/uploads')
      .set('Authorization', ownerToken)
      .send({ title: '  Example video  ', sizeBytes })
      .expect(201);
    const body = response.body as {
      id: string;
      partCount: number;
      status: string;
    };
    expect(body).toMatchObject({
      partCount: Math.ceil(sizeBytes / VIDEO_PART_BYTES),
      status: VideoStatus.Draft,
    });
    return body.id;
  }

  async function signPart(id: string, partNumber: number): Promise<string> {
    const response = await http()
      .post(`/videos/${id}/uploads/parts/${partNumber}`)
      .set('Authorization', ownerToken)
      .expect(200);
    const body = response.body as {
      url: string;
      contentLength: number;
      validForSeconds: number;
    };
    const url = new URL(body.url);
    expect(url.origin).toBe(endpoint);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain(
      'content-length',
    );
    return body.url;
  }

  function complete(id: string) {
    return http()
      .post(`/videos/${id}/uploads/complete`)
      .set('Authorization', ownerToken);
  }

  async function uploadPart(
    url: string,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<number> {
    const response = await fetch(url, { method: 'PUT', body: bytes });
    await response.arrayBuffer();
    return response.status;
  }

  const videos = () => dataSource.getRepository(Video);

  beforeAll(async () => {
    // Keep client traffic on the Docker network while exercising the signed URL.
    process.env.VIDEO_STORAGE_PUBLIC_ENDPOINT = endpoint;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
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
    await app.init();
    dataSource = app.get(DataSource);

    storage = new S3Client({
      endpoint,
      forcePathStyle: true,
      region: process.env.VIDEO_STORAGE_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.VIDEO_STORAGE_ACCESS_KEY ?? 'streamtube-dev',
        secretAccessKey:
          process.env.VIDEO_STORAGE_SECRET_KEY ?? 'streamtube-dev-secret',
      },
    });
    const owner = await makeChannel();
    const other = await makeChannel();
    ownerChannel = owner.channel;
    otherChannel = other.channel;
    ownerToken = `Bearer ${owner.token}`;
    otherToken = `Bearer ${other.token}`;
  });

  afterAll(async () => {
    try {
      for (const channel of [ownerChannel, otherChannel]) {
        if (!channel) continue;
        for (const video of await videos().findBy({ channel_id: channel.id })) {
          if (video.upload_id) {
            await storage
              .send(
                new AbortMultipartUploadCommand({
                  Bucket: bucket,
                  Key: video.original_key,
                  UploadId: video.upload_id,
                }),
              )
              .catch((error: unknown) => {
                if (!(error instanceof Error) || error.name !== 'NoSuchUpload')
                  throw error;
              });
          }
          await storage.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: video.original_key,
            }),
          );
          await videos().delete(video.id);
        }
        await dataSource.getRepository(Channel).delete(channel.id);
        await dataSource.getRepository(User).delete(channel.user_id);
      }
    } finally {
      storage?.destroy();
      await app?.close();
    }
  });

  it('enforces JWT, channel ownership, part bounds and the 10 GB limit', async () => {
    await http()
      .post('/videos/uploads')
      .send({ title: 'Video', sizeBytes: 1 })
      .expect(401);
    await http()
      .post('/videos/uploads')
      .set('Authorization', ownerToken)
      .send({ title: 'Video', sizeBytes: MAX_VIDEO_BYTES + 1 })
      .expect(400);
    const id = await start(MAX_VIDEO_BYTES);
    const route = `/videos/${id}`;
    await http().get(route).set('Authorization', otherToken).expect(404);
    await http()
      .post(`${route}/uploads/complete`)
      .set('Authorization', otherToken)
      .expect(404);
    await http()
      .post(`${route}/uploads/parts/1`)
      .set('Authorization', otherToken)
      .expect(404);
    await http()
      .post(`${route}/uploads/parts/151`)
      .set('Authorization', ownerToken)
      .expect(400)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({ error: 'VIDEO_PART_INVALID' });
      });
    await http()
      .get(route)
      .set('Authorization', ownerToken)
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({
          id,
          title: 'Example video',
          status: 'DRAFT',
          sizeBytes: MAX_VIDEO_BYTES,
        });
      });
    expect((await videos().findOneByOrFail({ id })).channel_id).toBe(
      ownerChannel.id,
    );
  });

  it('assembles two direct parts and writes exactly one outbox intent on concurrent confirmations', async () => {
    const id = await start(VIDEO_PART_BYTES + 3);
    await complete(id).expect(409);
    const first = await signPart(id, 1);
    const last = await signPart(id, 2);
    const preflight = await fetch(last, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'PUT',
      },
    });
    expect(preflight.ok).toBe(true);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:3000',
    );
    expect(await uploadPart(last, new Uint8Array([1]))).toBe(403);
    expect(await uploadPart(first, new Uint8Array(VIDEO_PART_BYTES))).toBe(200);
    expect(await uploadPart(last, new Uint8Array([1, 2, 3]))).toBe(200);
    const confirmations = await Promise.all([
      complete(id).expect(202),
      complete(id).expect(202),
    ]);
    for (const result of confirmations)
      expect(result.body).toEqual({ id, status: 'PROCESSING' });
    expect(
      await dataSource
        .getRepository(VideoProcessingOutbox)
        .countBy({ video_id: id }),
    ).toBe(1);
    const video = await videos().findOneByOrFail({ id });
    expect(video).toMatchObject({
      status: VideoStatus.Processing,
      upload_id: null,
    });
    const privateObject = await fetch(
      `${endpoint}/${bucket}/${video.original_key}`,
      {
        method: 'HEAD',
      },
    );
    expect(privateObject.status).toBe(403);
    const result = await storage.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: video.original_key,
        Range: `bytes=${VIDEO_PART_BYTES}-`,
      }),
    );
    expect(result.ContentRange).toBe(
      `bytes ${VIDEO_PART_BYTES}-${VIDEO_PART_BYTES + 2}/${VIDEO_PART_BYTES + 3}`,
    );
    expect(await result.Body?.transformToByteArray()).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  }, 30_000);

  it('checks sizes returned by storage and recovers a completed object after a missing DB commit', async () => {
    const id = await start(3);
    const { original_key: Key, upload_id: UploadId } =
      await videos().findOneByOrFail({ id });
    await storage.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key,
        UploadId: UploadId!,
        PartNumber: 1,
        Body: Buffer.from([1]),
      }),
    );
    await complete(id).expect(409);
    expect(
      await uploadPart(await signPart(id, 1), new Uint8Array([1, 2, 3])),
    ).toBe(200);
    const { Parts } = await storage.send(
      new ListPartsCommand({ Bucket: bucket, Key, UploadId: UploadId! }),
    );
    await storage.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key,
        UploadId: UploadId!,
        MultipartUpload: { Parts },
      }),
    );
    await complete(id).expect(202).expect({ id, status: 'PROCESSING' });
    expect(
      await dataSource
        .getRepository(VideoProcessingOutbox)
        .countBy({ video_id: id }),
    ).toBe(1);
  });

  it('aborts an expired multipart session and exposes ERROR to the owner', async () => {
    const id = await start(3);
    const { original_key: Key, upload_id: UploadId } =
      await videos().findOneByOrFail({ id });
    await videos().update(id, {
      upload_expires_at: new Date(Date.now() - 1000),
    });
    await complete(id).expect(410);
    await app.get(VideoUploadsService).expireUploads();
    await expect(
      storage.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key,
          UploadId: UploadId!,
        }),
      ),
    ).rejects.toMatchObject({ name: 'NoSuchUpload' });
    await http()
      .get(`/videos/${id}`)
      .set('Authorization', ownerToken)
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({
          status: 'ERROR',
          errorCode: 'VIDEO_UPLOAD_EXPIRED',
        });
      });
  });
});
