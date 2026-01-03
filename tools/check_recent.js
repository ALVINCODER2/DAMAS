require("dotenv").config();
const mongoose = require("mongoose");
const MatchHistory = require("../models/MatchHistory");

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("MONGO_URI not set in env");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  const rec = await MatchHistory.find().sort({ createdAt: -1 }).limit(5).lean();
  console.log("latest matches:", rec);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
