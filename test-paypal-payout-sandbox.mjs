import { createPayoutBatch } from "../backend/paypal-client.mjs";

const receiver = readArg("--receiver") || process.env.PAYPAL_PAYOUT_RECEIVER || "";
const amount = readArg("--amount") || process.env.PAYPAL_PAYOUT_AMOUNT || "9.87";
const currency = readArg("--currency") || process.env.PAYPAL_PAYOUT_CURRENCY || "USD";
const senderItemId = readArg("--sender-item-id") || process.env.PAYPAL_PAYOUT_SENDER_ITEM_ID || `aw-payout-test-${Date.now()}`;
const batchId = readArg("--batch-id") || process.env.PAYPAL_PAYOUT_BATCH_ID || `aw-payout-batch-${Date.now()}`;

async function main() {
  if (String(process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live") {
    throw new Error("This script is for sandbox payout testing only. Set PAYPAL_ENV=sandbox.");
  }
  if (!receiver) {
    throw new Error("Set --receiver or PAYPAL_PAYOUT_RECEIVER to a sandbox provider payout receiver.");
  }

  const result = await createPayoutBatch({
    sender_batch_header: {
      sender_batch_id: batchId,
      email_subject: "AW Roadside sandbox provider payout",
      email_message: "AW Roadside sandbox payout test."
    },
    items: [
      {
        recipient_type: receiver.includes("@") ? "EMAIL" : "PAYPAL_ID",
        amount: {
          value: amount,
          currency
        },
        note: "AW Roadside sandbox provider payout test.",
        sender_item_id: senderItemId,
        receiver
      }
    ]
  });

  console.log(JSON.stringify({
    ok: true,
    batchId: result?.batch_header?.payout_batch_id || result?.batchHeader?.payoutBatchId || null,
    batchStatus: result?.batch_header?.batch_status || result?.batchHeader?.batchStatus || null,
    senderBatchId: batchId,
    senderItemId,
    receiver,
    result
  }, null, 2));
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : process.argv[index + 1] || "";
}

main().catch((error) => {
  console.error("PAYPAL_PAYOUT_SANDBOX_FAILED");
  console.error(error.message);
  if (error.paypal) {
    console.error(JSON.stringify(error.paypal, null, 2));
  }
  process.exitCode = 1;
});
