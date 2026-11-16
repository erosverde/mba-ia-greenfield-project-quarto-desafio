import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { Video } from './video.entity';

@Entity('video_processing_outbox')
export class VideoProcessingOutbox {
  @PrimaryColumn('uuid')
  video_id: string;

  @OneToOne(() => Video, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'video_id',
    foreignKeyConstraintName: 'FK_video_processing_outbox_video',
  })
  video: Video;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column('timestamptz', { nullable: true })
  published_at: Date | null;

  @Column('timestamptz', { default: () => 'now()' })
  next_attempt_at: Date;

  @Column('integer', { default: 0 })
  attempts: number;
}
