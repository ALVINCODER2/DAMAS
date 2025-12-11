// src/socketHandlers.js

const User = require("../models/User");
const {
  standardOpening,
  idfTablitaOpenings,
  standardOpening10x10,
} = require("../utils/constants");

// ### IMPORTAÇÃO DA LÓGICA COMPARTILHADA ###
const {
  isMoveValid,
  checkWinCondition,
  hasValidMoves,
  getAllPossibleCapturesForPiece,
  findBestCaptureMoves,
  getUniqueCaptureMove,
} = require("../public/gameLogic");

const { startTimer, resetTimer, processEndOfGame } = require("./gameManager");

const gameRooms = {};
let io; // Variável global para instância do Socket.IO

function getLobbyInfo() {
  const waitingRooms = Object.values(gameRooms)
    .filter((room) => room.players.length === 1 && !room.isGameConcluded)
    .map((room) => ({
      roomCode: room.roomCode,
      bet: room.bet,
      gameMode: room.gameMode,
      timeControl: room.timeControl,
      creatorEmail: room.players[0]?.user?.email || "Desconhecido",
      timerDuration: room.timerDuration,
    }));

  const activeRooms = Object.values(gameRooms)
    .filter((room) => room.players.length === 2 && !room.isGameConcluded)
    .map((room) => ({
      roomCode: room.roomCode,
      bet: room.bet,
      gameMode: room.gameMode,
      timeControl: room.timeControl,
      player1Email: room.players[0]?.user?.email || "P1",
      player2Email: room.players[1]?.user?.email || "P2",
      timerDuration: room.timerDuration,
    }));

  return { waiting: waitingRooms, active: activeRooms };
}

// --- LÓGICA DE JOGO MOVIDA PARA ESCOPO GLOBAL DO MÓDULO ---

function cleanupPreviousRooms(userEmail) {
  const roomsToRemove = [];
  Object.keys(gameRooms).forEach((code) => {
    const r = gameRooms[code];
    if (
      r.players.length === 1 &&
      !r.isGameConcluded &&
      r.players[0].user.email === userEmail
    ) {
      roomsToRemove.push(code);
    }
  });

  roomsToRemove.forEach((code) => {
    delete gameRooms[code];
    console.log(
      `[Limpeza] Sala ${code} excluída automaticamente pois o criador (${userEmail}) iniciou outra ação.`
    );
  });

  if (roomsToRemove.length > 0 && io) {
    io.emit("updateLobby", getLobbyInfo());
  }
}

async function startGameLogic(room) {
  if (!io) return;
  const player1 = room.players[0];
  const player2 = room.players[1];
  room.isGameConcluded = false;
  room.revancheRequests = new Set();
  if (room.cleanupTimeout) clearTimeout(room.cleanupTimeout);

  let whitePlayer, blackPlayer;
  // Verifica se é uma continuação de partida (Tablita ou Revanche)
  if (room.game && room.game.players) {
    console.log("[Novo Jogo/Revanche] Invertendo cores.");
    const previousWhiteSocketId = room.game.players.white;

    // Lógica para manter os jogadores corretos mesmo se reconectarem com novo socketId,
    // mas priorizando a inversão baseada no jogo anterior
    if (player1.socketId === previousWhiteSocketId) {
      whitePlayer = player2;
      blackPlayer = player1;
    } else {
      whitePlayer = player1;
      blackPlayer = player2;
    }
  } else {
    console.log("[Novo Jogo] Atribuindo cores aleatoriamente.");
    const isPlayer1White = Math.random() < 0.5;
    whitePlayer = isPlayer1White ? player1 : player2;
    blackPlayer = isPlayer1White ? player2 : player1;
  }

  let boardState;
  let boardSize;
  let openingName = null;

  if (room.gameMode === "international") {
    boardState = JSON.parse(JSON.stringify(standardOpening10x10));
    boardSize = 10;
  } else if (room.gameMode === "tablita") {
    // Se for a segunda partida do match (currentGame == 2), usamos a MESMA abertura
    if (room.match && room.match.currentGame === 2) {
      boardState = JSON.parse(JSON.stringify(room.match.openingBoard));
      openingName = room.match.opening.name;
      boardSize = 8;
    } else {
      // Primeira partida: sorteia abertura
      let randomIndex;
      let attempts = 0;
      do {
        randomIndex = Math.floor(Math.random() * idfTablitaOpenings.length);
        attempts++;
      } while (
        randomIndex === room.lastOpeningIndex &&
        idfTablitaOpenings.length > 1 &&
        attempts < 5
      );

      room.lastOpeningIndex = randomIndex;
      const selectedOpening = idfTablitaOpenings[randomIndex];
      boardState = JSON.parse(JSON.stringify(selectedOpening.board));
      openingName = selectedOpening.name;
      boardSize = 8;

      if (!room.match) room.match = {};
      room.match.score = { [player1.user.email]: 0, [player2.user.email]: 0 };
      room.match.currentGame = 1;
      room.match.opening = JSON.parse(JSON.stringify(selectedOpening));
      room.match.openingBoard = JSON.parse(
        JSON.stringify(selectedOpening.board)
      );
      // Salva referência persistente dos jogadores
      room.match.player1 = {
        email: player1.user.email,
        socketId: player1.socketId,
      };
      room.match.player2 = {
        email: player2.user.email,
        socketId: player2.socketId,
      };
    }
  } else {
    boardState = JSON.parse(JSON.stringify(standardOpening));
    boardSize = 8;
  }

  room.game = {
    players: { white: whitePlayer.socketId, black: blackPlayer.socketId },
    users: { white: whitePlayer.user.email, black: blackPlayer.user.email },
    boardState: boardState,
    boardSize: boardSize,
    currentPlayer: "b",
    isFirstMove: true,
    movesSinceCapture: 0,
    damaMovesWithoutCaptureOrPawnMove: 0,
    openingName: openingName,
    mustCaptureWith: null,
    lastMove: null,
  };

  if (!hasValidMoves(room.game.currentPlayer, room.game)) {
    return processEndOfGame(
      null,
      null,
      room,
      "Empate por bloqueio na abertura."
    );
  }

  if (room.timeControl === "match") {
    room.whiteTime = room.timerDuration;
    room.blackTime = room.timerDuration;
  } else {
    room.timeLeft = room.timerDuration;
  }

  const bestCaptures = findBestCaptureMoves(room.game.currentPlayer, room.game);
  const mandatoryPieces = bestCaptures.map((seq) => seq[0]);

  const gameState = {
    ...room.game,
    roomCode: room.roomCode,
    mandatoryPieces,
  };

  io.to(room.roomCode).emit("gameStart", gameState);
  io.to(whitePlayer.socketId).emit("gameStart", gameState);
  io.to(blackPlayer.socketId).emit("gameStart", gameState);
}

async function executeMove(roomCode, from, to, socketId) {
  if (!io) return;
  const gameRoom = gameRooms[roomCode];
  if (!gameRoom || !gameRoom.game) return;
  const game = gameRoom.game;

  const playerColor = game.currentPlayer;

  if (socketId) {
    const socketPlayerColor = game.players.white === socketId ? "b" : "p";
    if (socketPlayerColor !== playerColor) return;
  }

  if (game.isFirstMove) {
    game.isFirstMove = false;
    startTimer(roomCode);
  }

  const isValid = isMoveValid(from, to, playerColor, game);

  if (isValid.valid) {
    const pieceBeforeMove = game.boardState[from.row][from.col];
    const isPieceDama = pieceBeforeMove.toUpperCase() === pieceBeforeMove;

    if (!isPieceDama || isValid.isCapture) {
      game.damaMovesWithoutCaptureOrPawnMove = 0;
      game.movesSinceCapture = 0;
    } else if (isPieceDama && !isValid.isCapture) {
      game.damaMovesWithoutCaptureOrPawnMove++;
      game.movesSinceCapture++;
    }

    game.boardState[to.row][to.col] = game.boardState[from.row][from.col];
    game.boardState[from.row][from.col] = 0;

    game.lastMove = { from, to };

    let canCaptureAgain = false;
    let wasPromotion = false;

    if (isValid.isCapture) {
      game.boardState[isValid.capturedPos.row][isValid.capturedPos.col] = 0;
      const nextCaptures = getAllPossibleCapturesForPiece(to.row, to.col, game);
      canCaptureAgain = nextCaptures.length > 0;
    }

    if (!canCaptureAgain) {
      const currentPiece = game.boardState[to.row][to.col];
      if (currentPiece === "b" && to.row === 0) {
        game.boardState[to.row][to.col] = "B";
        wasPromotion = true;
      } else if (currentPiece === "p" && to.row === game.boardSize - 1) {
        game.boardState[to.row][to.col] = "P";
        wasPromotion = true;
      }
    }

    if (wasPromotion) {
      canCaptureAgain = false;
      game.movesSinceCapture = 0;
      game.damaMovesWithoutCaptureOrPawnMove = 0;
    }

    let whitePieces = 0;
    let whiteDames = 0;
    let blackPieces = 0;
    let blackDames = 0;

    for (let r = 0; r < game.boardSize; r++) {
      for (let c = 0; c < game.boardSize; c++) {
        const p = game.boardState[r][c];
        if (p !== 0) {
          if (p.toString().toLowerCase() === "b") {
            whitePieces++;
            if (p === "B") whiteDames++;
          } else {
            blackPieces++;
            if (p === "P") blackDames++;
          }
        }
      }
    }

    const isWhite3vs1 =
      whiteDames >= 3 &&
      whitePieces === whiteDames &&
      blackPieces === 1 &&
      blackDames === 1;
    const isBlack3vs1 =
      blackDames >= 3 &&
      blackPieces === blackDames &&
      whitePieces === 1 &&
      whiteDames === 1;

    if (gameRoom.gameMode !== "international") {
      if (game.damaMovesWithoutCaptureOrPawnMove >= 40)
        return processEndOfGame(
          null,
          null,
          gameRoom,
          "Empate por 20 lances de Damas."
        );

      if (game.movesSinceCapture >= 40) {
        if (isWhite3vs1 || isBlack3vs1) {
          return processEndOfGame(
            null,
            null,
            gameRoom,
            "Empate: 3 Damas contra 1 (20 lances)."
          );
        }
        return processEndOfGame(
          null,
          null,
          gameRoom,
          "Empate por 20 jogadas sem captura."
        );
      }
    }

    const winner = checkWinCondition(game.boardState, game.boardSize);
    if (winner) {
      const loser = winner === "b" ? "p" : "b";
      return processEndOfGame(winner, loser, gameRoom, "Fim de jogo!");
    }

    if (!canCaptureAgain) {
      game.mustCaptureWith = null;
      game.currentPlayer = game.currentPlayer === "b" ? "p" : "b";
      if (!hasValidMoves(game.currentPlayer, game)) {
        const winner = game.currentPlayer === "b" ? "p" : "b";
        return processEndOfGame(
          winner,
          game.currentPlayer,
          gameRoom,
          "Oponente bloqueado!"
        );
      }
      resetTimer(roomCode);
    } else {
      game.mustCaptureWith = { row: to.row, col: to.col };
    }

    const bestCaptures = findBestCaptureMoves(game.currentPlayer, game);
    const mandatoryPieces = canCaptureAgain
      ? [{ row: to.row, col: to.col }]
      : bestCaptures.map((seq) => seq[0]);

    io.to(roomCode).emit("gameStateUpdate", { ...game, mandatoryPieces });

    if (canCaptureAgain) {
      const uniqueMove = getUniqueCaptureMove(to.row, to.col, game);
      if (uniqueMove) {
        setTimeout(() => {
          if (gameRooms[roomCode] && !gameRooms[roomCode].isGameConcluded) {
            executeMove(
              roomCode,
              { row: to.row, col: to.col },
              uniqueMove.to,
              null
            );
          }
        }, 1000);
      }
    }
  } else {
    if (socketId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit("invalidMove", {
          message: isValid.reason || "Movimento inválido.",
        });
      }
    }
  }
}

// Função para ser chamada externamente pelo gameManager (evita referência circular direta na inicialização)
async function startNextTablitaGame(roomCode) {
  const room = gameRooms[roomCode];
  if (room) {
    console.log(`[Tablita] Iniciando próxima partida para sala ${roomCode}`);
    await startGameLogic(room);
  } else {
    console.log(
      `[Tablita] Sala ${roomCode} não encontrada para próxima partida.`
    );
  }
}

function initializeSocket(ioInstance) {
  io = ioInstance; // Configura a instância global

  io.on("connection", (socket) => {
    socket.on("enterLobby", () => {
      socket.emit("updateLobby", getLobbyInfo());
    });

    socket.on("joinAsSpectator", ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || room.players.length < 2 || room.isGameConcluded) {
        return socket.emit("joinError", {
          message: "Jogo não disponível para assistir.",
        });
      }

      socket.join(roomCode);

      const gameState = {
        ...room.game,
        roomCode: room.roomCode,
        mandatoryPieces: findBestCaptureMoves(
          room.game.currentPlayer,
          room.game
        ).map((seq) => seq[0]),
      };

      let timeData = {};
      if (room.timeControl === "match") {
        timeData = { whiteTime: room.whiteTime, blackTime: room.blackTime };
      } else {
        timeData = { timeLeft: room.timeLeft };
      }

      socket.emit("spectatorJoined", {
        gameState,
        ...timeData,
        timeControl: room.timeControl,
        isSpectator: true,
      });
    });

    socket.on("createRoom", async (data) => {
      if (!data || !data.user || !data.bet || !data.gameMode)
        return socket.emit("joinError", { message: "Erro ao criar sala." });

      socket.userData = data.user;

      cleanupPreviousRooms(socket.userData.email);

      const { bet, gameMode, timerDuration, timeControl } = data;
      const validTimer = parseInt(timerDuration, 10) || 40;
      const validTimeControl =
        timeControl === "match" || timeControl === "move"
          ? timeControl
          : "move";

      if (bet <= 0)
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
        gameMode: gameMode,
        isTablita: gameMode === "tablita",
        timeControl: validTimeControl,
        timerDuration: validTimer,
        timeLeft: validTimer,
        whiteTime: validTimer,
        blackTime: validTimer,
        players: [{ socketId: socket.id, user: socket.userData }],
        timerInterval: null,
        drawOfferBy: null,
        disconnectTimeout: null,
        isGameConcluded: false,
        lastOpeningIndex: -1,
      };

      socket.emit("roomCreated", { roomCode });
      io.emit("updateLobby", getLobbyInfo());
    });

    socket.on("joinRoomRequest", async (data) => {
      if (!data || !data.user || !data.roomCode) return;
      socket.userData = data.user;

      cleanupPreviousRooms(socket.userData.email);

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
        gameMode: room.gameMode,
        timeControl: room.timeControl,
      });
    });

    socket.on("acceptBet", async (data) => {
      if (!data || !data.user) return;
      socket.userData = data.user;
      const { roomCode } = data;

      const room = gameRooms[roomCode];

      if (!room || room.players.length >= 2) {
        socket.emit("joinError", {
          message: "Sala indisponível ou já iniciada.",
        });
        return;
      }

      if (room.disconnectTimeout) {
        clearTimeout(room.disconnectTimeout);
        room.disconnectTimeout = null;
      }
      socket.join(roomCode);
      room.players.push({ socketId: socket.id, user: socket.userData });
      try {
        await User.findOneAndUpdate(
          { email: room.players[0].user.email },
          { $inc: { saldo: -room.bet } }
        );
        await User.findOneAndUpdate(
          { email: room.players[1].user.email },
          { $inc: { saldo: -room.bet } }
        );
      } catch (err) {
        io.to(room.roomCode).emit("joinError", {
          message: "Erro ao processar a aposta.",
        });
        delete gameRooms[roomCode];
        return;
      }
      await startGameLogic(room);
      io.emit("updateLobby", getLobbyInfo());
    });

    socket.on("requestGameSync", (data) => {
      const { roomCode } = data;
      const room = gameRooms[roomCode];
      if (!room || !room.game) return;

      const isPlayer = room.players.some((p) => p.socketId === socket.id);
      if (!isPlayer) return;

      const player = room.players.find(
        (p) => p.user.email === socket.userData?.email
      );
      if (player) player.socketId = socket.id;

      let timeData = {};
      if (room.timeControl === "match") {
        timeData = { whiteTime: room.whiteTime, blackTime: room.blackTime };
      } else {
        timeData = { timeLeft: room.timeLeft };
      }

      socket.emit("gameResumed", {
        gameState: room.game,
        ...timeData,
      });
    });

    socket.on("cancelRoom", (data) => {
      const { roomCode } = data;
      const room = gameRooms[roomCode];
      if (
        room &&
        room.players.length === 1 &&
        room.players[0].socketId === socket.id
      ) {
        delete gameRooms[roomCode];
        socket.emit("roomCancelled");
        io.emit("updateLobby", getLobbyInfo());
      }
    });

    socket.on("playerMove", async (moveData) => {
      await executeMove(moveData.room, moveData.from, moveData.to, socket.id);
    });

    socket.on("getValidMoves", (data) => {
      const { row, col, roomCode } = data;
      const room = gameRooms[roomCode];
      if (!room || !room.game) return socket.emit("showValidMoves", []);
      const game = room.game;
      const piece = game.boardState[row][col];
      if (piece === 0) return socket.emit("showValidMoves", []);
      const playerColor = piece.toLowerCase();
      const isDama = piece.toUpperCase() === piece;
      let validMoves = [];
      const bestCaptures = findBestCaptureMoves(playerColor, game);

      if (game.mustCaptureWith) {
        if (
          row !== game.mustCaptureWith.row ||
          col !== game.mustCaptureWith.col
        ) {
          return socket.emit("showValidMoves", []);
        }
        const capturesForThisPiece = getAllPossibleCapturesForPiece(
          row,
          col,
          game
        );
        validMoves = capturesForThisPiece.map((seq) => seq[1]);
        return socket.emit("showValidMoves", validMoves);
      }

      if (bestCaptures.length > 0) {
        const capturesForThisPiece = bestCaptures.filter(
          (seq) => seq[0].row === row && seq[0].col === col
        );
        validMoves = capturesForThisPiece.map((seq) => seq[1]);
      } else {
        const directions = [
          { r: -1, c: -1 },
          { r: -1, c: 1 },
          { r: 1, c: -1 },
          { r: 1, c: 1 },
        ];
        const moveDirection = playerColor === "b" ? -1 : 1;
        if (isDama) {
          for (const dir of directions) {
            for (let i = 1; i < game.boardSize; i++) {
              const toRow = row + i * dir.r;
              const toCol = col + i * dir.c;
              if (
                toRow < 0 ||
                toRow >= game.boardSize ||
                toCol < 0 ||
                toCol >= game.boardSize ||
                game.boardState[toRow][toCol] !== 0
              )
                break;
              validMoves.push({ row: toRow, col: toCol });
            }
          }
        } else {
          for (const dir of directions) {
            if (dir.r === moveDirection) {
              const toRow = row + dir.r;
              const toCol = col + dir.c;
              if (
                toRow >= 0 &&
                toRow < game.boardSize &&
                toCol >= 0 &&
                toCol < game.boardSize &&
                game.boardState[toRow][toCol] === 0
              ) {
                validMoves.push({ row: toRow, col: toCol });
              }
            }
          }
        }
      }
      socket.emit("showValidMoves", validMoves);
    });

    socket.on("rejoinActiveGame", (data) => {
      const { roomCode, user } = data;
      if (!roomCode || !user) return;
      const room = gameRooms[roomCode];
      if (!room) {
        socket.emit("gameNotFound");
        return;
      }
      if (room.disconnectTimeout) {
        clearTimeout(room.disconnectTimeout);
        room.disconnectTimeout = null;
      }
      const player = room.players.find((p) => p.user.email === user.email);
      if (player) {
        player.socketId = socket.id;
        if (room.game.users.white === user.email) {
          room.game.players.white = socket.id;
        } else if (room.game.users.black === user.email) {
          room.game.players.black = socket.id;
        }
        socket.join(roomCode);

        let timeData = {};
        if (room.timeControl === "match") {
          timeData = { whiteTime: room.whiteTime, blackTime: room.blackTime };
        } else {
          timeData = { timeLeft: room.timeLeft };
        }

        io.to(roomCode).emit("gameResumed", {
          gameState: room.game,
          ...timeData,
        });

        startTimer(roomCode);
      }
    });

    socket.on("disconnect", () => {
      const WAIT_TIME = 60;

      const roomCode = Object.keys(gameRooms).find((rc) =>
        gameRooms[rc].players.some((p) => p.socketId === socket.id)
      );

      if (!roomCode) return;
      const room = gameRooms[roomCode];

      if (room && !room.isGameConcluded && room.players.length === 2) {
        const opponent = room.players.find((p) => p.socketId !== socket.id);
        if (opponent) {
          if (room.timerInterval) clearInterval(room.timerInterval);

          io.to(opponent.socketId).emit("opponentConnectionLost", {
            waitTime: WAIT_TIME,
          });
          room.disconnectTimeout = setTimeout(() => {
            if (!gameRooms[roomCode]) return;
            const disconnectedPlayer = room.players.find(
              (p) => p.socketId === socket.id
            );
            if (!disconnectedPlayer) return;

            const winnerEmail = opponent.user.email;
            const winnerColor =
              room.game.users.white === winnerEmail ? "b" : "p";
            const loserColor = winnerColor === "b" ? "p" : "b";

            processEndOfGame(
              winnerColor,
              loserColor,
              room,
              "Oponente desconectou e não retornou."
            );
          }, WAIT_TIME * 1000);
        }
      } else if (room && room.players.length === 1 && !room.isGameConcluded) {
        delete gameRooms[roomCode];
        io.emit("updateLobby", getLobbyInfo());
      } else if (room && room.isGameConcluded) {
        socket.emit("leaveEndGameScreen", { roomCode });
      }
    });

    socket.on("playerResign", () => {
      const roomCode = Array.from(socket.rooms).find((r) => r !== socket.id);
      if (!roomCode) return;
      const gameRoom = gameRooms[roomCode];
      if (!gameRoom || !gameRoom.game || !gameRoom.game.players) return;

      const loserSocketId = socket.id;
      const opponent = gameRoom.players.find(
        (p) => p.socketId !== loserSocketId
      );

      const isPlayer = gameRoom.players.some((p) => p.socketId === socket.id);
      if (!isPlayer || !opponent) return;

      const winnerSocketId = opponent.socketId;
      const winnerIsWhite = gameRoom.game.players.white === winnerSocketId;
      const winnerColor = winnerIsWhite ? "b" : "p";
      const loserColor = winnerIsWhite ? "p" : "b";
      processEndOfGame(winnerColor, loserColor, gameRoom, "Oponente desistiu.");
    });

    socket.on("requestDraw", (data) => {
      const { roomCode } = data;
      const room = gameRooms[roomCode];
      if (!room || !room.game || room.drawOfferBy) return;
      const isPlayer = room.players.some((p) => p.socketId === socket.id);
      if (!isPlayer) return;

      room.drawOfferBy = socket.id;
      if (room.timerInterval) clearInterval(room.timerInterval);
      const opponent = room.players.find((p) => p.socketId !== socket.id);
      if (opponent) io.to(opponent.socketId).emit("drawRequested");
      socket.emit("drawRequestSent");
    });
    socket.on("acceptDraw", (data) => {
      const { roomCode } = data;
      const room = gameRooms[roomCode];
      if (!room || !room.drawOfferBy || room.drawOfferBy === socket.id) return;
      processEndOfGame(null, null, room, "Empate acordado entre os jogadores.");
    });
    socket.on("declineDraw", (data) => {
      const { roomCode } = data;
      const room = gameRooms[roomCode];
      if (!room || !room.drawOfferBy || room.drawOfferBy === socket.id) return;
      const originalRequesterId = room.drawOfferBy;
      room.drawOfferBy = null;
      resetTimer(roomCode);
      io.to(originalRequesterId).emit("drawDeclined");
    });
    socket.on("requestRevanche", async ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || !room.isGameConcluded) return;
      const isPlayer = room.players.some((p) => p.socketId === socket.id);
      if (!isPlayer) return;

      if (!room.revancheRequests) room.revancheRequests = new Set();
      room.revancheRequests.add(socket.id);
      if (room.players.length === 2 && room.revancheRequests.size === 2) {
        const player1SocketId = room.players[0].socketId;
        const player2SocketId = room.players[1].socketId;
        if (
          room.revancheRequests.has(player1SocketId) &&
          room.revancheRequests.has(player2SocketId)
        ) {
          try {
            const player1 = room.players[0];
            const player2 = room.players[1];
            const user1 = await User.findOne({ email: player1.user.email });
            const user2 = await User.findOne({ email: player2.user.email });
            if (user1.saldo < room.bet || user2.saldo < room.bet) {
              io.to(room.roomCode).emit("revancheDeclined", {
                message: "Um dos jogadores não tem saldo suficiente.",
              });
              delete gameRooms[room.roomCode];
              return;
            }
            await User.findOneAndUpdate(
              { email: player1.user.email },
              { $inc: { saldo: -room.bet } }
            );
            await User.findOneAndUpdate(
              { email: player2.user.email },
              { $inc: { saldo: -room.bet } }
            );
            await startGameLogic(room);
          } catch (err) {
            console.error(err);
            io.to(room.roomCode).emit("revancheDeclined", {
              message: "Erro ao processar a aposta da revanche.",
            });
            delete gameRooms[room.roomCode];
          }
        }
      }
    });
    socket.on("leaveEndGameScreen", ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room) return;

      const playerWhoLeft = room.players.find((p) => p.socketId === socket.id);
      if (playerWhoLeft) {
        room.players = room.players.filter((p) => p.socketId !== socket.id);
        if (room.players.length === 1) {
          const opponent = room.players[0];
          if (opponent) {
            io.to(opponent.socketId).emit("revancheDeclined", {
              message: "O seu oponente saiu.",
            });
          }
        }
        if (room.players.length === 0) {
          if (room.cleanupTimeout) clearTimeout(room.cleanupTimeout);
          delete gameRooms[roomCode];
        }
      } else {
        socket.leave(roomCode);
      }
    });
  });
}

module.exports = {
  initializeSocket,
  gameRooms,
  startNextTablitaGame,
};
