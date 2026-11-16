export const VIDEO_PART_BYTES = 64 * 1024 * 1024;
export const VIDEO_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const VIDEO_SIGNED_URL_TTL_SECONDS = 15 * 60;

export function videoPartCount(size: number): number {
  return Math.ceil(size / VIDEO_PART_BYTES);
}

export function videoPartLength(size: number, partNumber: number): number {
  return Math.min(VIDEO_PART_BYTES, size - (partNumber - 1) * VIDEO_PART_BYTES);
}
