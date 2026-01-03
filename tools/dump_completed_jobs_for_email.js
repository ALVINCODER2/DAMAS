require("dotenv").config();
const Bull = require("bull");
const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) {
  console.error("REDIS_URL not set");
  process.exit(1);
}

async function main() {
  const q = new Bull("damas-jobs", REDIS_URL);
  try {
    const completed = await q.getCompleted(0, 100);
    console.log("Completed jobs count (fetched):", completed.length);
    const email = (process.argv[2] || "").toLowerCase();
    if (!email) {
      console.log(
        "Provide email arg to filter payloads (e.g. barbeiro@gmail.com)"
      );
    }
    for (const j of completed) {
      try {
        const data = j.data || {};
        const payload = data.payload || {};
        if (JSON.stringify(data).toLowerCase().includes(email)) {
          console.log(
            "Job id:",
            j.id,
            "type:",
            data.type,
            "payload:",
            JSON.stringify(payload),
            "finishedOn",
            j.finishedOn || j.processedOn
          );
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error("err", e);
  } finally {
    await q.close();
    process.exit(0);
  }
}

main();
