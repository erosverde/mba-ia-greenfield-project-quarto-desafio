import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1794845811559 implements MigrationInterface {
  name = 'CreateVideos1794845811559';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."video_status" AS ENUM('DRAFT', 'PROCESSING', 'READY', 'ERROR')`,
    );
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL, "channel_id" uuid NOT NULL, "title" character varying(200) NOT NULL, "size_bytes" bigint NOT NULL, "status" "public"."video_status" NOT NULL DEFAULT 'DRAFT', "upload_id" text, "upload_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "original_key" text NOT NULL, "playback_key" text, "thumbnail_key" text, "duration_ms" bigint, "metadata" jsonb, "error_code" character varying(64), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CK_videos_size_bytes" CHECK ("size_bytes" BETWEEN 1 AND 10000000000), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "video_processing_outbox" ("video_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "attempts" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_b5164922ea5553e56eeb637863a" PRIMARY KEY ("video_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "video_processing_outbox" ADD CONSTRAINT "FK_video_processing_outbox_video" FOREIGN KEY ("video_id") REFERENCES "videos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "video_processing_outbox" DROP CONSTRAINT "FK_video_processing_outbox_video"`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel"`,
    );
    await queryRunner.query(`DROP TABLE "video_processing_outbox"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_videos_channel_id"`);
    await queryRunner.query(`DROP TABLE "videos"`);
    await queryRunner.query(`DROP TYPE "public"."video_status"`);
  }
}
