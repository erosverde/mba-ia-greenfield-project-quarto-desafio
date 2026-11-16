import {
  AbortMultipartUploadCommand,
  BucketLocationConstraint,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoStorageConfig from '../config/video-storage.config';
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
export class VideoStorageService implements OnModuleDestroy {
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

  onModuleDestroy(): void {
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
