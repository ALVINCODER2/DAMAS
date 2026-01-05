// index.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const { monitorEventLoopDelay } = require("perf_hooks");
const mongoose = require("mongoose");

// Metrics and monitoring holders
let eventLoopMonitorHandle = null;
const serverMetrics = {
  eventLoop: { meanMs: 0, maxMs: 0 },
};
const User = require("./models/User");
const Withdrawal = require("./models/Withdrawal");
const MatchHistory = require("./models/MatchHistory");
const Transaction = require("./models/Transaction");
const bcrypt = require("bcryptjs");
// Simple concurrency limiter for expensive operations (like bcrypt.compare)
const LOGIN_CONCURRENCY = Number(process.env.LOGIN_CONCURRENCY) || 4;
let loginRunning = 0;
const loginQueue = [];
function acquireLoginSlot() {
  return new Promise((resolve) => {
    if (loginRunning < LOGIN_CONCURRENCY) {
      loginRunning++;
      return resolve();
    }
    loginQueue.push(resolve);
  });
}
function releaseLoginSlot() {
  loginRunning--;
  const next = loginQueue.shift();
  if (next) {
    loginRunning++;
    next();
  }
}

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
  // OTIMIZAÇÃO: Timeouts ultra-agressivos para detecção rápida de desconexão
  // Essencial para jogos com timer de 5s - detecta desconexão em ~4-6 segundos
  pingInterval: 2000,  // era 30000 (2s)
  pingTimeout: 4000,   // era 90000 (4s)
  
  // Forçar uso de WebSocket para reduzir latência (evita polling)
  transports: ["websocket"],
  
  // Compatibilidade com clients Engine.IO v3 quando necessário
  allowEIO3: true,
  
  // OTIMIZAÇÃO CRÍTICA: Habilitar compressão WebSocket (redução de 40-60%)
  perMessageDeflate: {
    threshold: 512, // comprimir apenas mensagens > 512 bytes
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 6, // balanço entre compressão e CPU
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024,
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
  },
  
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// If REDIS_URL is provided, configure Socket.IO Redis adapter for horizontal scaling
try {
  const REDIS_URL = process.env.REDIS_URL;
  if (REDIS_URL) {
    const { createAdapter } = require("@socket.io/redis-adapter");
    const { createClient } = require("redis");
    const pubClient = createClient({ url: REDIS_URL });
    const subClient = pubClient.duplicate();
    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        io.adapter(createAdapter(pubClient, subClient));
        console.log("Socket.IO Redis adapter enabled");
      })
      .catch((e) => {
        try {
          console.warn(
            "Failed to connect Redis for Socket.IO adapter, continuing without adapter:",
            e
          );
        } catch (er) {}
      });
  }
} catch (e) {}

// Subscribe to Redis notifications for match saves so main process can update cache and emit
try {
  const REDIS_URL = process.env.REDIS_URL;
  if (REDIS_URL) {
    const { createClient } = require("redis");
    let notifClient = null;

    async function startNotifClient() {
      try {
        notifClient = createClient({ url: REDIS_URL });
        notifClient.on("error", (e) => {
          try {
            console.warn(
              "Redis notif client error:",
              e && e.message ? e.message : e
            );
          } catch (er) {}
        });

        notifClient.on("end", () => {
          try {
            console.warn(
              "Redis notif client disconnected, will reconnect in 5s"
            );
          } catch (er) {}
          setTimeout(() => startNotifClient(), 5000);
        });

        await notifClient.connect();
        await notifClient.subscribe("damas:matchSaved", (msg) => {
          try {
            const m = JSON.parse(msg);
            try {
              app.locals.recentMatchCache = app.locals.recentMatchCache || [];
              app.locals.recentMatchCache.unshift(m);
              if (app.locals.recentMatchCache.length > 500)
                app.locals.recentMatchCache.length = 500;
            } catch (e) {}

            try {
              if (io) {
                io.emit("matchRecorded", m);
                io.recentMatchCache = app.locals.recentMatchCache;
              }
            } catch (e) {}
          } catch (e) {}
        });
        try {
          console.log("Redis notif client subscribed to damas:matchSaved");
        } catch (e) {}
      } catch (e) {
        try {
          console.warn(
            "Failed to start Redis notif client, retrying in 5s:",
            e && e.message ? e.message : e
          );
        } catch (er) {}
        try {
          if (notifClient) notifClient.disconnect().catch(() => {});
        } catch (er) {}
        setTimeout(() => startNotifClient(), 5000);
      }
    }

    startNotifClient();
  }
} catch (e) {}

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
  .then(async () => {
    console.log("Conectado ao MongoDB Atlas com sucesso!");
    // Ao iniciar o servidor, carregamos os históricos recentes para cache
    try {
      const cutoffMs =
        Number(process.env.RECENT_MATCHES_RETENTION_MS) || 24 * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - cutoffMs);
      const recents = await MatchHistory.find({ createdAt: { $gte: cutoff } })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();

      // Guarda em memória para consultas rápidas
      app.locals.recentMatchCache = recents;

      // Estatísticas rápidas: vitórias/derrotas/empates (relativas ao registro, não por usuário)
      let wins = 0,
        losses = 0,
        draws = 0;
      for (const r of recents) {
        if (!r.winner) draws++;
        else wins++; // tratamos qualquer registro com `winner` como partida com vencedor
      }
      losses = recents.length - wins - draws;
      console.log(
        `[Boot] Carregados ${recents.length} partidas recentes: vitórias~${wins} empates~${draws} perdas~${losses}`
      );

      // Emitir para clientes conectados uma lista inicial (até 100)
      try {
        if (io) {
          io.emit("bootRecentMatches", recents.slice(0, 100));
        }
      } catch (e) {}
    } catch (e) {
      console.warn("Erro ao carregar histórico inicial:", e);
    }
  })
  .catch((err) => console.error("Erro ao conectar ao MongoDB:", err));

// Carrega handlers locais para jobs serializáveis (processamento in-memory quando não há Redis).
try {
  const jobHandlers = require("./src/jobHandlers");
  if (jobHandlers && jobHandlers.processJob) {
    console.log("Local job handlers loaded");
  }
} catch (e) {
  console.warn("Could not load local job handlers:", e);
}

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
    await acquireLoginSlot();
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password);
    } finally {
      releaseLoginSlot();
    }
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
    console.error("/api/login error:", error);
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
    console.error("/api/user/re-authenticate error:", error);
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
    const emailLower = email.toLowerCase();
    // Retornar apenas partidas das últimas 24 horas
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const history = await MatchHistory.find({
      $and: [
        { createdAt: { $gte: cutoff } },
        { $or: [{ player1: emailLower }, { player2: emailLower }] },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(history);
  } catch (err) {
    res.status(500).json({ message: "Erro." });
  }
});

// Nota: limpeza automática do histórico movida para `src/worker.js`
// para evitar bloquear a thread principal do servidor.

// Rota para limpar histórico do usuário
app.delete("/api/user/history", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });
    const emailLower = email.toLowerCase();
    // Deleta entradas em que o usuário participou
    const result = await MatchHistory.deleteMany({
      $or: [{ player1: emailLower }, { player2: emailLower }],
    });
    return res.json({
      message: "Histórico limpo.",
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error("Erro ao limpar histórico:", err);
    return res.status(500).json({ message: "Erro ao limpar histórico." });
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

// --- ROTAS ADMIN SIMPLES (PROTEGIDAS POR ADMIN SECRET) ---
function checkAdminSecret(req, res) {
  // If ADMIN_SECRET is not set in the environment, do NOT require a secret.
  const secret = process.env.ADMIN_SECRET || null;
  if (!secret) return true;
  const header =
    req.headers["x-admin-secret-key"] || (req.body && req.body.secret);
  if (!header) return false;
  return header === secret;
}

app.get("/api/admin/users/no-deposit", async (req, res) => {
  try {
    if (!checkAdminSecret(req, res))
      return res.status(403).json({ message: "Forbidden" });
    const weeks = parseInt(req.query.weeks, 10) || 2;
    const cutoff = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);
    // ObjectId contains timestamp; use aggregation to filter by creation time
    const users = await User.find({ hasDeposited: { $ne: true } }).lean();
    const filtered = users
      .filter((u) => {
        try {
          const ts = u._id && u._id.getTimestamp ? u._id.getTimestamp() : null;
          if (!ts) return false;
          return ts < cutoff;
        } catch (e) {
          return false;
        }
      })
      .map((u) => ({
        email: u.email,
        username: u.username,
        saldo: u.saldo || 0,
        referredBy: u.referredBy || null,
        createdAt: u._id && u._id.getTimestamp ? u._id.getTimestamp() : null,
      }));
    res.json(filtered);
  } catch (e) {
    console.error("admin no-deposit error:", e);
    res.status(500).json({ message: "Erro interno" });
  }
});

app.get("/api/admin/users/with-balance", async (req, res) => {
  try {
    if (!checkAdminSecret(req, res))
      return res.status(403).json({ message: "Forbidden" });
    const users = await User.find({ saldo: { $gt: 0 } }).lean();
    const mapped = users.map((u) => ({
      email: u.email,
      username: u.username,
      saldo: u.saldo || 0,
      referredBy: u.referredBy || null,
    }));
    res.json(mapped);
  } catch (e) {
    console.error("admin with-balance error:", e);
    res.status(500).json({ message: "Erro interno" });
  }
});

app.delete("/api/admin/users/:email", async (req, res) => {
  try {
    if (!checkAdminSecret(req, res))
      return res.status(403).json({ message: "Forbidden" });
    const email = req.params.email;
    if (!email) return res.status(400).json({ message: "Email obrigatório" });
    const deleted = await User.findOneAndDelete({ email: email.toLowerCase() });
    if (!deleted)
      return res.status(404).json({ message: "Usuário não encontrado" });
    return res.json({ message: "Usuário removido" });
  } catch (e) {
    console.error("admin delete user error:", e);
    res.status(500).json({ message: "Erro interno" });
  }
});

app.post("/api/withdraw", async (req, res) => {
  try {
    const { email, amount, pixKey } = req.body;
    if (!email || !amount || !pixKey)
      return res.status(400).json({ message: "Dados incompletos." });
    if (amount <= 0)
      return res.status(400).json({ message: "Valor inválido." });
    // Enforce minimum withdrawal amount (R$10)
    if (amount < 10)
      return res
        .status(400)
        .json({ message: "Valor mínimo para saque é R$10." });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ message: "Usuário não encontrado." });
    if (user.saldo < amount)
      return res.status(400).json({ message: "Saldo insuficiente." });
    // Impede múltiplas solicitações pendentes
    const existing = await Withdrawal.findOne({
      email: email.toLowerCase(),
      status: "pending",
    });
    if (existing)
      return res
        .status(409)
        .json({ message: "Já existe uma solicitação de saque pendente." });
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

// Endpoint para o cliente checar se existe saque pendente
app.get("/api/withdraw/check", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email obrigatório." });
    const pending = await Withdrawal.findOne({
      email: email.toLowerCase(),
      status: "pending",
    });
    if (pending) return res.json({ hasPending: true, pendingId: pending._id });
    return res.json({ hasPending: false });
  } catch (err) {
    console.error("Erro em /api/withdraw/check:", err);
    res.status(500).json({ message: "Erro interno." });
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
// Admin authentication: require ADMIN_SECRET_KEY when configured
const adminAuthBody = (req, res, next) => {
  const secretEnv = process.env.ADMIN_SECRET_KEY;
  if (!secretEnv) return next();
  const { secret } = req.body;
  if (secret && secret === secretEnv) return next();
  return res.status(403).json({ message: "Acesso não autorizado." });
};
const adminAuthHeader = (req, res, next) => {
  const secretEnv = process.env.ADMIN_SECRET_KEY;
  if (!secretEnv) return next();
  const secretKey = req.headers["x-admin-secret-key"];
  if (secretKey && secretKey === secretEnv) return next();
  return res.status(403).json({ message: "Acesso não autorizado." });
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
  if (!withdrawalId)
    return res.status(400).json({ message: "withdrawalId é obrigatório." });
  try {
    const w = await Withdrawal.findById(withdrawalId);
    if (!w) return res.status(404).json({ message: "Saque não encontrado." });
    if (w.status !== "pending")
      return res.status(400).json({ message: "Saque não está pendente." });
    const u = await User.findOne({ email: w.email });
    if (!u)
      return res
        .status(404)
        .json({ message: "Usuário do saque não encontrado." });
    if (u.saldo < w.amount)
      return res
        .status(409)
        .json({ message: "Saldo insuficiente para completar o saque." });

    u.saldo -= w.amount;
    await u.save();
    w.status = "completed";
    await w.save();

    io.emit("balanceUpdate", { email: u.email, newSaldo: u.saldo });

    return res.json({ message: "Aprovado" });
  } catch (err) {
    console.error("Erro em /api/admin/approve-withdrawal:", err);
    return res.status(500).json({ message: "Erro interno" });
  }
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

// Debug endpoint removed — use gameplay or admin tools to test.

// Inicialização
initializeManager(io, gameRooms);
// UPDATE: Passa gameRooms para o tournamentManager
tournamentManager.initializeTournamentManager(io, gameRooms);
setTournamentManager(tournamentManager);
initializeSocket(io);

// Periodic poll to fetch new MatchHistory entries from DB in case
// Redis notifications are unavailable. This ensures eventual
// consistency and that clients receive `matchRecorded` events.
try {
  const POLL_INTERVAL_MS = Number(process.env.RECENT_MATCHES_POLL_MS) || 15000;
  let _lastSeenTs = Date.now();
  try {
    if (
      app.locals &&
      Array.isArray(app.locals.recentMatchCache) &&
      app.locals.recentMatchCache.length
    ) {
      const first = app.locals.recentMatchCache[0];
      _lastSeenTs = new Date(first.createdAt).getTime();
    }
  } catch (e) {}

  async function pollNewMatches() {
    try {
      const cutoff = new Date(_lastSeenTs);
      const docs = await MatchHistory.find({ createdAt: { $gt: cutoff } })
        .sort({ createdAt: 1 })
        .limit(200)
        .lean();

      if (!docs || docs.length === 0) return;

      for (const m of docs) {
        try {
          // prepend to app.locals cache
          try {
            app.locals.recentMatchCache = app.locals.recentMatchCache || [];
            app.locals.recentMatchCache.unshift(m);
            if (app.locals.recentMatchCache.length > 500)
              app.locals.recentMatchCache.length = 500;
          } catch (e) {}

          // emit to clients and update io cache
          try {
            if (io) {
              io.emit("matchRecorded", m);
              io.recentMatchCache = io.recentMatchCache || [];
              io.recentMatchCache.unshift(m);
              if (io.recentMatchCache.length > 500)
                io.recentMatchCache.length = 500;
            }
          } catch (e) {}

          const ts = new Date(m.createdAt).getTime();
          if (ts > _lastSeenTs) _lastSeenTs = ts;
        } catch (e) {}
      }
    } catch (e) {
      console.error(
        "recentMatches poll error:",
        e && e.message ? e.message : e
      );
    }
  }

  // start poll shortly after boot
  setTimeout(() => {
    try {
      pollNewMatches();
      setInterval(pollNewMatches, POLL_INTERVAL_MS).unref &&
        setInterval(pollNewMatches, POLL_INTERVAL_MS).unref();
    } catch (e) {}
  }, 5000);
} catch (e) {}

// --- Monitor simples de event-loop (ajuda a diagnosticar latência do servidor)
try {
  if (monitorEventLoopDelay) {
    eventLoopMonitorHandle = monitorEventLoopDelay({ resolution: 20 });
    eventLoopMonitorHandle.enable();
    setInterval(() => {
      try {
        const meanMs = (eventLoopMonitorHandle.mean || 0) / 1e6;
        const maxMs = (eventLoopMonitorHandle.max || 0) / 1e6;
        serverMetrics.eventLoop.meanMs = meanMs;
        serverMetrics.eventLoop.maxMs = maxMs;
        if (meanMs > 40 || maxMs > 200) {
          console.warn(
            `[EventLoopLag] mean=${meanMs.toFixed(1)}ms max=${maxMs.toFixed(
              1
            )}ms`
          );
        }
        // reset counters for next interval
        eventLoopMonitorHandle.reset();
      } catch (e) {}
    }, 10000);
  }
} catch (e) {}

// Lightweight metrics endpoint for diagnostics
app.get("/metrics", async (req, res) => {
  try {
    const payload = { ...serverMetrics, clients: [] };
    if (io && io.fetchSockets) {
      try {
        const sockets = await io.fetchSockets();
        payload.clients = sockets.map((s) => ({
          id: s.id,
          lastLatency:
            s.userData && s.userData.lastLatency
              ? s.userData.lastLatency
              : null,
        }));
      } catch (e) {}
    }
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: "metrics error" });
  }
});

// Public endpoint: retorna partidas recentes (últimas N) sem exigir autenticação
app.get("/api/recent-matches", async (req, res) => {
  try {
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit || "50", 10))
    );
    const cutoffMs =
      Number(process.env.RECENT_MATCHES_RETENTION_MS) || 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - cutoffMs);
    // If an in-process recentMatchCache exists (populated at boot or via Redis),
    // prefer it for immediate consistency instead of querying the DB.
    try {
      if (
        io &&
        Array.isArray(io.recentMatchCache) &&
        io.recentMatchCache.length
      ) {
        const filtered = io.recentMatchCache.filter((m) => {
          try {
            return new Date(m.createdAt) >= cutoff;
          } catch (e) {
            return false;
          }
        });
        return res.json(filtered.slice(0, limit));
      }
    } catch (e) {}

    const recents = await MatchHistory.find({ createdAt: { $gte: cutoff } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json(recents);
  } catch (e) {
    console.error("/api/recent-matches error:", e);
    res.status(500).json({ error: "failed" });
  }
});

// Debug: listar últimos registros de MatchHistory (requer ADMIN_SECRET_KEY quando configurada)
app.get("/debug/recent-history", adminAuthHeader, async (req, res) => {
  try {
    const limit = Math.min(
      200,
      Math.max(1, parseInt(req.query.limit || "50", 10))
    );
    const recents = await MatchHistory.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ count: recents.length, records: recents });
  } catch (e) {
    console.error("/debug/recent-history error:", e);
    res.status(500).json({ error: "failed" });
  }
});

// Rotina de limpeza automática MOVIDA para `src/worker.js` para não
// bloquear o event loop do processo principal.

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
