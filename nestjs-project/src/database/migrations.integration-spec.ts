import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { createTestDataSource } from '../test/create-test-data-source';

import { Video } from '../videos/entities/video.entity';
import { VideoProcessingOutbox } from '../videos/entities/video-processing-outbox.entity';
import { CreateVideos1794845811559 } from './migrations/1794845811559-CreateVideos';

const MANAGED_TABLES = [
  'video_processing_outbox',
  'videos',
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [
        User,
        Channel,
        RefreshToken,
        VerificationToken,
        Video,
        VideoProcessingOutbox,
      ],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1794845811559,
        ],
      },
    );

    await dataSource.initialize();

    for (const table of MANAGED_TABLES) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await dataSource.query('DROP TABLE IF EXISTS "migrations"');
    await dataSource.query(
      'DROP TYPE IF EXISTS "verification_tokens_type_enum"',
    );
    await dataSource.query('DROP TYPE IF EXISTS "video_status"');
  });

  afterAll(async () => {
    // Revert tests remove tables.
    // Re-apply so the shared DB is fully migrated when subsequent suites run.
    try {
      await dataSource.runMigrations();
    } finally {
      await dataSource.destroy();
    }
  });

  it('should apply all migrations and create all six tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(3);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'video_processing_outbox',
      'videos',
    ]);
  });

  it('should revert the video migration and keep the authentication tables', async () => {
    await dataSource.undoLastMigration();
    const tables = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [
        [
          'refresh_tokens',
          'verification_tokens',
          'video_processing_outbox',
          'videos',
        ],
      ],
    );
    expect(tables.map((table) => table.table_name)).toEqual([
      'refresh_tokens',
      'verification_tokens',
    ]);
  });

  it('should revert the auth migration and remove token tables', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['refresh_tokens', 'verification_tokens']],
    );
    expect(result).toHaveLength(0);
  });
});
