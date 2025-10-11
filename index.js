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

const tablitaOpenings = [
  [
    [0, "p", 0, "p", 0, "p", 0, "p"],
    ["p", 0, "p", 0, "p", 0, "p", 0],
    [0, 0, 0, "p", 0, "p", 0, "p"],
    ["p", 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, "b"],
    [0, "b", 0, "b", 0, "b", 0, 0],
    [0, "b", 0, "b", 0, "b", 0, "b"],
    ["b", 0, "b", 0, "b", 0, "b", 0],
  ],
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

    room.game = {
      players: { white: player1.socketId, black: player2.socketId },
      users: { white: player1.user.email, black: player2.user.email },
      boardState: selectedBoard,
      currentPlayer: "b",
      isFirstMove: true,
      movesSinceCapture: 0,
    };
    const gameState = { ...room.game, roomCode };
    io.to(roomCode).emit("gameStart", gameState);
  });

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
      let wasPromotion = false;
      game.boardState[to.row][to.col] = piece;
      game.boardState[from.row][from.col] = 0;
      let canCaptureAgain = false;
      if (isValid.isCapture) {
        game.boardState[isValid.capturedPos.row][isValid.capturedPos.col] = 0;
        game.movesSinceCapture = 0;
        let movedPiece = game.boardState[to.row][to.col];
        if (
          (movedPiece === "b" && to.row === 0) ||
          (movedPiece === "p" && to.row === 7)
        ) {
          wasPromotion = true;
          movedPiece = movedPiece.toUpperCase();
          game.boardState[to.row][to.col] = movedPiece;
        }
        if (!wasPromotion) {
          const nextCaptures = getAllPossibleCapturesForPiece(
            to.row,
            to.col,
            game
          );
          canCaptureAgain = nextCaptures.length > 0;
        }
      }
      piece = game.boardState[to.row][to.col];
      if (piece.toLowerCase() === "b" && to.row === 0 && piece === "b") {
        game.boardState[to.row][to.col] = "B";
        wasPromotion = true;
      }
      if (piece.toLowerCase() === "p" && to.row === 7 && piece === "p") {
        game.boardState[to.row][to.col] = "P";
        wasPromotion = true;
      }
      if (wasPromotion) {
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
      if (!canCaptureAgain || wasPromotion) {
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

async function processEndOfGame(winnerColor, loserColor, room, reason) {
  if (!room) return;
  clearInterval(room.timerInterval);

  // Se for empate
  if (!winnerColor || !loserColor) {
    if (room.isTablita && room.match.currentGame === 1) {
      // Empate no primeiro jogo não conta ponto
      room.match.currentGame = 2;
      const scoreArray = [
        room.match.score[room.match.player1.email],
        room.match.score[room.match.player2.email],
      ];
      io.to(room.roomCode).emit("nextGameStarting", { score: scoreArray });

      setTimeout(() => startNextTablitaGame(room), 10000);
    } else {
      // Empate de partida (devolve a aposta)
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
        delete gameRooms[room.roomCode];
      }
    }
    return;
  }

  const winnerData = room.players.find(
    (p) =>
      p.socketId === room.game.players[winnerColor === "b" ? "white" : "black"]
  );

  // Se for modo Tablita e for o primeiro jogo
  if (room.isTablita && room.match.currentGame === 1) {
    room.match.score[winnerData.user.email]++;
    room.match.currentGame = 2;

    const scoreArray = [
      room.match.score[room.match.player1.email],
      room.match.score[room.match.player2.email],
    ];
    io.to(room.roomCode).emit("nextGameStarting", { score: scoreArray });

    setTimeout(() => startNextTablitaGame(room), 10000);
  } else {
    // Lógica para fim de partida
    let finalWinnerData;
    const prize = room.bet * 2;

    if (room.isTablita) {
      room.match.score[winnerData.user.email]++;
      const p1Score = room.match.score[room.match.player1.email];
      const p2Score = room.match.score[room.match.player2.email];

      if (p1Score > p2Score) {
        finalWinnerData = room.match.player1;
      } else if (p2Score > p1Score) {
        finalWinnerData = room.match.player2;
      } else {
        // Empate na partida
        return processEndOfGame(null, null, room, "Partida empatada.");
      }
    } else {
      finalWinnerData = winnerData;
    }

    const finalWinnerColor =
      room.game.users.white === finalWinnerData.email ? "b" : "p";

    try {
      const updatedWinner = await User.findOneAndUpdate(
        { email: finalWinnerData.email },
        { $inc: { saldo: prize } },
        { new: true }
      );
      io.to(room.roomCode).emit("gameOver", {
        winner: finalWinnerColor,
        reason,
      });
      const winnerSocket = io.sockets.sockets.get(finalWinnerData.socketId);
      if (winnerSocket)
        winnerSocket.emit("updateSaldo", { newSaldo: updatedWinner.saldo });
    } catch (err) {
      console.error("Erro ao finalizar o jogo:", err);
    } finally {
      delete gameRooms[room.roomCode];
    }
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

// NOVA FUNÇÃO para encontrar a melhor sequência de captura
function findBestCaptureMoves(playerColor, game) {
  let bestMoves = [];
  let maxCaptures = 0;
  let hasDamaCapture = false;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = game.boardState[r][c];
      if (piece !== 0 && piece.toLowerCase() === playerColor) {
        const isDama = piece === piece.toUpperCase();
        const sequences = findCaptureSequencesForPiece(
          r,
          c,
          game.boardState,
          isDama
        );

        sequences.forEach((seq) => {
          const numCaptures = seq.length - 1;
          if (isDama && !hasDamaCapture) {
            hasDamaCapture = true;
            maxCaptures = numCaptures;
            bestMoves = [seq];
          } else if (isDama && hasDamaCapture && numCaptures > maxCaptures) {
            maxCaptures = numCaptures;
            bestMoves = [seq];
          } else if (isDama && hasDamaCapture && numCaptures === maxCaptures) {
            bestMoves.push(seq);
          } else if (!isDama && !hasDamaCapture && numCaptures > maxCaptures) {
            maxCaptures = numCaptures;
            bestMoves = [seq];
          } else if (
            !isDama &&
            !hasDamaCapture &&
            numCaptures === maxCaptures
          ) {
            bestMoves.push(seq);
          }
        });
      }
    }
  }
  return bestMoves;
}

// NOVA FUNÇÃO RECURSIVA para encontrar sequências
function findCaptureSequencesForPiece(row, col, board, isDama) {
  let sequences = [];
  const opponentColor = board[row][col].toLowerCase() === "b" ? "p" : "b";
  const directions = [
    { r: -1, c: -1 },
    { r: -1, c: 1 },
    { r: 1, c: -1 },
    { r: 1, c: 1 },
  ];

  for (const dir of directions) {
    if (isDama) {
      // Lógica de captura da Dama
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
                true
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
      // Lógica de captura da Peça Comum
      const capturedRow = row + dir.r;
      const capturedCol = col + dir.c;
      const landRow = row + 2 * dir.r;
      const landCol = col + 2 * dir.c;

      if (landRow >= 0 && landRow < 8 && landCol >= 0 && landCol < 8) {
        const capturedPiece = board[capturedRow]?.[capturedCol];
        const landingSquare = board[landRow]?.[landCol];
        if (
          capturedPiece &&
          capturedPiece.toLowerCase() === opponentColor &&
          landingSquare === 0
        ) {
          const newBoard = JSON.parse(JSON.stringify(board));
          newBoard[landRow][landCol] = newBoard[row][col];
          newBoard[row][col] = 0;
          newBoard[capturedRow][capturedCol] = 0;

          const nextSequences = findCaptureSequencesForPiece(
            landRow,
            landCol,
            newBoard,
            false
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
      }
    }
  }
  return sequences;
}

// FUNÇÃO ATUALIZADA
function isMoveValid(from, to, playerColor, game, ignoreMajorityRule = false) {
  const board = game.boardState;
  if (!board || !board[from.row] || !board[to.row])
    return { valid: false, reason: "Tabuleiro inválido." };
  const piece = board[from.row][from.col];
  const destination = board[to.row][to.col];
  if (piece === 0 || piece.toLowerCase() !== playerColor || destination !== 0)
    return { valid: false, reason: "Seleção ou destino inválido." };

  // Lógica da Lei da Maioria e Qualidade
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
        return {
          valid: false,
          reason:
            "Existe uma captura obrigatória com mais peças ou com uma Dama.",
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

// FUNÇÕES AUXILIARES (sem alterações, mas mantidas por clareza)
function getNormalPieceMove(from, to, playerColor, board) {
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
  const moveDirection = playerColor === "b" ? -1 : 1;

  // Movimento normal
  if (Math.abs(colDiff) === 1 && rowDiff === moveDirection) {
    return { valid: true, isCapture: false };
  }
  // Captura
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

function startTimer(roomCode) {
  const room = gameRooms[roomCode];
  if (!room) return;
  room.timerInterval = setInterval(async () => {
    room.timeLeft--;
    io.to(roomCode).emit("timerUpdate", { timeLeft: room.timeLeft });
    if (room.timeLeft <= 0) {
      clearInterval(room.timerInterval);
      const loserColor = room.game.currentPlayer;
      const winnerColor = loserColor === "b" ? "p" : "b";
      const winnerId =
        room.game.players[winnerColor === "b" ? "white" : "black"];
      const loserId =
        room.game.players[winnerColor === "b" ? "black" : "white"];
      const winnerSocket = io.sockets.sockets.get(winnerId);
      const winnerUser = room.players.find(
        (p) => p.socketId === winnerId
      )?.user;
      if (winnerUser) {
        const prize = room.bet * 2;
        const updatedUser = await User.findOneAndUpdate(
          { email: winnerUser.email },
          { $inc: { saldo: prize } },
          { new: true }
        );
        const loserData = room.players.find((p) => p.socketId === loserId);
        const updatedLoser = await User.findOne({
          email: loserData.user.email,
        });
        io.to(roomCode).emit("gameOver", {
          winner: winnerColor,
          reason: "Tempo esgotado!",
        });
        if (winnerSocket) {
          winnerSocket.emit("updateSaldo", { newSaldo: updatedUser.saldo });
        }
        const loserSocket = io.sockets.sockets.get(loserId);
        if (loserSocket) {
          loserSocket.emit("updateSaldo", { newSaldo: updatedLoser.saldo });
        }
      }
      delete gameRooms[roomCode];
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
