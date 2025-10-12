require("dotenv").config();
console.log("--- EXECUTANDO A VERSÃO MAIS RECENTE DO CÓDIGO (v3) ---");

// 1. Importações e Configuração
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const User = require("./models/User");
const bcrypt = require("bcryptjs");
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Conectado ao MongoDB Atlas com sucesso!"))
  .catch((err) => console.error("Erro ao conectar ao MongoDB:", err));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// 2. Rotas de API
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
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;
app.get("/api/admin/users", async (req, res) => {
  try {
    const secret = req.headers["x-admin-secret-key"];
    if (secret !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ message: "Acesso não autorizado." });
    }
    const users = await User.find({});
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Ocorreu um erro no servidor." });
  }
});
app.put("/api/admin/update-saldo", async (req, res) => {
  try {
    const { email, newSaldo, secret } = req.body;
    if (secret !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ message: "Acesso não autorizado." });
    }
    const saldoNumerico = Number(newSaldo);
    if (isNaN(saldoNumerico) || saldoNumerico < 0) {
      return res.status(400).json({ message: "Valor de saldo inválido." });
    }
    const updatedUser = await User.findOneAndUpdate(
      { email: email },
      { $set: { saldo: saldoNumerico } },
      { new: true }
    );
    if (!updatedUser) {
      return res.status(404).json({ message: "Utilizador não encontrado." });
    }
    res.status(200).json({
      message: `Saldo de ${email} atualizado para ${updatedUser.saldo}.`,
      user: updatedUser,
    });
  } catch (error) {
    res.status(500).json({ message: "Ocorreu um erro no servidor." });
  }
});
app.delete("/api/admin/user/:email", async (req, res) => {
  try {
    const { secret } = req.body;
    const { email } = req.params;
    if (secret !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ message: "Acesso não autorizado." });
    }
    const deletedUser = await User.findOneAndDelete({ email: email });
    if (!deletedUser) {
      return res.status(404).json({ message: "Utilizador não encontrado." });
    }
    res
      .status(200)
      .json({ message: `Utilizador ${email} foi excluído com sucesso.` });
  } catch (error) {
    res.status(500).json({ message: "Ocorreu um erro no servidor." });
  }
});
app.post("/api/admin/reset-all-saldos", async (req, res) => {
  try {
    const { secret } = req.body;
    if (secret !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ message: "Acesso não autorizado." });
    }
    await User.updateMany({}, { $set: { saldo: 0 } });
    res.status(200).json({
      message: "O saldo de todos os utilizadores foi zerado com sucesso!",
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Ocorreu um erro no servidor ao zerar os saldos." });
  }
});

// =========================================================
// ================== LÓGICA MULTIPLAYER ===================
// =========================================================
const gameRooms = {};

// Em index.js, substitui a constante standardOpening por esta versão corrigida

const standardOpening = [
  [0, "p", 0, "p", 0, "p", 0, "p"],
  ["p", 0, "p", 0, "p", 0, "p", 0],
  [0, "p", 0, "p", 0, "p", 0, "p"],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  ["b", 0, "b", 0, "b", 0, "b", 0],
  [0, "b", 0, "b", 0, "b", 0, "b"],
  ["b", 0, "b", 0, "b", 0, "b", 0],
];

// Em index.js, substitua a constante tablitaOpenings pela versão abaixo:

const tablitaOpenings = [
  // Configuração 1 (CORRIGIDA)
  [
    [0, "p", 0, "p", 0, "p", 0, "p"],
    ["p", 0, "p", 0, "p", 0, "p", 0],
    [0, 0, 0, "p", 0, "p", 0, "p"],
    ["p", 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, "b"],
    // A linha abaixo foi corrigida. As peças foram movidas para casas escuras.
    ["b", 0, "b", 0, "b", 0, 0, 0],
    [0, "b", 0, "b", 0, "b", 0, "b"],
    ["b", 0, "b", 0, "b", 0, "b", 0],
  ],
  // Configuração 2 (Esta já parecia correta, mas mantemos para consistência)
  [
    [0, "p", 0, "p", 0, "p", 0, "p"],
    ["p", 0, "p", 0, "p", 0, "p", 0],
    [0, "p", 0, 0, 0, "p", 0, "p"],
    [0, 0, "p", 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, "b", 0, 0],
    ["b", 0, "b", 0, 0, 0, "b", 0],
    [0, "b", 0, "b", 0, "b", 0, "b"],
    ["b", 0, "b", 0, "b", 0, "b", 0],
  ],
];

io.on("connection", (socket) => {
  console.log("Um novo usuário se conectou!", socket.id);

  socket.on("rejoinWaitingRoom", (data) => {
    const { roomCode, user } = data;
    if (!roomCode || !user) return;
    const room = gameRooms[roomCode];
    if (
      room &&
      room.players.length === 1 &&
      room.players[0].user.email === user.email
    ) {
      room.players[0].socketId = socket.id;
      socket.join(roomCode);
      if (room.disconnectTimeout) {
        clearTimeout(room.disconnectTimeout);
        room.disconnectTimeout = null;
      }
    }
  });

  socket.on("playerResign", () => {
    // Encontra a sala onde o jogador que desistiu está
    const roomCode = Array.from(socket.rooms).find((r) => r !== socket.id);
    const gameRoom = gameRooms[roomCode];

    if (!gameRoom || !gameRoom.game) return;

    // Determina quem é o vencedor e quem é o perdedor
    const loserSocketId = socket.id;
    const winnerSocketId =
      gameRoom.game.players.white === loserSocketId
        ? gameRoom.game.players.black
        : gameRoom.game.players.white;

    const winnerColor =
      gameRoom.game.players.white === winnerSocketId ? "b" : "p";
    const loserColor = winnerColor === "b" ? "p" : "b";

    // Chama a função existente para processar o fim do jogo
    processEndOfGame(winnerColor, loserColor, gameRoom, "Oponente desistiu.");
  });

  socket.on("rejoinActiveGame", (data) => {
    const { roomCode, user } = data;
    if (!roomCode || !user) return;
    const room = gameRooms[roomCode];
    if (room) {
      const player = room.players.find((p) => p.user.email === user.email);
      if (player) {
        if (room.disconnectTimeout) {
          clearTimeout(room.disconnectTimeout);
          room.disconnectTimeout = null;
        }
        player.socketId = socket.id;

        // Reatribui o socketId correto na estrutura do jogo
        if (room.game && room.game.users.white === user.email)
          room.game.players.white = socket.id;
        if (room.game && room.game.users.black === user.email)
          room.game.players.black = socket.id;

        // Reatribui o socketId na estrutura da partida (Tablita)
        if (room.match && room.match.player1.email === user.email)
          room.match.player1.socketId = socket.id;
        if (room.match && room.match.player2.email === user.email)
          room.match.player2.socketId = socket.id;

        socket.join(roomCode);
        io.to(roomCode).emit("gameResumed", {
          gameState: room.game,
          timeLeft: room.timeLeft,
        });
      }
    } else {
      socket.emit("gameNotFound");
    }
  });

  socket.on("getValidMoves", (data) => {
    const { row, col, roomCode } = data;
    const room = gameRooms[roomCode];
    if (!room || !room.game) return socket.emit("showValidMoves", []);
    const game = room.game;
    const piece = game.boardState[row][col];
    if (piece === 0) return socket.emit("showValidMoves", []);
    const playerColor = piece.toLowerCase();

    const validMoves = [];
    for (let toRow = 0; toRow < 8; toRow++) {
      for (let toCol = 0; toCol < 8; toCol++) {
        const moveCheck = isMoveValid(
          { row, col },
          { row: toRow, col: toCol },
          playerColor,
          game,
          true
        ); // Ignora regra da maioria para mostrar todas as jogadas
        if (moveCheck.valid) {
          validMoves.push({ row: toRow, col: toCol });
        }
      }
    }
    socket.emit("showValidMoves", validMoves);
  });

  socket.on("createRoom", async (data) => {
    if (!data || !data.user || !data.bet) {
      return socket.emit("joinError", {
        message: "Erro ao criar sala. Tente fazer o login novamente.",
      });
    }
    socket.userData = data.user;
    const bet = parseInt(data.bet, 10);
    const isTablita = data.isTablita;
    if (!bet || bet <= 0)
      return socket.emit("joinError", { message: "Aposta inválida." });
    const user = await User.findOne({ email: socket.userData.email });
    if (!user || user.saldo < bet) {
      const saldoAtual = user ? user.saldo : 0;
      return socket.emit("joinError", {
        message: `Saldo insuficiente. Você tem ${saldoAtual}, precisa de ${bet}.`,
      });
    }
    let roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    while (gameRooms[roomCode]) {
      roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    }
    socket.join(roomCode);
    gameRooms[roomCode] = {
      roomCode,
      bet,
      players: [{ socketId: socket.id, user: socket.userData }],
      isTablita: isTablita,
      timerInterval: null,
      timeLeft: 40,
      disconnectTimeout: null,
    };
    socket.emit("roomCreated", { roomCode });
  });

  socket.on("joinRoomRequest", async (data) => {
    if (!data || !data.user || !data.roomCode) return;
    socket.userData = data.user;
    const { roomCode } = data;
    const room = gameRooms[roomCode];
    if (!room)
      return socket.emit("joinError", { message: "Sala não encontrada." });
    if (room.players.length >= 2)
      return socket.emit("joinError", { message: "A sala já está cheia." });
    if (room.players[0].socketId === socket.id)
      return socket.emit("joinError", {
        message: "Você não pode entrar na sua própria sala.",
      });
    const user = await User.findOne({ email: socket.userData.email });
    if (!user || user.saldo < room.bet) {
      const saldoAtual = user ? user.saldo : 0;
      return socket.emit("joinError", {
        message: `Saldo insuficiente. A aposta é ${room.bet} e você tem ${saldoAtual}.`,
      });
    }
    socket.emit("confirmBet", {
      roomCode: room.roomCode,
      bet: room.bet,
      isTablita: room.isTablita,
    });
  });

  socket.on("acceptBet", async (data) => {
    if (!data || !data.user) return;
    socket.userData = data.user;
    const { roomCode } = data;
    const room = gameRooms[roomCode];
    if (!room || room.players.length >= 2) return;
    if (room.disconnectTimeout) {
      clearTimeout(room.disconnectTimeout);
      room.disconnectTimeout = null;
    }
    socket.join(roomCode);
    room.players.push({ socketId: socket.id, user: socket.userData });
    const player1 = room.players[0];
    const player2 = room.players[1];
    try {
      await User.findOneAndUpdate(
        { email: player1.user.email },
        { $inc: { saldo: -room.bet } }
      );
      await User.findOneAndUpdate(
        { email: player2.user.email },
        { $inc: { saldo: -room.bet } }
      );
    } catch (err) {
      io.to(roomCode).emit("joinError", {
        message: "Erro ao processar a aposta.",
      });
      delete gameRooms[roomCode];
      return;
    }

    let selectedBoard;
    if (room.isTablita) {
      const randomIndex = Math.floor(Math.random() * tablitaOpenings.length);
      selectedBoard = JSON.parse(JSON.stringify(tablitaOpenings[randomIndex]));
      room.match = {
        score: { [player1.user.email]: 0, [player2.user.email]: 0 },
        currentGame: 1,
        openingBoard: JSON.parse(JSON.stringify(selectedBoard)),
        player1: { email: player1.user.email, socketId: player1.socketId },
        player2: { email: player2.user.email, socketId: player2.socketId },
      };
    } else {
      selectedBoard = JSON.parse(JSON.stringify(standardOpening));
    }

    // --- LÓGICA DE SORTEIO DE CORES ---
    const isPlayer1White = Math.random() < 0.5;
    const whitePlayer = isPlayer1White ? player1 : player2;
    const blackPlayer = isPlayer1White ? player2 : player1;
    // ------------------------------------

    room.game = {
      players: { white: whitePlayer.socketId, black: blackPlayer.socketId },
      users: { white: whitePlayer.user.email, black: blackPlayer.user.email },
      boardState: selectedBoard,
      currentPlayer: "b", // As brancas SEMPRE começam, mas quem joga de brancas foi sorteado
      isFirstMove: true,
      movesSinceCapture: 0,
    };

    const gameState = { ...room.game, roomCode };
    io.to(roomCode).emit("gameStart", gameState);
  });

  // EM index.js, SUBSTITUA A SUA FUNÇÃO 'playerMove' POR ESTA

  socket.on("playerMove", async (moveData) => {
    const { from, to, room } = moveData;
    const gameRoom = gameRooms[room];
    if (!gameRoom || !gameRoom.game) return;
    const game = gameRoom.game;
    const playerColor = game.players.white === socket.id ? "b" : "p";
    if (playerColor !== game.currentPlayer) return;
    if (game.isFirstMove) {
      game.isFirstMove = false;
      startTimer(room);
    }
    const isValid = isMoveValid(from, to, playerColor, game);
    if (isValid.valid) {
      let piece = game.boardState[from.row][from.col];
      game.boardState[to.row][to.col] = piece;
      game.boardState[from.row][from.col] = 0;
      let canCaptureAgain = false;
      let wasPromotion = false;

      if (isValid.isCapture) {
        game.boardState[isValid.capturedPos.row][isValid.capturedPos.col] = 0;
        game.movesSinceCapture = 0;

        const nextCaptures = getAllPossibleCapturesForPiece(
          to.row,
          to.col,
          game
        );
        canCaptureAgain = nextCaptures.length > 0;
      }

      // <-- CORREÇÃO: A lógica de promoção foi movida para aqui
      // Uma peça só é promovida se NÃO PUDER capturar novamente na mesma jogada.
      if (!canCaptureAgain) {
        const currentPiece = game.boardState[to.row][to.col];
        if (currentPiece === "b" && to.row === 0) {
          game.boardState[to.row][to.col] = "B";
          wasPromotion = true;
        } else if (currentPiece === "p" && to.row === 7) {
          game.boardState[to.row][to.col] = "P";
          wasPromotion = true;
        }
      }

      // Se foi uma promoção, não pode haver outra captura (regra oficial)
      if (wasPromotion) {
        canCaptureAgain = false;
        game.movesSinceCapture = 0;
      } else if (!isValid.isCapture) {
        game.movesSinceCapture++;
      }

      if (game.movesSinceCapture >= 20) {
        return processEndOfGame(
          null,
          null,
          gameRoom,
          "Empate por 20 jogadas sem captura."
        );
      }

      const winner = checkWinCondition(
        game.boardState,
        game.currentPlayer,
        game
      );
      if (winner) {
        return processEndOfGame(
          winner,
          winner === "b" ? "p" : "b",
          gameRoom,
          "Fim de jogo!"
        );
      }

      // Troca o jogador apenas se não houver mais capturas a serem feitas
      if (!canCaptureAgain) {
        game.currentPlayer = game.currentPlayer === "b" ? "p" : "b";
        if (!hasValidMoves(game.currentPlayer, game)) {
          return processEndOfGame(
            game.currentPlayer === "b" ? "p" : "b",
            game.currentPlayer,
            gameRoom,
            "Oponente bloqueado!"
          );
        }
      }

      resetTimer(room);
      io.to(room).emit("gameStateUpdate", { ...game });
    } else {
      socket.emit("invalidMove", {
        message: isValid.reason || "Movimento inválido.",
      });
    }
  });

  socket.on("disconnect", () => {
    // ... (código de desconexão mantido como antes)
  });
});

// SUBSTITUA TODA A SUA FUNÇÃO processEndOfGame PELA VERSÃO ABAIXO

async function processEndOfGame(winnerColor, loserColor, room, reason) {
  if (!room) return;
  clearInterval(room.timerInterval);

  // Se for empate (de um jogo ou da partida inteira)
  if (!winnerColor || !loserColor) {
    // Se for o primeiro jogo de uma partida Tablita, prepara o segundo jogo.
    if (room.isTablita && room.match.currentGame === 1) {
      room.match.currentGame = 2;
      const scoreArray = [
        room.match.score[room.match.player1.email],
        room.match.score[room.match.player2.email],
      ];
      io.to(room.roomCode).emit("nextGameStarting", { score: scoreArray });
      setTimeout(() => startNextTablitaGame(room), 10000);
    } else {
      // Se for um empate final (jogo único ou partida Tablita), devolve a aposta.
      try {
        await User.findOneAndUpdate(
          { email: room.players[0].user.email },
          { $inc: { saldo: room.bet } }
        );
        await User.findOneAndUpdate(
          { email: room.players[1].user.email },
          { $inc: { saldo: room.bet } }
        );
        io.to(room.roomCode).emit("gameDraw", { reason });
      } catch (err) {
        console.error("Erro ao processar empate:", err);
      } finally {
        delete gameRooms[room.roomCode]; // Garante que a sala seja sempre eliminada
      }
    }
    return; // Sai da função
  }

  // Se houver um vencedor para o jogo atual
  const winnerData = room.players.find(
    (p) =>
      p.socketId === room.game.players[winnerColor === "b" ? "white" : "black"]
  );

  // Se for o primeiro jogo de uma partida Tablita, atualiza o placar e prepara o segundo jogo.
  if (room.isTablita && room.match.currentGame === 1) {
    room.match.score[winnerData.user.email]++;
    room.match.currentGame = 2;
    const scoreArray = [
      room.match.score[room.match.player1.email],
      room.match.score[room.match.player2.email],
    ];
    io.to(room.roomCode).emit("nextGameStarting", { score: scoreArray });
    setTimeout(() => startNextTablitaGame(room), 10000);
    return; // <-- CORREÇÃO 1: Adicionado o 'return' que faltava para evitar o 'fall-through'.
  }

  // Se for o fim de uma partida (jogo único ou segundo jogo da Tablita)
  let finalWinnerData;
  const prize = room.bet * 2;

  if (room.isTablita) {
    // Atualiza o placar final da partida Tablita
    room.match.score[winnerData.user.email]++;
    const p1Score = room.match.score[room.match.player1.email];
    const p2Score = room.match.score[room.match.player2.email];

    if (p1Score > p2Score) {
      finalWinnerData = room.match.player1;
    } else if (p2Score > p1Score) {
      finalWinnerData = room.match.player2;
    } else {
      // CORREÇÃO 2: Lógica de empate da PARTIDA Tablita simplificada
      try {
        await User.findOneAndUpdate(
          { email: room.players[0].user.email },
          { $inc: { saldo: room.bet } }
        );
        await User.findOneAndUpdate(
          { email: room.players[1].user.email },
          { $inc: { saldo: room.bet } }
        );
        io.to(room.roomCode).emit("gameDraw", {
          reason: "A partida terminou empatada.",
        });
      } catch (err) {
        console.error("Erro ao processar empate da partida:", err);
      } finally {
        delete gameRooms[room.roomCode];
      }
      return; // Sai da função
    }
  } else {
    // Se for um jogo Clássico, o vencedor do jogo é o vencedor final.
    finalWinnerData = winnerData;
  }

  // Bloco novo e corrigido
  // Paga o prémio ao vencedor final
  try {
    // CORREÇÃO: Acede ao email através de 'finalWinnerData.user.email'
    const winnerEmail = room.isTablita
      ? finalWinnerData.email
      : finalWinnerData.user.email;

    const updatedWinner = await User.findOneAndUpdate(
      { email: winnerEmail }, // <-- AGORA CORRETO
      { $inc: { saldo: prize } },
      { new: true }
    );

    io.to(room.roomCode).emit("gameOver", {
      winner: room.game.users.white === winnerEmail ? "b" : "p", // <-- AGORA CORRETO
      reason,
    });

    const winnerSocket = io.sockets.sockets.get(finalWinnerData.socketId);
    if (winnerSocket && updatedWinner) {
      // Adicionada verificação
      winnerSocket.emit("updateSaldo", { newSaldo: updatedWinner.saldo });
    }
  } catch (err) {
    console.error("Erro ao finalizar o jogo e pagar o prémio:", err);
  } finally {
    delete gameRooms[room.roomCode]; // Garante que a sala seja sempre eliminada
  }
}

function startNextTablitaGame(room) {
  if (!gameRooms[room.roomCode]) return;

  // Inverte os jogadores para o segundo jogo
  const player1 = room.match.player1;
  const player2 = room.match.player2;

  room.game = {
    players: { white: player2.socketId, black: player1.socketId },
    users: { white: player2.email, black: player1.email },
    boardState: JSON.parse(JSON.stringify(room.match.openingBoard)),
    currentPlayer: "b",
    isFirstMove: true,
    movesSinceCapture: 0,
  };
  const gameState = { ...room.game, roomCode: room.roomCode };
  io.to(room.roomCode).emit("gameStart", gameState);
  startTimer(room.roomCode);
}

// =========================================================
// ========= FUNÇÕES DE LÓGICA DO JOGO (ATUALIZADAS) =========
// =========================================================

// SUBSTITUA A SUA FUNÇÃO 'findBestCaptureMoves' POR ESTA
function findBestCaptureMoves(playerColor, game) {
  let bestMoves = [];
  let maxCaptures = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = game.boardState[r][c];
      // Verifica se a peça pertence ao jogador atual
      if (piece !== 0 && piece.toLowerCase() === playerColor) {
        const isDama = piece === piece.toUpperCase();
        // Encontra todas as sequências de captura para esta peça
        const sequences = findCaptureSequencesForPiece(
          r,
          c,
          game.boardState,
          isDama
        );

        sequences.forEach((seq) => {
          const numCaptures = seq.length - 1;

          // Se esta sequência captura mais peças que a melhor encontrada até agora
          if (numCaptures > maxCaptures) {
            maxCaptures = numCaptures; // Atualiza o número máximo de capturas
            bestMoves = [seq]; // Começa uma nova lista com esta sequência
          }
          // Se esta sequência captura o mesmo número de peças que a melhor atual
          else if (numCaptures === maxCaptures && maxCaptures > 0) {
            bestMoves.push(seq); // Adiciona à lista de melhores opções
          }
        });
      }
    }
  }
  return bestMoves;
}

// EM index.js, SUBSTITUA A FUNÇÃO ANTIGA POR ESTA VERSÃO CORRIGIDA

// NOVA FUNÇÃO RECURSIVA para encontrar sequências
function findCaptureSequencesForPiece(row, col, board, isDama) {
  let sequences = [];
  const piece = board[row][col];
  if (piece === 0) return []; // Verificação de segurança
  const opponentColor = piece.toLowerCase() === "b" ? "p" : "b";

  const directions = [
    { r: -1, c: -1 },
    { r: -1, c: 1 },
    { r: 1, c: -1 },
    { r: 1, c: 1 },
  ];

  for (const dir of directions) {
    if (isDama) {
      // Lógica de captura da Dama (mantém-se igual, pois já era robusta)
      let capturedPos = null;
      for (let i = 1; i < 8; i++) {
        const nextRow = row + i * dir.r;
        const nextCol = col + i * dir.c;
        if (nextRow < 0 || nextRow > 7 || nextCol < 0 || nextCol > 7) break;

        const pieceOnPath = board[nextRow][nextCol];
        if (pieceOnPath !== 0) {
          if (
            pieceOnPath.toLowerCase() === opponentColor &&
            board[nextRow + dir.r]?.[nextCol + dir.c] === 0
          ) {
            capturedPos = { row: nextRow, col: nextCol };

            for (let j = 1; j < 8; j++) {
              const landRow = capturedPos.row + j * dir.r;
              const landCol = capturedPos.col + j * dir.c;
              if (
                landRow < 0 ||
                landRow > 7 ||
                landCol < 0 ||
                landCol > 7 ||
                board[landRow]?.[landCol] !== 0
              )
                break;

              const newBoard = JSON.parse(JSON.stringify(board));
              newBoard[landRow][landCol] = newBoard[row][col];
              newBoard[row][col] = 0;
              newBoard[capturedPos.row][capturedPos.col] = 0;

              const nextSequences = findCaptureSequencesForPiece(
                landRow,
                landCol,
                newBoard,
                true // Continua como Dama
              );
              if (nextSequences.length > 0) {
                nextSequences.forEach((seq) =>
                  sequences.push([{ row, col }, ...seq])
                );
              } else {
                sequences.push([
                  { row, col },
                  { row: landRow, col: landCol },
                ]);
              }
            }
            break;
          } else {
            break;
          }
        }
      }
    } else {
      // Lógica de captura da Peça Comum (AQUI ESTÁ A CORREÇÃO)
      const capturedRow = row + dir.r;
      const capturedCol = col + dir.c;
      const landRow = row + 2 * dir.r;
      const landCol = col + 2 * dir.c;

      // Garante que a peça só capture para a frente
      const pieceColor = board[row][col].toLowerCase();
      const forwardDirection = pieceColor === "b" ? -1 : 1;
      if (dir.r !== forwardDirection) {
        continue; // Pula direções "para trás" para peças comuns
      }

      if (landRow >= 0 && landRow < 8 && landCol >= 0 && landCol < 8) {
        const capturedPiece = board[capturedRow]?.[capturedCol];
        const landingSquare = board[landRow]?.[landCol];
        if (
          capturedPiece &&
          capturedPiece.toLowerCase() === opponentColor &&
          landingSquare === 0
        ) {
          // --- INÍCIO DA LÓGICA CORRIGIDA ---
          let becomesDama = false;
          // Verifica se a peça vai aterrar na linha de promoção
          if (
            (pieceColor === "b" && landRow === 0) ||
            (pieceColor === "p" && landRow === 7)
          ) {
            becomesDama = true;
          }

          const newBoard = JSON.parse(JSON.stringify(board));
          newBoard[landRow][landCol] = newBoard[row][col];
          newBoard[row][col] = 0;
          newBoard[capturedRow][capturedCol] = 0;

          // A chamada recursiva agora passa 'becomesDama' como o novo status da peça
          const nextSequences = findCaptureSequencesForPiece(
            landRow,
            landCol,
            newBoard,
            becomesDama // <--- ESTA É A MUDANÇA CRÍTICA!
          );
          // --- FIM DA LÓGICA CORRIGIDA ---

          if (nextSequences.length > 0) {
            nextSequences.forEach((seq) =>
              sequences.push([{ row, col }, ...seq])
            );
          } else {
            sequences.push([
              { row, col },
              { row: landRow, col: landCol },
            ]);
          }
        }
      }
    }
  }
  return sequences;
}

// SUBSTITUA A SUA FUNÇÃO 'isMoveValid' POR ESTA
function isMoveValid(from, to, playerColor, game, ignoreMajorityRule = false) {
  const board = game.boardState;
  if (!board || !board[from.row] || !board[to.row])
    return { valid: false, reason: "Tabuleiro inválido." };
  const piece = board[from.row][from.col];
  const destination = board[to.row][to.col];
  if (piece === 0 || piece.toLowerCase() !== playerColor || destination !== 0)
    return { valid: false, reason: "Seleção ou destino inválido." };

  // Lógica da Lei da Maioria
  if (!ignoreMajorityRule) {
    const bestCaptures = findBestCaptureMoves(playerColor, game);
    if (bestCaptures.length > 0) {
      const isMoveInBestCaptures = bestCaptures.some(
        (seq) =>
          seq[0].row === from.row &&
          seq[0].col === from.col &&
          seq[1].row === to.row &&
          seq[1].col === to.col
      );
      if (!isMoveInBestCaptures) {
        // Mensagem de erro atualizada para ser mais clara
        return {
          valid: false,
          reason:
            "Lei da Maioria: Você é obrigado a fazer a captura com o maior número de peças.",
        };
      }
    }
  }

  let moveResult;
  if (piece === "B" || piece === "P") {
    moveResult = getDamaMove(from, to, playerColor, board);
  } else {
    moveResult = getNormalPieceMove(from, to, playerColor, board);
  }

  if (
    !ignoreMajorityRule &&
    findBestCaptureMoves(playerColor, game).length > 0 &&
    !moveResult.isCapture
  ) {
    return {
      valid: false,
      reason: "Você tem uma captura obrigatória a fazer.",
    };
  }

  return moveResult || { valid: false, reason: "Movimento não permitido." };
}

// EM index.js, SUBSTITUA A SUA FUNÇÃO 'getNormalPieceMove' POR ESTA

function getNormalPieceMove(from, to, playerColor, board) {
  if (
    to.row < 0 ||
    to.row > 7 ||
    to.col < 0 ||
    to.col > 7 ||
    board[to.row]?.[to.col] !== 0
  ) {
    return { valid: false };
  }
  const opponentColor = playerColor === "b" ? "p" : "b";
  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  const moveDirection = playerColor === "b" ? -1 : 1;

  // Movimento normal (para a frente)
  if (Math.abs(colDiff) === 1 && rowDiff === moveDirection) {
    return { valid: true, isCapture: false };
  }

  // <-- CORREÇÃO: A lógica de captura agora ignora a 'moveDirection'
  // Captura (em qualquer direção na diagonal)
  if (Math.abs(colDiff) === 2 && Math.abs(rowDiff) === 2) {
    const capturedPos = {
      row: from.row + rowDiff / 2,
      col: from.col + colDiff / 2,
    };
    const capturedPiece = board[capturedPos.row]?.[capturedPos.col];
    if (capturedPiece && capturedPiece.toLowerCase() === opponentColor) {
      return { valid: true, isCapture: true, capturedPos };
    }
  }
  return { valid: false };
}

function getDamaMove(from, to, playerColor, board) {
  if (
    to.row < 0 ||
    to.row > 7 ||
    to.col < 0 ||
    to.col > 7 ||
    board[to.row]?.[to.col] !== 0
  )
    return { valid: false };
  const opponentColor = playerColor === "b" ? "p" : "b";
  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  if (Math.abs(rowDiff) !== Math.abs(colDiff)) return { valid: false };

  const stepRow = rowDiff > 0 ? 1 : -1;
  const stepCol = colDiff > 0 ? 1 : -1;
  let capturedPieces = [];
  let capturedPos = null;

  for (let i = 1; i < Math.abs(rowDiff); i++) {
    const currRow = from.row + i * stepRow;
    const currCol = from.col + i * stepCol;
    const pieceOnPath = board[currRow][currCol];
    if (pieceOnPath !== 0) {
      if (pieceOnPath.toLowerCase() === opponentColor) {
        capturedPieces.push(pieceOnPath);
        capturedPos = { row: currRow, col: currCol };
      } else {
        return {
          valid: false,
          reason: "Não pode saltar sobre peças da mesma cor.",
        };
      }
    }
  }

  if (capturedPieces.length > 1)
    return {
      valid: false,
      reason: "Dama não pode capturar mais de uma peça na mesma diagonal.",
    };
  if (capturedPieces.length === 1) {
    // Verifica se a casa a seguir à peça capturada está livre
    const landRow = capturedPos.row + stepRow;
    const landCol = capturedPos.col + stepCol;
    if (landRow !== to.row || landCol !== to.col) {
      if (board[to.row]?.[to.col] !== 0)
        return {
          valid: false,
          reason: "Casa de aterragem da Dama está ocupada.",
        };
    }
    return { valid: true, isCapture: true, capturedPos };
  }
  return { valid: true, isCapture: false };
}

function getAllPossibleCapturesForPiece(row, col, game) {
  const board = game.boardState;
  const piece = board[row][col];
  if (!piece || piece === 0) return [];
  const isDama = piece === piece.toUpperCase();
  return findCaptureSequencesForPiece(row, col, board, isDama);
}

function checkWinCondition(boardState) {
  let whitePieces = 0;
  let blackPieces = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = boardState[r][c];
      if (piece !== 0) {
        if (piece.toLowerCase() === "b") whitePieces++;
        else if (piece.toLowerCase() === "p") blackPieces++;
      }
    }
  }
  if (whitePieces === 0) return "p";
  if (blackPieces === 0) return "b";

  // VERIFICA SE O JOGADOR ATUAL TEM MOVIMENTOS VÁLIDOS
  const currentPlayer =
    io.sockets.sockets.values().next().value?.game?.currentPlayer || "b"; // Um pouco de adivinhação aqui
  const hasMoves = hasValidMoves(currentPlayer, { boardState });
  if (!hasMoves) {
    return currentPlayer === "b" ? "p" : "b";
  }

  return null;
}

function hasValidMoves(playerColor, game) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = game.boardState[r][c];
      if (piece !== 0 && piece.toLowerCase() === playerColor) {
        for (let toRow = 0; toRow < 8; toRow++) {
          for (let toCol = 0; toCol < 8; toCol++) {
            if (
              isMoveValid(
                { row: r, col: c },
                { row: toRow, col: toCol },
                playerColor,
                game,
                true
              ).valid
            ) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

// VERSÃO NOVA E CORRIGIDA
function startTimer(roomCode) {
  const room = gameRooms[roomCode];
  if (!room) return;

  // Limpa qualquer temporizador antigo para esta sala, por segurança
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    // Removido 'async' desnecessário
    if (!gameRooms[roomCode]) {
      // Verificação extra para salas já eliminadas
      clearInterval(room.timerInterval);
      return;
    }

    room.timeLeft--;
    io.to(roomCode).emit("timerUpdate", { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearInterval(room.timerInterval);
      const loserColor = room.game.currentPlayer;
      const winnerColor = loserColor === "b" ? "p" : "b";

      // AQUI ESTÁ A CORREÇÃO: Apenas chama a função principal!
      processEndOfGame(winnerColor, loserColor, room, "Tempo esgotado!");
    }
  }, 1000);
}
function resetTimer(roomCode) {
  const room = gameRooms[roomCode];
  if (room) {
    clearInterval(room.timerInterval);
    room.timeLeft = 40;
    io.to(roomCode).emit("timerUpdate", { timeLeft: room.timeLeft });
    startTimer(roomCode);
  }
}

server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}.`);
});
