// index.js (VERSÃO COMPLETA COM GESTÃO DE SAQUES)
require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const User = require("./models/User");
const Withdrawal = require("./models/Withdrawal"); // Importante: Modelo de Saque
const bcrypt = require("bcryptjs");

const { initializeSocket, gameRooms } = require("./src/socketHandlers");
const { initializeManager } = require("./src/gameManager");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.warn("Atenção: A variável de ambiente MONGO_URI não está definida.");
}
if (!process.env.ADMIN_SECRET_KEY) {
  console.warn(
    "Atenção: A variável de ambiente ADMIN_SECRET_KEY não está definida."
  );
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Conectado ao MongoDB Atlas com sucesso!"))
  .catch((err) => console.error("Erro ao conectar ao MongoDB:", err));

// --- ROTAS DE API PADRÃO (LOGIN/REGISTRO) ---
app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Este e-mail já está em uso." });
    }
    const newUser = new User({ email, password });
    await newUser.save();
    res.status(201).json({ message: "Usuário cadastrado com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Ocorreu um erro no servidor." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Email ou senha inválidos." });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Email ou senha inválidos." });
    }
    res.status(200).json({
      message: "Login bem-sucedido!",
      user: { email: user.email, saldo: user.saldo },
    });
  } catch (error) {
    res.status(500).json({ message: "Ocorreu um erro no servidor." });
  }
});

app.post("/api/user/re-authenticate", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email não fornecido." });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Utilizador não encontrado." });
    }
    res.status(200).json({
      message: "Re-autenticado com sucesso!",
      user: { email: user.email, saldo: user.saldo },
    });
  } catch (error) {
    res.status(500).json({ message: "Ocorreu um erro no servidor." });
  }
});

// --- ROTA DE SOLICITAÇÃO DE SAQUE (JOGADOR) ---
app.post("/api/withdraw", async (req, res) => {
  try {
    const { email, amount, pixKey } = req.body;

    if (!email || !amount || !pixKey) {
      return res.status(400).json({ message: "Dados incompletos." });
    }
    if (amount <= 0) {
      return res.status(400).json({ message: "Valor inválido." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }

    if (user.saldo < amount) {
      return res
        .status(400)
        .json({ message: "Saldo insuficiente para o saque." });
    }

    const newWithdrawal = new Withdrawal({
      email,
      amount,
      pixKey,
      status: "pending",
    });

    await newWithdrawal.save();

    res.status(201).json({
      message: "Solicitação de saque enviada com sucesso! Aguarde a aprovação.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erro ao processar solicitação." });
  }
});

// --- ROTAS DA API DE ADMINISTRAÇÃO ---

const adminAuthHeader = (req, res, next) => {
  const secretKey = req.headers["x-admin-secret-key"];
  if (secretKey && secretKey === process.env.ADMIN_SECRET_KEY) {
    next();
  } else {
    res.status(403).json({ message: "Acesso não autorizado." });
  }
};

const adminAuthBody = (req, res, next) => {
  const { secret } = req.body;
  if (secret && secret === process.env.ADMIN_SECRET_KEY) {
    next();
  } else {
    res.status(403).json({ message: "Acesso não autorizado." });
  }
};

app.get("/api/admin/users", adminAuthHeader, async (req, res) => {
  try {
    const users = await User.find({}, "email saldo").sort({ email: 1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar usuários no servidor." });
  }
});

// ### ROTA ADMIN: LISTAR SAQUES PENDENTES (ADICIONADA) ###
app.get("/api/admin/withdrawals", adminAuthHeader, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ status: "pending" }).sort({
      createdAt: 1,
    });
    res.json(withdrawals);
  } catch (error) {
    res.status(500).json({ message: "Erro ao buscar solicitações." });
  }
});

// ### ROTA ADMIN: APROVAR SAQUE (ADICIONADA) ###
app.post("/api/admin/approve-withdrawal", adminAuthBody, async (req, res) => {
  try {
    const { withdrawalId } = req.body;

    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) {
      return res.status(404).json({ message: "Solicitação não encontrada." });
    }
    if (withdrawal.status !== "pending") {
      return res
        .status(400)
        .json({ message: "Esta solicitação já foi processada." });
    }

    const user = await User.findOne({ email: withdrawal.email });
    if (!user) {
      return res
        .status(404)
        .json({ message: "Usuário da solicitação não encontrado." });
    }

    if (user.saldo < withdrawal.amount) {
      return res.status(400).json({
        message: `ERRO: O usuário tem saldo insuficiente (${user.saldo}) para este saque de ${withdrawal.amount}.`,
      });
    }

    user.saldo -= withdrawal.amount;
    await user.save();

    withdrawal.status = "completed";
    await withdrawal.save();

    res.json({ message: "Saque aprovado e saldo descontado com sucesso!" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erro ao aprovar saque." });
  }
});

// ### ROTA ADMIN: REJEITAR SAQUE (ADICIONADA) ###
app.post("/api/admin/reject-withdrawal", adminAuthBody, async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal)
      return res.status(404).json({ message: "Solicitação não encontrada." });

    withdrawal.status = "rejected";
    await withdrawal.save();

    res.json({ message: "Solicitação rejeitada (saldo não foi alterado)." });
  } catch (error) {
    res.status(500).json({ message: "Erro ao rejeitar." });
  }
});

app.put("/api/admin/update-saldo", adminAuthBody, async (req, res) => {
  try {
    const { email, newSaldo } = req.body;
    if (!email || newSaldo === undefined) {
      return res
        .status(400)
        .json({ message: "Email ou novo saldo não fornecido." });
    }
    const result = await User.updateOne(
      { email: email },
      { $set: { saldo: Number(newSaldo) } }
    );
    if (result.nModified === 0) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }
    res.json({ message: "Saldo atualizado com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Erro ao atualizar saldo no servidor." });
  }
});

app.delete("/api/admin/user/:email", adminAuthBody, async (req, res) => {
  try {
    const result = await User.deleteOne({ email: req.params.email });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Usuário não encontrado." });
    }
    res.json({ message: "Usuário excluído com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Erro ao excluir usuário no servidor." });
  }
});

app.post("/api/admin/reset-all-saldos", adminAuthBody, async (req, res) => {
  try {
    await User.updateMany({}, { $set: { saldo: 0 } });
    res.json({ message: "Todos os saldos foram zerados com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Erro ao zerar saldos no servidor." });
  }
});

initializeManager(io, gameRooms);
initializeSocket(io);

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Servidor a rodar em http://${HOST}:${PORT}.`);
});
