require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("MONGO_URI not set.");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  const MatchHistory = require("../models/MatchHistory");

  const email = (process.argv[2] || "").toLowerCase();
  const from = process.argv[3];
  const to = process.argv[4];
  if (!email || !from || !to) {
    console.error(
      "Usage: node query_history_time_window.js <email> <fromISO> <toISO>"
    );
    process.exit(1);
  }

  const fromD = new Date(from);
  const toD = new Date(to);
  console.log(
    "Querying",
    email,
    "between",
    fromD.toISOString(),
    "and",
    toD.toISOString()
  );

  const docs = await MatchHistory.find({
    createdAt: { $gte: fromD, $lte: toD },
    $or: [{ player1: email }, { player2: email }],
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!docs || docs.length === 0) {
    console.log("No matches found in that window.");
  } else {
    console.log(`Found ${docs.length} matches:`);
    docs.forEach((d, i) => console.log(i + 1, JSON.stringify(d)));
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
