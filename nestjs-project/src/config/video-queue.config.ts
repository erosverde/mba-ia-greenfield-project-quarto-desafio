import { registerAs } from '@nestjs/config';

export default registerAs('videoQueue', () => {
  const port = Number(process.env.VIDEO_REDIS_PORT ?? 6379);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('VIDEO_REDIS_PORT must be a valid TCP port');
  }

  return {
    host: process.env.VIDEO_REDIS_HOST ?? 'redis',
    port,
    name: process.env.VIDEO_QUEUE_NAME ?? 'video-processing',
  };
});
