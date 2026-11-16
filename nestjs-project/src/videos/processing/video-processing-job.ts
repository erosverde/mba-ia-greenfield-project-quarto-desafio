export const VIDEO_PROCESSING_JOB = 'process-video';
export const VIDEO_PROCESSING_ATTEMPTS = 3;
export const VIDEO_PROCESSING_BACKOFF_MS = 5_000;

export interface VideoProcessingJob {
  version: 1;
  videoId: string;
}

export const UNSUPPORTED_VIDEO = 'VIDEO_FORMAT_UNSUPPORTED';
export const PROCESSING_FAILED = 'VIDEO_PROCESSING_FAILED';
