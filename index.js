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

const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

const { initializeSocket, gameRooms } = require("./src/socketHandlers");
const {
  initializeManager,
  setTournamentManager,
} = require("./src/gameManager");
const tournamentManager = require("./src/tournamentManager");

const app = express();
app.set("trust proxy", 1);

const server = http.createServer(app);

// Configuração do Mercado Pago
const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const client = accessToken ? new MercadoPagoConfig({ accessToken }) : null;

const io = socketIo(server, {
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

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Conectado ao MongoDB Atlas com sucesso!"))
  .catch((err) => console.error("Erro ao conectar ao MongoDB:", err));

// --- ROTAS DE API ---

app.post("/api/register", async (req, res) => {
  try {
    const { email, password, referralCode } = req.body;
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
    if (!email || !password)
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
        referralEarnings: user.referralEarnings,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Erro no servidor." });
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
        referralEarnings: user.referralEarnings,
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

// --- PAGAMENTO MERCADO PAGO ---
app.post("/api/payment/create_preference", async (req, res) => {
  try {
    if (!client)
      return res.status(500).json({ message: "Erro de configuração." });
    const { amount, email } = req.body;
    const amountNum = Number(amount);
    if (!amountNum || amountNum < 1)
      return res.status(400).json({ message: "Valor mínimo de R$ 1,00" });

    // ### REAJUSTE DE TAXA: Adiciona 1% ao valor total ###
    // O valor pago cobrirá a taxa de ~0.99% do PIX
    const amountWithFee = amountNum * 1.01;
    // Arredonda para 2 casas decimais
    const finalAmountToPay = Math.round(amountWithFee * 100) / 100;

    const preference = new Preference(client);
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host;
    const notificationUrl = `${protocol}://${host}/api/payment/webhook`;
    const backUrl = `${protocol}://${host}/`;

    // ### ALTERAÇÃO AQUI: EXCLUINDO TUDO MENOS PIX ###
    const result = await preference.create({
      body: {
        items: [
          {
            title: `Créditos Damas (${amountNum.toFixed(2)}) + Taxa PIX`,
            quantity: 1,
            unit_price: finalAmountToPay, // Cobra o valor com taxa
            currency_id: "BRL",
          },
        ],
        payment_methods: {
          excluded_payment_types: [
            { id: "ticket" }, // Boleto
            { id: "credit_card" }, // Cartão de Crédito
            { id: "debit_card" }, // Cartão de Débito
            { id: "account_money" }, // ### NOVO: Bloqueia pagamento com Saldo MP ###
            { id: "digital_currency" }, // Criptomoedas
            { id: "digital_wallet" }, // Carteiras digitais
          ],
          installments: 1,
        },
        // Salva email E valor original dos créditos no external_reference
        external_reference: JSON.stringify({
          email: email,
          credits: amountNum,
        }),
        notification_url: notificationUrl,
        back_urls: { success: backUrl, failure: backUrl, pending: backUrl },
        auto_return: "approved",
      },
    });
    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erro ao gerar pagamento." });
  }
});

app.post("/api/payment/webhook", async (req, res) => {
  const { data, type } = req.body;
  res.sendStatus(200);
  if (type === "payment" || req.body.action === "payment.created") {
    try {
      if (!client) return;
      const paymentId = data ? data.id : req.body.data.id;
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

        // Tenta extrair dados do external_reference (JSON ou String legada)
        try {
          // Verifica se é JSON (novo formato com créditos definidos)
          const refData = JSON.parse(payment.external_reference);
          if (refData && refData.email) {
            userEmail = refData.email;
            creditsToAdd = Number(refData.credits);
          }
        } catch (e) {
          // Se falhar o parse, assume formato antigo (apenas email)
          userEmail = payment.external_reference;
          // Se for formato antigo, usamos o valor total pago como crédito
          // (ou poderíamos descontar a taxa manualmente aqui, mas é mais seguro dar o crédito full)
          creditsToAdd = payment.transaction_amount;
        }

        if (!userEmail) return;

        const user = await User.findOne({ email: userEmail.toLowerCase() });
        if (user) {
          user.saldo += creditsToAdd;

          if (!user.hasDeposited) {
            user.firstDepositValue = creditsToAdd;
            user.hasDeposited = true;
            // Bônus de indicação
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
            amount: creditsToAdd, // Salva o valor de CRÉDITOS, não o pago com taxa
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

    // --- CORREÇÃO: LÓGICA DE BÔNUS MANUAL ---
    // Verifica se o usuário ainda não depositou para processar o bônus
    if (!user.hasDeposited && amountVal > 0) {
      user.firstDepositValue = amountVal;
      user.hasDeposited = true;

      // Se o valor inserido manualmente for >= 5 e houver indicação
      if (amountVal >= 5 && user.referredBy) {
        const referrer = await User.findOne({ email: user.referredBy });
        if (referrer) {
          referrer.saldo += 1.0; // Adiciona R$ 1,00 ao indicador
          referrer.referralEarnings += 1.0;
          await referrer.save();

          // Notifica o indicador se ele estiver online
          io.emit("balanceUpdate", {
            email: referrer.email,
            newSaldo: referrer.saldo,
          });
        }
      }
    }
    // ----------------------------------------

    await user.save();

    // Notifica o usuário que recebeu o saldo
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

// Inicialização
initializeManager(io, gameRooms);
tournamentManager.initializeTournamentManager(io);
setTournamentManager(tournamentManager); // Injeta a dependência circular
initializeSocket(io);

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
});
