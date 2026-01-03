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

  const email = (process.argv[2] || "barbeiro@gmail.com").toLowerCase();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  console.log(
    "Querying MatchHistory for",
    email,
    "since",
    cutoff.toISOString()
  );
  const docs = await MatchHistory.find({
    $and: [
      { createdAt: { $gte: cutoff } },
      { $or: [{ player1: email }, { player2: email }] },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  if (!docs || docs.length === 0) {
    console.log("No matches found.");
  } else {
    console.log(`Found ${docs.length} matches:`);
    docs.forEach((d, i) => {
      console.log(i + 1, JSON.stringify(d));
    });
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
