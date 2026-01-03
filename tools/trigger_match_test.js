require("dotenv").config();
const mongoose = require("mongoose");
const MatchHistory = require("../models/MatchHistory");

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  const now = new Date();
  const payload = {
    player1: process.env.TEST_PLAYER1 || "testa@example.com",
    player2: process.env.TEST_PLAYER2 || "testb@example.com",
    winner: process.env.TEST_WINNER || "testa@example.com",
    bet: Number(process.env.TEST_BET) || 1,
    gameMode: process.env.TEST_MODE || "classic",
    reason: "Automated test trigger",
    createdAt: now,
  };

  const doc = new MatchHistory(payload);
  const saved = await doc.save();
  console.log("Inserted match history id=", saved._id);

  // Publish to Redis channel if available
  const REDIS_URL = process.env.REDIS_URL;
  if (REDIS_URL) {
    try {
      const { createClient } = require("redis");
      const rc = createClient({ url: REDIS_URL });
      await rc.connect();
      await rc.publish(
        "damas:matchSaved",
        JSON.stringify({
          _id: saved._id,
          player1: saved.player1,
          player2: saved.player2,
          winner: saved.winner,
          bet: saved.bet,
          gameMode: saved.gameMode,
          reason: saved.reason,
          createdAt: saved.createdAt,
        })
      );
      console.log("Published to Redis damas:matchSaved");
      await rc.disconnect();
    } catch (e) {
      console.warn(
        "Failed to publish to Redis:",
        e && e.message ? e.message : e
      );
    }
  } else {
    console.log(
      "No REDIS_URL configured; server will discover via DB poll shortly."
    );
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
