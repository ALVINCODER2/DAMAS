require("dotenv").config();
const mongoose = require("mongoose");
const MatchHistory = require("../models/MatchHistory");

async function main() {
  try {
    const MONGO_URI = process.env.MONGO_URI;
    if (!MONGO_URI) throw new Error("MONGO_URI not set");
    await mongoose.connect(MONGO_URI);
    const docs = await MatchHistory.find()
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();
    console.log("Latest matches:", docs);
    await mongoose.disconnect();
  } catch (e) {
    console.error("Error:", e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
