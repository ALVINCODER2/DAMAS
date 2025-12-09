const mongoose = require("mongoose");

const WithdrawalSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
  },
  pixKey: {
    type: String,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "completed", "rejected"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Withdrawal = mongoose.model("Withdrawal", WithdrawalSchema);
module.exports = Withdrawal;
