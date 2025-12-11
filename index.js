// index.js (COM NOTIFICAÇÃO EM TEMPO REAL)
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
const { initializeManager } = require("./src/gameManager");

const app = express();
const server = http.createServer(app);

// Configuração do Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
});

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) console.warn("Atenção: MONGO_URI não definida.");
if (!process.env.MERCADOPAGO_ACCESS_TOKEN)
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
    if (existingUser) {
      return res.status(400).json({ message: "Este e-mail já está em uso." });
    }

    const newUser = new User({ email: emailLower, password });

    if (referralCode) {
      const referralLower = referralCode.toLowerCase();
      const referrer = await User.findOne({ email: referralLower });
      if (referrer && referralLower !== emailLower) {
        newUser.referredBy = referralLower;
      }
    }

    await newUser.save();
    console.log(`[Registro] Novo usuário criado: ${emailLower}`);
    res.status(201).json({ message: "Usuário cadastrado com sucesso!" });
  } catch (error) {
    console.error("[Registro] Erro:", error);
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

// --- NOVAS ROTAS DE PAGAMENTO (MERCADO PAGO) ---

app.post("/api/payment/create_preference", async (req, res) => {
  try {
    const { amount, email } = req.body;
    const amountNum = Number(amount);

    if (!amountNum || amountNum < 1) {
      return res.status(400).json({ message: "Valor mínimo de R$ 1,00" });
    }

    const preference = new Preference(client);

    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host || "localhost:3000";
    const notificationUrl = `${protocol}://${host}/api/payment/webhook`;
    const backUrl = `${protocol}://${host}/`;

    console.log(`[MP] Criando preferência. Notificação: ${notificationUrl}`);

    const result = await preference.create({
      body: {
        items: [
          {
            title: "Créditos - Damas Online",
            quantity: 1,
            unit_price: amountNum,
            currency_id: "BRL",
          },
        ],
        payer: {
          email: email,
        },
        payment_methods: {
          excluded_payment_types: [
            { id: "ticket" },
            { id: "credit_card" },
            { id: "debit_card" },
          ],
          installments: 1,
        },
        external_reference: email,
        notification_url: notificationUrl,
        back_urls: {
          success: backUrl,
          failure: backUrl,
          pending: backUrl,
        },
      },
    });

    res.json({ init_point: result.init_point });
  } catch (error) {
    console.error("[MP] Erro ao criar preferência:", error);
    res.status(500).json({ message: "Erro ao gerar pagamento." });
  }
});

app.post("/api/payment/webhook", async (req, res) => {
  const { data, type } = req.body;

  res.sendStatus(200);

  if (type === "payment" || req.body.action === "payment.created") {
    try {
      const paymentId = data ? data.id : req.body.data.id;

      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: paymentId });

      if (payment && payment.status === "approved") {
        const userEmail = payment.external_reference;
        const amount = payment.transaction_amount;
        const paymentIdStr = payment.id.toString();

        const existingTx = await Transaction.findOne({
          paymentId: paymentIdStr,
        });
        if (existingTx) {
          console.log(`[Webhook] Pagamento ${paymentIdStr} já processado.`);
          return;
        }

        await Transaction.create({
          paymentId: paymentIdStr,
          email: userEmail,
          amount: amount,
          status: payment.status,
        });

        const user = await User.findOne({ email: userEmail.toLowerCase() });
        if (user) {
          user.saldo += amount;

          if (!user.hasDeposited) {
            user.firstDepositValue = amount;
            user.hasDeposited = true;

            if (amount >= 5 && user.referredBy) {
              const referrer = await User.findOne({ email: user.referredBy });
              if (referrer) {
                referrer.saldo += 1;
                referrer.referralEarnings += 1;
                await referrer.save();
                console.log(
                  `[Bônus] R$ 1,00 creditado para ${referrer.email} por indicação.`
                );
              }
            }
          }

          await user.save();
          console.log(
            `[Depósito Automático] R$ ${amount} adicionados para ${userEmail}`
          );

          // ### NOVO: Avisa o Frontend para atualizar o saldo na hora ###
          io.emit("balanceUpdate", { email: userEmail, newSaldo: user.saldo });
        }
      }
    } catch (error) {
      console.error("[Webhook] Erro ao processar:", error);
    }
  }
});

// --- ROTAS ADMIN (Mantidas) ---
const adminAuthBody = (req, res, next) => {
  const { secret } = req.body;
  if (secret && secret === process.env.ADMIN_SECRET_KEY) next();
  else res.status(403).json({ message: "Acesso não autorizado." });
};

app.put("/api/admin/add-saldo-bonus", adminAuthBody, async (req, res) => {
  try {
    const { email, amountToAdd } = req.body;
    const amount = Number(amountToAdd);
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ message: "Usuário não encontrado." });

    user.saldo += amount;
    let bonusMessage = "";

    if (!user.hasDeposited) {
      user.firstDepositValue = amount;
      user.hasDeposited = true;
      if (amount >= 5 && user.referredBy) {
        const referrer = await User.findOne({ email: user.referredBy });
        if (referrer) {
          referrer.saldo += 1;
          referrer.referralEarnings += 1;
          await referrer.save();
          bonusMessage = ` (Bônus creditado para ${referrer.email})`;
        }
      }
    }
    await user.save();
    res.json({ message: `Sucesso.${bonusMessage}` });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

const adminAuthHeader = (req, res, next) => {
  const secretKey = req.headers["x-admin-secret-key"];
  if (secretKey && secretKey === process.env.ADMIN_SECRET_KEY) next();
  else res.status(403).json({ message: "Acesso não autorizado." });
};

app.get("/api/admin/users", adminAuthHeader, async (req, res) => {
  try {
    const users = await User.find(
      {},
      "email saldo referredBy hasDeposited"
    ).sort({ email: 1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

app.get("/api/admin/withdrawals", adminAuthHeader, async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ status: "pending" }).sort({
      createdAt: 1,
    });
    res.json(withdrawals);
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

app.post("/api/admin/approve-withdrawal", adminAuthBody, async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal)
      return res.status(404).json({ message: "Não encontrada." });
    if (withdrawal.status !== "pending")
      return res.status(400).json({ message: "Já processado." });

    const user = await User.findOne({ email: withdrawal.email });
    if (!user)
      return res.status(404).json({ message: "Usuário não encontrado." });
    if (user.saldo < withdrawal.amount)
      return res.status(400).json({ message: "Saldo insuficiente." });

    user.saldo -= withdrawal.amount;
    await user.save();
    withdrawal.status = "completed";
    await withdrawal.save();
    res.json({ message: "Saque aprovado." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

app.post("/api/admin/reject-withdrawal", adminAuthBody, async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal)
      return res.status(404).json({ message: "Não encontrada." });
    withdrawal.status = "rejected";
    await withdrawal.save();
    res.json({ message: "Rejeitada." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

app.put("/api/admin/update-saldo", adminAuthBody, async (req, res) => {
  try {
    const { email, newSaldo } = req.body;
    const result = await User.updateOne(
      { email: email.toLowerCase() },
      { $set: { saldo: Number(newSaldo) } }
    );
    if (result.matchedCount === 0)
      return res.status(404).json({ message: "Usuário não encontrado." });
    res.json({ message: "Saldo atualizado." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

app.delete("/api/admin/user/:email", adminAuthBody, async (req, res) => {
  try {
    const result = await User.deleteOne({
      email: req.params.email.toLowerCase(),
    });
    if (result.deletedCount === 0)
      return res.status(404).json({ message: "Usuário não encontrado." });
    res.json({ message: "Excluído." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

app.post("/api/admin/reset-all-saldos", adminAuthBody, async (req, res) => {
  try {
    await User.updateMany({}, { $set: { saldo: 0 } });
    res.json({ message: "Saldos zerados." });
  } catch (error) {
    res.status(500).json({ message: "Erro." });
  }
});

initializeManager(io, gameRooms);
initializeSocket(io);

const HOST = process.env.HOST || "0.0.0.0";
server.listen(PORT, HOST, () => {
  console.log(`Servidor rodando em http://${HOST}:${PORT}`);
});
