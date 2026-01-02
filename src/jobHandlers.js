// src/jobHandlers.js
// Centraliza handlers para jobs serializáveis.
const MatchHistory = require("../models/MatchHistory");

async function handleSaveMatchHistory(payload) {
  // Basic validation and defensive logging to catch silent failures
  try {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid payload for saveMatchHistory");
    }

    const player1 = (payload.player1 || "").toString();
    const player2 = (payload.player2 || "").toString();
    const bet =
      typeof payload.bet === "number" ? payload.bet : Number(payload.bet) || 0;
    const gameMode = payload.gameMode || "unknown";

    // If either player is missing, log and skip saving to avoid DB validation errors.
    if (!player1 || !player2) {
      try {
        console.warn(
          "handleSaveMatchHistory: missing player data, skipping save",
          { player1, player2, payload }
        );
      } catch (e) {}
      return;
    }

    const history = new MatchHistory({
      player1,
      player2,
      winner: payload.winner || null,
      bet,
      gameMode,
      reason: payload.reason,
    });

    try {
      await history.save();
    } catch (firstErr) {
      console.error(
        "handleSaveMatchHistory: first save attempt failed",
        firstErr,
        { payload }
      );
      // retry once after tiny delay
      await new Promise((r) => setTimeout(r, 200));
      await history.save();
    }
  } catch (e) {
    console.error(
      "handleSaveMatchHistory: fatal error for payload:",
      payload,
      e
    );
    throw e;
  }
}

async function processJob(job) {
  if (!job || !job.type) return;
  try {
    switch (job.type) {
      case "saveMatchHistory":
        await handleSaveMatchHistory(job.payload);
        break;
      default:
        console.log("jobHandlers: no handler for type", job.type);
    }
  } catch (e) {
    console.error("jobHandlers: error processing job", job && job.type, e);
    throw e;
  }
}

module.exports = { processJob, handleSaveMatchHistory };
