import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  BucketLocationConstraint,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoStorageConfig from '../config/video-storage.config';
import { VIDEO_PART_BYTES } from './video-upload.constants';
import {
  VideoStorageUnavailableException,
  VideoUploadIncompleteException,
} from './video.exceptions';

export interface UploadedPart {
  partNumber: number;
  size: number;
  etag: string;
}

@Injectable()
export class VideoStorageService implements OnApplicationShutdown {
  private readonly internalClient: S3Client;
  private readonly signingClient: S3Client;
  private bucketReady?: Promise<void>;

  constructor(
    @Inject(videoStorageConfig.KEY)
    private readonly config: ConfigType<typeof videoStorageConfig>,
  ) {
    const options = {
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
    };
    this.internalClient = new S3Client({
      ...options,
      endpoint: config.internalEndpoint,
    });
    this.signingClient = new S3Client({
      ...options,
      endpoint: config.publicEndpoint,
    });
  }

  onApplicationShutdown(): void {
    this.internalClient.destroy();
    this.signingClient.destroy();
  }

  private async prepareBucket(): Promise<void> {
    const Bucket = this.config.bucket;
    try {
      await this.internalClient.send(new HeadBucketCommand({ Bucket }));
    } catch (error) {
      if (
        !(error instanceof S3ServiceException) ||
        error.$metadata.httpStatusCode !== 404
      ) {
        throw error;
      }
      const location = Object.values(BucketLocationConstraint).find(
        (region) => region === this.config.region,
      );
      if (!location && this.config.region !== 'us-east-1') {
        throw new Error(
          'Region is not supported for automatic bucket creation',
        );
      }
      try {
        await this.internalClient.send(
          new CreateBucketCommand({
            Bucket,
            ...(location && {
              CreateBucketConfiguration: {
                LocationConstraint: location,
              },
            }),
          }),
        );
      } catch (creationError) {
        if (
          !(creationError instanceof S3ServiceException) ||
          creationError.name !== 'BucketAlreadyOwnedByYou'
        ) {
          throw creationError;
        }
      }
    }
  }

  async begin(key: string, videoId: string): Promise<string> {
    try {
      this.bucketReady ??= this.prepareBucket();
      await this.bucketReady;
      const result = await this.internalClient.send(
        new CreateMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          ContentType: 'video/mp4',
          Metadata: { 'video-id': videoId },
        }),
      );
      if (!result.UploadId) throw new Error('S3 did not return an upload ID');
      return result.UploadId;
    } catch (error) {
      this.bucketReady = undefined;
      throw new VideoStorageUnavailableException(error);
    }
  }

  async signPart(
    key: string,
    uploadId: string,
    partNumber: number,
    length: number,
    expiresIn: number,
  ): Promise<string> {
    try {
      return await getSignedUrl(
        this.signingClient,
        new UploadPartCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          ContentLength: length,
        }),
        { expiresIn, signableHeaders: new Set(['content-length']) },
      );
    } catch (error) {
      throw new VideoStorageUnavailableException(error);
    }
  }

  async listParts(
    key: string,
    uploadId: string,
  ): Promise<UploadedPart[] | null> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    try {
      do {
        const result = await this.internalClient.send(
          new ListPartsCommand({
            Bucket: this.config.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        );
        for (const part of result.Parts ?? []) {
          if (
            part.PartNumber === undefined ||
            part.Size === undefined ||
            !part.ETag
          ) {
            throw new Error('S3 returned an incomplete part');
          }
          parts.push({
            partNumber: part.PartNumber,
            size: part.Size,
            etag: part.ETag,
          });
        }
        marker = result.IsTruncated ? result.NextPartNumberMarker : undefined;
      } while (marker);
      return parts;
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NoSuchUpload')
        return null;
      throw new VideoStorageUnavailableException(error);
    }
  }

  async complete(
    key: string,
    uploadId: string,
    parts: UploadedPart[],
  ): Promise<void> {
    try {
      await this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map(({ partNumber, etag }) => ({
              PartNumber: partNumber,
              ETag: etag,
            })),
          },
        }),
      );
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        [
          'InvalidPart',
          'InvalidPartOrder',
          'NoSuchUpload',
          'EntityTooSmall',
        ].includes(error.name)
      ) {
        throw new VideoUploadIncompleteException();
      }
      throw new VideoStorageUnavailableException(error);
    }
  }

  async head(
    key: string,
  ): Promise<{ videoId: string | undefined; size: number | undefined } | null> {
    try {
      const object = await this.internalClient.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      return {
        videoId: object.Metadata?.['video-id'],
        size: object.ContentLength,
      };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404
      )
        return null;
      throw new VideoStorageUnavailableException(error);
    }
  }

  async downloadToFile(key: string, path: string): Promise<void> {
    const { Body } = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    if (!(Body instanceof Readable))
      throw new Error('S3 response body is missing');
    await pipeline(Body, createWriteStream(path, { flags: 'wx' }));
  }

  async uploadFile(
    key: string,
    path: string,
    contentType: string,
    videoId: string,
  ): Promise<void> {
    const { size } = await stat(path);
    const Bucket = this.config.bucket;
    if (size <= 5_000_000_000) {
      const body = createReadStream(path);
      try {
        await this.internalClient.send(
          new PutObjectCommand({
            Bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentLength: size,
            Metadata: { 'video-id': videoId },
          }),
        );
      } finally {
        body.destroy();
      }
      return;
    }

    const uploadId = await this.begin(key, videoId);
    const parts: UploadedPart[] = [];
    const chunkSize = VIDEO_PART_BYTES;
    try {
      for (let offset = 0; offset < size; offset += chunkSize) {
        const length = Math.min(chunkSize, size - offset);
        const partNumber = parts.length + 1;
        const body = createReadStream(path, {
          start: offset,
          end: offset + length - 1,
        });
        try {
          const result = await this.internalClient.send(
            new UploadPartCommand({
              Bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: partNumber,
              Body: body,
              ContentLength: length,
            }),
          );
          if (!result.ETag) throw new Error('S3 did not return the part ETag');
          parts.push({ partNumber, size: length, etag: result.ETag });
        } finally {
          body.destroy();
        }
      }
      await this.complete(key, uploadId, parts);
    } catch (error) {
      // Unfinished multipart uploads are also collected by the storage lifecycle.
      await this.abort(key, uploadId).catch(() => undefined);
      throw error;
    }
  }

  async abort(key: string, uploadId: string): Promise<void> {
    try {
      await this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NoSuchUpload')
        return;
      throw new VideoStorageUnavailableException(error);
    }
  }
}
