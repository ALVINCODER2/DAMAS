#!/usr/bin/env node
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("MONGO_URI not set in environment. Aborting.");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("Connected to MongoDB for migration.");

  const MatchHistory = require("../models/MatchHistory");

  const batchSize = 500;
  let ops = [];
  let inspected = 0;
  let queued = 0;
  let applied = 0;

  try {
    const cursor = MatchHistory.find().lean().cursor();
    for await (const doc of cursor) {
      inspected++;
      const p1 = (doc.player1 || "").toString();
      const p2 = (doc.player2 || "").toString();
      const w = doc.winner == null ? null : doc.winner.toString();

      const p1Lower = p1.toLowerCase();
      const p2Lower = p2.toLowerCase();
      const wLower = w == null ? null : w.toLowerCase();

      // Only queue update if any field differs
      if (p1 !== p1Lower || p2 !== p2Lower || (w !== null && w !== wLower)) {
        ops.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                player1: p1Lower,
                player2: p2Lower,
                winner: wLower,
              },
            },
          },
        });
        queued++;
      }

      if (ops.length >= batchSize) {
        const res = await MatchHistory.bulkWrite(ops, { ordered: false });
        applied += (res.modifiedCount || 0) + (res.upsertedCount || 0);
        console.log(
          `Applied batch: inspected=${inspected} queued=${queued} appliedSoFar=${applied}`
        );
        ops = [];
      }
    }

    if (ops.length > 0) {
      const res = await MatchHistory.bulkWrite(ops, { ordered: false });
      applied += (res.modifiedCount || 0) + (res.upsertedCount || 0);
      console.log(`Final batch applied: ${res.modifiedCount || 0} modified`);
    }

    console.log(
      `Migration complete. inspected=${inspected} queued=${queued} applied=${applied}`
    );
  } catch (e) {
    console.error("Migration error:", e);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
    process.exit(0);
  }
}

main();
