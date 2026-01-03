require("dotenv").config();
const Bull = require("bull");

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("REDIS_URL not configured in .env");
  process.exit(1);
}

async function main() {
  const q = new Bull("damas-jobs", REDIS_URL);
  try {
    const counts = await q.getJobCounts();
    console.log("Queue counts:", counts);
    const waiting = await q.getWaiting();
    console.log("Waiting jobs sample (up to 10):");
    for (const j of waiting.slice(0, 10)) {
      console.log(
        " - id:",
        j.id,
        "type:",
        j.data && j.data.type,
        "payload:",
        JSON.stringify(j.data && j.data.payload)
      );
    }
    const active = await q.getActive();
    console.log("Active jobs sample:");
    for (const j of active.slice(0, 10)) {
      console.log(
        " - id:",
        j.id,
        "type:",
        j.data && j.data.type,
        "payload:",
        JSON.stringify(j.data && j.data.payload)
      );
    }
    const failed = await q.getFailed();
    console.log("Failed jobs sample:");
    for (const j of failed.slice(0, 10)) {
      console.log(
        " - id:",
        j.id,
        "failedReason:",
        j.failedReason,
        "type:",
        j.data && j.data.type,
        "payload:",
        JSON.stringify(j.data && j.data.payload)
      );
    }
  } catch (e) {
    console.error("Error querying bull queue:", e);
  } finally {
    await q.close();
    process.exit(0);
  }
}

main();
