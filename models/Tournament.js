const mongoose = require("mongoose");

const TournamentSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["open", "active", "completed", "cancelled"],
    default: "open",
  },
  participants: [{ type: String }], // Lista de emails dos inscritos
  entryFee: { type: Number, default: 2.0 },
  prizePool: { type: Number, default: 0 },
  round: { type: Number, default: 1 }, // 1 = Oitavas/Quartas, etc
  matches: [
    {
      matchId: String,
      round: Number,
      player1: String, // Email ou null (bye)
      player2: String, // Email ou null
      winner: String, // Email
      roomCode: String,
      status: {
        type: String,
        enum: ["pending", "active", "finished"],
        default: "pending",
      },
    },
  ],
  winner: String, // Campeao final
  runnerUp: String, // Vice
  cancelledReason: { type: String, default: null },
  cancelledAt: { type: Date, default: null },
  refundsProcessed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Tournament", TournamentSchema);
