import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { VideoMetadata } from '../entities/video.entity';

const execute = promisify(execFile);
const INPUT_TIMEOUT_MS = 60_000;
const REMUX_TIMEOUT_MS = 30 * 60_000;
const PROCESS_OPTIONS = {
  maxBuffer: 256 * 1024,
  killSignal: 'SIGKILL',
} as const;

export class UnsupportedVideoError extends Error {}

interface ProbeTrack {
  index?: number;
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  disposition?: { attached_pic?: number };
}

interface ProbeOutput {
  format?: { duration?: string; tags?: { major_brand?: string } };
  streams?: ProbeTrack[];
}

@Injectable()
export class VideoMediaService {
  async read(
    input: string,
    thumbnail: string,
    playback: string,
  ): Promise<{
    durationMs: number;
    metadata: VideoMetadata;
  }> {
    const source = ['-protocol_whitelist', 'file', '-f', 'mov', '-i', input];
    const probe = await this.probe(source);
    const tracks = probe.streams ?? [];
    const picture = tracks.find(
      (track) =>
        track.codec_type === 'video' && track.disposition?.attached_pic !== 1,
    );
    const audio = tracks.find((track) => track.codec_type === 'audio');
    const durationMs = Math.round(Number(probe.format?.duration) * 1000);
    const brand = probe.format?.tags?.major_brand?.trim() ?? '';
    if (
      !/^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V)$/.test(brand) ||
      picture?.index === undefined ||
      picture.codec_name !== 'h264' ||
      !picture.width ||
      !picture.height ||
      (audio && (audio.index === undefined || audio.codec_name !== 'aac')) ||
      !Number.isSafeInteger(durationMs) ||
      durationMs < 1
    ) {
      throw new UnsupportedVideoError();
    }

    const videoTrack = ['-map', `0:${picture.index}`];
    try {
      await this.ffmpeg(
        [
          ...source,
          ...videoTrack,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2',
          '-update',
          '1',
          thumbnail,
        ],
        INPUT_TIMEOUT_MS,
      );
      await this.ffmpeg(
        [
          ...source,
          ...videoTrack,
          ...(audio ? ['-map', `0:${audio.index}`] : []),
          '-map_metadata',
          '-1',
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          playback,
        ],
        REMUX_TIMEOUT_MS,
      );
    } catch (error) {
      if (this.exitedWithMediaError(error)) throw new UnsupportedVideoError();
      throw error;
    }

    return {
      durationMs,
      metadata: {
        width: picture.width,
        height: picture.height,
        videoCodec: picture.codec_name,
        audioCodec: audio?.codec_name ?? null,
        format: 'mp4',
      },
    };
  }

  private async probe(source: string[]): Promise<ProbeOutput> {
    try {
      const { stdout } = await execute(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:format_tags=major_brand:stream=index,codec_name,codec_type,width,height:stream_disposition=attached_pic',
          '-of',
          'json',
          ...source,
        ],
        { ...PROCESS_OPTIONS, timeout: INPUT_TIMEOUT_MS },
      );
      return JSON.parse(stdout) as ProbeOutput;
    } catch (error) {
      if (error instanceof SyntaxError || this.exitedWithMediaError(error))
        throw new UnsupportedVideoError();
      throw error;
    }
  }

  private async ffmpeg(args: string[], timeout: number): Promise<void> {
    await execute(
      'ffmpeg',
      ['-nostdin', '-hide_banner', '-v', 'error', '-xerror', ...args],
      {
        ...PROCESS_OPTIONS,
        timeout,
      },
    );
  }

  private exitedWithMediaError(error: unknown): boolean {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      typeof error.code !== 'number'
    )
      return false;
    // Storage or resource failures can succeed on a later attempt.
    return !(
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      /No space left on device|Permission denied|Input\/output error|Cannot allocate memory/i.test(
        error.stderr,
      )
    );
  }
}
