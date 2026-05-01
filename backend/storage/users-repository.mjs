import {
  upsertProviderProfileRow,
  upsertSubscriberProfileRow,
  upsertUserRow
} from "./sql-helpers.mjs";

export function createUsersRepository() {
  return {
    name: "users",
    syncCoordinator: "backend/server.mjs",
    targetTables: [
      "aw_users",
      "aw_subscriber_profiles",
      "aw_provider_profiles"
    ],
    async sync(sql, users) {
      for (const user of users) {
        await upsertUserRow(sql, user);
        await upsertSubscriberProfileRow(sql, user);
        await upsertProviderProfileRow(sql, user);
      }
    }
  };
}
