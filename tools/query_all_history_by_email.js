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
  console.log("Querying ALL MatchHistory for", email);
  const docs = await MatchHistory.find({
    $or: [{ player1: email }, { player2: email }],
  })
    .sort({ createdAt: -1 })
    .limit(200)
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
