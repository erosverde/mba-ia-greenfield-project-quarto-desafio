import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  Draft = 'DRAFT',
  Processing = 'PROCESSING',
  Ready = 'READY',
  Error = 'ERROR',
}

export const MAX_VIDEO_BYTES = 10_000_000_000;

export interface VideoMetadata {
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  format: string;
}

@Entity('videos')
@Check('CK_videos_size_bytes', '"size_bytes" BETWEEN 1 AND 10000000000')
@Index('IDX_videos_channel_id', ['channel_id'])
export class Video {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid')
  channel_id: string;

  @ManyToOne(() => Channel)
  @JoinColumn({
    name: 'channel_id',
    foreignKeyConstraintName: 'FK_videos_channel',
  })
  channel: Channel;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column('bigint')
  size_bytes: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'video_status',
    default: VideoStatus.Draft,
  })
  status: VideoStatus;

  @Column('text', { nullable: true })
  upload_id: string | null;

  @Column('timestamptz')
  upload_expires_at: Date;

  @Column('text')
  original_key: string;

  @Column('text', { nullable: true })
  playback_key: string | null;

  @Column('text', { nullable: true })
  thumbnail_key: string | null;

  @Column('bigint', { nullable: true })
  duration_ms: string | null;

  @Column('jsonb', { nullable: true })
  metadata: VideoMetadata | null;

  @Column('varchar', { length: 64, nullable: true })
  error_code: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
