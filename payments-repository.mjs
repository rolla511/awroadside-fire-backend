import { insertPaymentEventRow } from "./sql-helpers.mjs";

export function createPaymentsRepository() {
  return {
    name: "payments",
    writeAuthority: "server.mjs",
    targetTables: [
      "aw_payment_events"
    ],
    async insert(sql, entry) {
      await insertPaymentEventRow(sql, entry);
    }
  };
}
