const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// 1. Definindo o Schema (a estrutura) do Usuário
const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true, // O email é obrigatório
    unique: true, // Cada email deve ser único no banco
    lowercase: true, // Salva o email sempre em minúsculas
  },
  password: {
    type: String,
    required: true, // A senha é obrigatória
  },
  saldo: {
    type: Number,
    default: 0, // O saldo inicial de todo novo usuário será 0
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
