import { Pool } from "pg";

import { createAwRoadsideDbConfig } from "../backend/awroadsidedb-config.mjs";
import { STORAGE_SCHEMA_SQL } from "../backend/storage/schema.mjs";

const dbConfig = createAwRoadsideDbConfig({
  env: process.env,
  localWatchdog: null
});

const publicStatus = dbConfig.getPublicStatus();

if (!publicStatus.configured) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: "database-not-configured",
        database: publicStatus
      },
      null,
      2
    )
  );
  process.exit(1);
}

if (publicStatus.client !== "postgres") {
  console.error(
    JSON.stringify(
      {
        ok: false,
        reason: "unsupported-db-client",
        database: publicStatus
      },
      null,
      2
    )
  );
  process.exit(1);
}

const pool = new Pool(dbConfig.getConnectionConfig());

try {
  const connectionProbe = await pool.query(
    `SELECT current_database() AS database_name, current_user AS current_user, NOW() AS connected_at`
  );
  await pool.query(STORAGE_SCHEMA_SQL);
  const tablesResult = await pool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'aw_%'
      ORDER BY table_name`
  );
  const countsResult = await pool.query(
    `SELECT 'aw_users' AS table_name, COUNT(*)::bigint AS row_count FROM aw_users
     UNION ALL
     SELECT 'aw_subscriber_profiles' AS table_name, COUNT(*)::bigint AS row_count FROM aw_subscriber_profiles
     UNION ALL
     SELECT 'aw_provider_profiles' AS table_name, COUNT(*)::bigint AS row_count FROM aw_provider_profiles
     UNION ALL
     SELECT 'aw_service_requests' AS table_name, COUNT(*)::bigint AS row_count FROM aw_service_requests
     UNION ALL
     SELECT 'aw_payment_events' AS table_name, COUNT(*)::bigint AS row_count FROM aw_payment_events
     UNION ALL
     SELECT 'aw_provider_wallet_history' AS table_name, COUNT(*)::bigint AS row_count FROM aw_provider_wallet_history
     UNION ALL
     SELECT 'aw_provider_performance_history' AS table_name, COUNT(*)::bigint AS row_count FROM aw_provider_performance_history
     ORDER BY table_name`
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: publicStatus,
        connection: connectionProbe.rows[0] || null,
        tables: tablesResult.rows.map((row) => row.table_name),
        rowCounts: countsResult.rows
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
