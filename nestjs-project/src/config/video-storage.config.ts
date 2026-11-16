import { registerAs } from '@nestjs/config';

function endpoint(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Video storage endpoint must be an HTTP(S) origin');
  }
  return url.origin;
}

export default registerAs('videoStorage', () => ({
  internalEndpoint: endpoint(
    process.env.VIDEO_STORAGE_ENDPOINT ?? 'http://minio:9000',
  ),
  publicEndpoint: endpoint(
    process.env.VIDEO_STORAGE_PUBLIC_ENDPOINT ?? 'http://localhost:9000',
  ),
  bucket: process.env.VIDEO_STORAGE_BUCKET ?? 'streamtube-videos',
  region: process.env.VIDEO_STORAGE_REGION ?? 'us-east-1',
  accessKeyId: process.env.VIDEO_STORAGE_ACCESS_KEY ?? 'streamtube-dev',
  secretAccessKey:
    process.env.VIDEO_STORAGE_SECRET_KEY ?? 'streamtube-dev-secret',
}));
