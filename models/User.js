const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// 1. Definindo o Schema (a estrutura) do Usuário
const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  saldo: {
    type: Number,
    default: 0,
  },
  // --- NOVOS CAMPOS DE PERFIL ---
  username: {
    type: String,
    default: "", // Vazio por padrão, usuário define depois
  },
  avatar: {
    type: String,
    default: "", // URL da imagem
  },
  // --- PREFERÊNCIAS DE VISUALIZAÇÃO DO USUÁRIO ---
  preferences: {
    type: {
      boardLight: { type: String, default: "#f0d9b5" },
      boardDark: { type: String, default: "#b58863" },
      pieceWhite: { type: String, default: "#ffffff" },
      pieceBlack: { type: String, default: "#555555" },
    },
    default: {},
  },
  // --- CAMPOS PARA INDICAÇÃO ---
  referredBy: {
    type: String, // Email de quem indicou este usuário
    default: null,
  },
  hasDeposited: {
    type: Boolean, // Marca se o usuário já fez o primeiro depósito
    default: false,
  },
  firstDepositValue: {
    type: Number,
    default: 0,
  },
  referralEarnings: {
    type: Number, // Quanto já ganhou com indicações
    default: 0,
  },
});

// 2. Hook (gancho) que é executado ANTES de salvar o usuário
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  const hash = await bcrypt.hash(this.password, 10);
  this.password = hash;
  next();
});

// 3. Criando e exportando o Model
const User = mongoose.model("User", UserSchema);
module.exports = User;
