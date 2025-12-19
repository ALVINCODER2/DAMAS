// index.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const User = require("./models/User");
const Withdrawal = require("./models/Withdrawal");
const MatchHistory = require("./models/MatchHistory");
const Transaction = require("./models/Transaction");
const bcrypt = require("bcryptjs");

// Importação do SDK
const { MercadoPagoConfig, Payment } = require("mercadopago");

const { initializeSocket, gameRooms } = require("./src/socketHandlers");
const {
  initializeManager,
  setTournamentManager,
} = require("./src/gameManager");
const tournamentManager = require("./src/tournamentManager");

// --- IMPORTAR CONSTANTES DE ABERTURA ---
const { idfTablitaOpenings } = require("./utils/constants");

const app = express();
app.set("trust proxy", 1);

const server = http.createServer(app);

// Configuração do Mercado Pago
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

const io = socketIo(server, {
  pingInterval: 25000,
  pingTimeout: 60000,
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) console.warn("Atenção: MONGO_URI não definida.");
if (!accessToken)
  console.warn("Atenção: MERCADOPAGO_ACCESS_TOKEN não definida.");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Evita 404 no favicon solicitando explicitamente um 204 (placeholder)
app.get("/favicon.ico", (req, res) => res.sendStatus(204));

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Conectado ao MongoDB Atlas com sucesso!"))
  .catch((err) => console.error("Erro ao conectar ao MongoDB:", err));

// --- ROTAS DE API ---

app.post("/api/register", async (req, res) => {
  try {
    const { email, password, referralCode } = req.body;

    // Validação de Segurança (Email e Senha)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ message: "Formato de e-mail inválido." });
    }
    if (!password || password.length < 6) {
      return res
        .status(400)
        .json({ message: "A senha deve ter no mínimo 6 caracteres." });
    }

    const emailLower = email.toLowerCase();
    const existingUser = await User.findOne({ email: emailLower });
    if (existingUser)
      return res.status(400).json({ message: "Este e-mail já está em uso." });
    const newUser = new User({ email: emailLower, password });
    if (referralCode) {
      const referralLower = referralCode.toLowerCase();
      const referrer = await User.findOne({ email: referralLower });
      if (referrer && referralLower !== emailLower)
        newUser.referredBy = referralLower;
    }
    await newUser.save();
    res.status(201).json({ message: "Usuário cadastrado com sucesso!" });
  } catch (error) {
    res.status(500).json({ message: "Ocorreu um erro no servidor." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email)
      return res.status(400).json({ message: "Email e senha obrigatórios." });
    if (!password)
      return res.status(400).json({ message: "Email e senha obrigatórios." });

    const emailLower = email.toLowerCase();
    const user = await User.findOne({ email: emailLower });
    if (!user) return res.status(400).json({ message: "Inválido." });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Inválido." });
    res.status(200).json({
      message: "Login bem-sucedido!",
      user: {
        email: user.email,
        saldo: user.saldo,
        username: user.username,
        avatar: user.avatar,
        referralEarnings: user.referralEarnings,
        preferences: user.preferences || {},
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Erro no servidor." });
  }
});

// ### NOVA ROTA DE ATUALIZAÇÃO DE PERFIL ###
app.put("/api/user/profile", async (req, res) => {
  try {
    const { email, username, avatar } = req.body;
    if (!email) return res.status(400).json({ message: "Email necessário." });

    // Verifica se o username já existe em OUTRO usuário
    if (username) {
      // Validação de Username (Segurança contra XSS e formato)
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({
          message: "O nome de usuário deve ter entre 3 e 20 caracteres.",
        });
      }
      // Permite apenas letras, números, espaços, underscores e hífens
      if (!/^[a-zA-Z0-9 _-]+$/.test(username)) {
        return res
          .status(400)
          .json({ message: "O nome de usuário contém caracteres inválidos." });
      }

      const existing = await User.findOne({ username: username });
      if (existing && existing.email !== email.toLowerCase()) {
        return res
          .status(400)
          .json({ message: "Este nome de usuário já está em uso." });
      }
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ message: "Usuário não encontrado." });

    user.username = username || user.username;
    user.avatar = avatar || user.avatar;

    await user.save();

    res.json({
      message: "Perfil atualizado!",
      user: {
        email: user.email,
        saldo: user.saldo,
        username: user.username,
        avatar: user.avatar,
        referralEarnings: user.referralEarnings,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Erro ao atualizar perfil." });
  }
});

app.post("/api/user/re-authenticate", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: "Não encontrado." });
    res.status(200).json({
      message: "Ok",
      user: {
        email: user.email,
        saldo: user.saldo,
        username: user.username,
        avatar: user.avatar,
        referralEarnings: user.referralEarnings,
        preferences: user.preferences || {},
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

app.post("/api/user/referrals", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });
    const referrals = await User.find(
      { referredBy: email.toLowerCase() },
      "email hasDeposited firstDepositValue"
    );
    res.json(referrals);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

app.post("/api/user/history", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });
    const history = await MatchHistory.find({
      $or: [{ player1: email.toLowerCase() }, { player2: email.toLowerCase() }],
    })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(history);
  } catch (err) {
    res.status(500).json({ message: "Erro." });
  }
});

// --- ROTAS DE PREFERÊNCIAS DO USUÁRIO ---
app.get("/api/user/preferences", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ message: "Usuário não encontrado." });
    res.json({ preferences: user.preferences || {} });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Erro." });
  }
});

app.put("/api/user/preferences", async (req, res) => {
  try {
    const { email, preferences } = req.body;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });
    if (!preferences || typeof preferences !== "object")
      return res.status(400).json({ message: "Preferences inválido." });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ message: "Usuário não encontrado." });

    user.preferences = Object.assign(user.preferences || {}, preferences);
    await user.save();

    res.json({
      message: "Preferências salvas.",
      preferences: user.preferences,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Erro ao salvar preferências." });
  }
});

app.post("/api/withdraw", async (req, res) => {
  try {
    const { email, amount, pixKey } = req.body;
    if (!email || !amount || !pixKey)
      return res.status(400).json({ message: "Dados incompletos." });
    if (amount <= 0)
      return res.status(400).json({ message: "Valor inválido." });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ message: "Usuário não encontrado." });
    if (user.saldo < amount)
      return res.status(400).json({ message: "Saldo insuficiente." });
    const newWithdrawal = new Withdrawal({
      email: email.toLowerCase(),
      amount,
      pixKey,
      status: "pending",
    });
    await newWithdrawal.save();
    res.status(201).json({ message: "Solicitação enviada." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

// --- ROTA DE TORNEIO ---
app.post("/api/tournament/register", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });

    const result = await tournamentManager.registerPlayer(email.toLowerCase());

    if (result.success) {
      const user = await User.findOne({ email: email.toLowerCase() });
      return res.json({ message: result.message, newSaldo: user.saldo });
    } else {
      return res.status(400).json({ message: result.message });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erro interno no torneio." });
  }
});

app.post("/api/tournament/leave", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });

    const result = await tournamentManager.unregisterPlayer(
      email.toLowerCase()
    );

    if (result.success) {
      const user = await User.findOne({ email: email.toLowerCase() });
      return res.json({ message: result.message, newSaldo: user.saldo });
    } else {
      return res.status(400).json({ message: result.message });
    }
  } catch (error) {
    res.status(500).json({ message: "Erro interno ao sair." });
  }
});

app.get("/api/tournament/status", async (req, res) => {
  try {
    const { email } = req.query; // Recebe o email para verificar se está inscrito
    const tournament = await tournamentManager.getTodaysTournament();

    let isRegistered = false;
    if (email && tournament.participants.includes(email.toLowerCase())) {
      isRegistered = true;
    }

    res.json({
      status: tournament.status,
      participantsCount: tournament.participants.length,
      entryFee: tournament.entryFee,
      prizePool: tournament.prizePool,
      winner: tournament.winner,
      runnerUp: tournament.runnerUp,
      isRegistered: isRegistered, // Retorna se o usuário está inscrito
    });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

// --- PAGAMENTO MERCADO PAGO (AGORA GERA PIX DIRETO) ---
app.post("/api/payment/create_preference", async (req, res) => {
  try {
    if (!client)
      return res.status(500).json({ message: "Erro de configuração." });
    const { amount, email } = req.body;
    const amountNum = Number(amount);
    if (!amountNum || amountNum < 1)
      return res.status(400).json({ message: "Valor mínimo de R$ 1,00" });

    // ### REAJUSTE DE TAXA: Adiciona 1% ao valor total ###
    const amountWithFee = amountNum * 1.01;
    // Arredonda para 2 casas decimais
    const finalAmountToPay = Math.round(amountWithFee * 100) / 100;

    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host;
    const notificationUrl = `${protocol}://${host}/api/payment/webhook`;

    // ### CRIAÇÃO DIRETA DE PAGAMENTO PIX ###
    const payment = new Payment(client);

    // Geração de ID único para idempotência (evitar duplicação se usuário clicar rápido)
    const idempotencyKey = `${email}-${Date.now()}`;

    const body = {
      transaction_amount: finalAmountToPay,
      description: `Créditos Damas (${amountNum.toFixed(2)})`,
      payment_method_id: "pix",
      payer: {
        email: email,
      },
      // Passa os dados para o webhook saber quem creditar
      external_reference: JSON.stringify({
        email: email,
        credits: amountNum,
      }),
      notification_url: notificationUrl,
    };

    const result = await payment.create({
      body,
      requestOptions: { idempotencyKey },
    });

    // Extrai o QR Code e o Código Copia e Cola
    const pointOfInteraction = result.point_of_interaction;
    const transactionData = pointOfInteraction
      ? pointOfInteraction.transaction_data
      : null;

    if (transactionData) {
      res.json({
        qr_code: transactionData.qr_code, // Código "Copia e Cola"
        qr_code_base64: transactionData.qr_code_base64, // Imagem Base64
        payment_id: result.id,
      });
    } else {
      throw new Error("Dados do PIX não retornados pelo Mercado Pago.");
    }
  } catch (error) {
    console.error("Erro MP (PIX):", error);
    res.status(500).json({ message: "Erro ao gerar PIX. Tente novamente." });
  }
});

app.post("/api/payment/webhook", async (req, res) => {
  // Validação de Segurança: Verifica assinatura ou ID de requisição para evitar flood
  const signature = req.headers["x-signature"] || req.headers["x-request-id"];
  if (!signature) {
    return res.status(403).json({ message: "Requisição não autorizada." });
  }

  const { data, type } = req.body;
  res.sendStatus(200);

  // Ouve notificações de pagamento (v1 ou v2)
  const isPayment =
    type === "payment" ||
    req.body.action === "payment.created" ||
    req.body.action === "payment.updated";

  if (isPayment) {
    try {
      if (!client) return;

      // Extração segura do ID
      const paymentId = data?.id || req.body?.data?.id;
      if (!paymentId) return;

      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: paymentId });

      if (payment && payment.status === "approved") {
        const paymentIdStr = payment.id.toString();
        const existingTx = await Transaction.findOne({
          paymentId: paymentIdStr,
        });
        if (existingTx) return;

        let userEmail = null;
        let creditsToAdd = 0;

        try {
          const refData = JSON.parse(payment.external_reference);
          if (refData && refData.email) {
            userEmail = refData.email;
            creditsToAdd = Number(refData.credits);
          }
        } catch (e) {
          userEmail = payment.external_reference;
          creditsToAdd = payment.transaction_amount;
        }

        if (!userEmail) return;

        const user = await User.findOne({ email: userEmail.toLowerCase() });
        if (user) {
          user.saldo += creditsToAdd;

          if (!user.hasDeposited) {
            user.firstDepositValue = creditsToAdd;
            user.hasDeposited = true;
            if (creditsToAdd >= 5 && user.referredBy) {
              const referrer = await User.findOne({ email: user.referredBy });
              if (referrer) {
                referrer.saldo += 1;
                referrer.referralEarnings += 1;
                await referrer.save();
              }
            }
          }

          await user.save();

          await Transaction.create({
            paymentId: paymentIdStr,
            email: userEmail,
            amount: creditsToAdd,
            status: payment.status,
          });

          io.emit("balanceUpdate", { email: userEmail, newSaldo: user.saldo });
        }
      }
    } catch (error) {
      console.error("[Webhook] Erro:", error);
    }
  }
});

// Admin routes
const adminAuthBody = (req, res, next) => {
  const { secret } = req.body;
  if (secret && secret === process.env.ADMIN_SECRET_KEY) next();
  else res.status(403).json({ message: "Acesso não autorizado." });
};
const adminAuthHeader = (req, res, next) => {
  const secretKey = req.headers["x-admin-secret-key"];
  if (secretKey && secretKey === process.env.ADMIN_SECRET_KEY) next();
  else res.status(403).json({ message: "Acesso não autorizado." });
};
app.put("/api/admin/add-saldo-bonus", adminAuthBody, async (req, res) => {
  try {
    const { email, amountToAdd } = req.body;
    const amountVal = Number(amountToAdd);
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user)
      return res.status(404).json({ message: "Usuário não encontrado." });

    user.saldo += amountVal;

    if (!user.hasDeposited && amountVal > 0) {
      user.firstDepositValue = amountVal;
      user.hasDeposited = true;

      if (amountVal >= 5 && user.referredBy) {
        const referrer = await User.findOne({ email: user.referredBy });
        if (referrer) {
          referrer.saldo += 1.0;
          referrer.referralEarnings += 1.0;
          await referrer.save();
          io.emit("balanceUpdate", {
            email: referrer.email,
            newSaldo: referrer.saldo,
          });
        }
      }
    }

    await user.save();
    io.emit("balanceUpdate", { email: user.email, newSaldo: user.saldo });

    res.json({
      message: "Saldo adicionado e bônus processado (se aplicável).",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Erro ao processar saldo." });
  }
});
app.get("/api/admin/users", adminAuthHeader, async (req, res) => {
  const users = await User.find({}, "email saldo referredBy hasDeposited").sort(
    { email: 1 }
  );
  res.json(users);
});
app.get("/api/admin/withdrawals", adminAuthHeader, async (req, res) => {
  const withdrawals = await Withdrawal.find({ status: "pending" }).sort({
    createdAt: 1,
  });
  res.json(withdrawals);
});
app.post("/api/admin/approve-withdrawal", adminAuthBody, async (req, res) => {
  const { withdrawalId } = req.body;
  const w = await Withdrawal.findById(withdrawalId);
  if (w && w.status === "pending") {
    const u = await User.findOne({ email: w.email });
    if (u && u.saldo >= w.amount) {
      u.saldo -= w.amount;
      await u.save();
      w.status = "completed";
      await w.save();
      return res.json({ message: "Aprovado" });
    }
  }
  res.status(400).json({ message: "Erro" });
});
app.post("/api/admin/reject-withdrawal", adminAuthBody, async (req, res) => {
  await Withdrawal.findByIdAndUpdate(req.body.withdrawalId, {
    status: "rejected",
  });
  res.json({ message: "Rejeitada." });
});
app.put("/api/admin/update-saldo", adminAuthBody, async (req, res) => {
  await User.updateOne(
    { email: req.body.email.toLowerCase() },
    { $set: { saldo: Number(req.body.newSaldo) } }
  );
  res.json({ message: "Atualizado." });
});
app.delete("/api/admin/user/:email", adminAuthBody, async (req, res) => {
  await User.deleteOne({ email: req.params.email.toLowerCase() });
  res.json({ message: "Excluído." });
});
app.post("/api/admin/reset-all-saldos", adminAuthBody, async (req, res) => {
  await User.updateMany({}, { $set: { saldo: 0 } });
  res.json({ message: "Saldos zerados." });
});

// --- ROTA DE ABERTURAS TABLITA (NOVO) ---
app.get("/api/admin/openings", adminAuthHeader, (req, res) => {
  res.json(idfTablitaOpenings);
});

// Inicialização
initializeManager(io, gameRooms);
// UPDATE: Passa gameRooms para o tournamentManager
tournamentManager.initializeTournamentManager(io, gameRooms);
setTournamentManager(tournamentManager);
initializeSocket(io);

// --- ROTINA DE LIMPEZA AUTOMÁTICA DE HISTÓRICO ---
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 Hora em milissegundos
const HISTORY_RETENTION = 24 * 60 * 60 * 1000; // 24 Horas em milissegundos

setInterval(async () => {
  try {
    const cutoffDate = new Date(Date.now() - HISTORY_RETENTION);

    const result = await MatchHistory.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    if (result.deletedCount > 0) {
      console.log(
        `[Limpeza Automática] Removidos ${result.deletedCount} registros de histórico com mais de 24 horas.`
      );
    }
  } catch (error) {
    console.error("[Limpeza Automática] Erro ao limpar histórico:", error);
  }
}, CLEANUP_INTERVAL);

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
});

// --- GRACEFUL SHUTDOWN (Reembolso em caso de reinício) ---
async function gracefulShutdown() {
  console.log(
    "\n⚠️  Recebido sinal de desligamento. Verificando partidas ativas..."
  );

  if (!gameRooms || Object.keys(gameRooms).length === 0) {
    console.log("✅ Nenhuma sala ativa. Encerrando.");
    process.exit(0);
  }

  const activeRooms = Object.values(gameRooms);
  const refundPromises = activeRooms.map(async (room) => {
    // Reembolsa apenas se:
    // 1. Tiver 2 jogadores (significa que a aposta foi cobrada de ambos)
    // 2. O jogo não estiver concluído
    // 3. Não for torneio (saldo gerido na inscrição)
    if (
      room.players.length === 2 &&
      !room.isGameConcluded &&
      !room.isTournament
    ) {
      try {
        const bet = Number(room.bet);
        if (bet > 0) {
          const p1Email = room.players[0].user.email;
          const p2Email = room.players[1].user.email;

          console.log(
            `🔄 Reembolsando ${bet} para ${p1Email} e ${p2Email} (Sala: ${room.roomCode})`
          );

          await User.findOneAndUpdate(
            { email: p1Email },
            { $inc: { saldo: bet } }
          );
          await User.findOneAndUpdate(
            { email: p2Email },
            { $inc: { saldo: bet } }
          );
        }
      } catch (err) {
        console.error(`❌ Erro ao reembolsar sala ${room.roomCode}:`, err);
      }
    }
  });

  await Promise.all(refundPromises);
  console.log("✅ Processo de reembolso finalizado. Tchau!");
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
