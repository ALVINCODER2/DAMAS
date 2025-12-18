// src/socketHandlers.js

const User = require("../models/User");
const {
  standardOpening,
  idfTablitaOpenings,
  standardOpening10x10,
} = require("../utils/constants");

// Importa a lógica de jogo compartilhada
const {
  isMoveValid,
  checkWinCondition,
  hasValidMoves,
  getAllPossibleCapturesForPiece,
  findBestCaptureMoves,
  getUniqueCaptureMove,
} = require("../public/js/gameLogic");

const {
  startTimer,
  resetTimer,
  processEndOfGame,
  initializeManager,
} = require("./gameManager");

const gameRooms = {};
let io; // Variável global para instância do Socket.IO

function getLobbyInfo() {
  const waitingRooms = Object.values(gameRooms)
    .filter(
      (room) =>
        room.players.length === 1 && !room.isGameConcluded && !room.isPrivate
    )
    .map((room) => {
      const p1 = room.players[0].user;
      return {
        roomCode: room.roomCode,
        bet: room.bet,
        gameMode: room.gameMode,
        timeControl: room.timeControl,
        creatorEmail: p1.username || p1.email,
        creatorAvatar: p1.avatar,
        timerDuration: room.timerDuration,
      };
    });

  const activeRooms = Object.values(gameRooms)
    .filter(
      (room) =>
        room.players.length === 2 && !room.isGameConcluded && !room.isPrivate
    )
    .map((room) => {
      const p1 = room.players[0].user;
      const p2 = room.players[1].user;
      return {
        roomCode: room.roomCode,
        bet: room.bet,
        gameMode: room.gameMode,
        timeControl: room.timeControl,
        player1Email: p1.username || p1.email,
        player2Email: p2.username || p2.email,
        timerDuration: room.timerDuration,
      };
    });

  return { waiting: waitingRooms, active: activeRooms };
}

function cleanupPreviousRooms(userEmail) {
  const roomsToRemove = [];
  Object.keys(gameRooms).forEach((code) => {
    const r = gameRooms[code];
    // Remove se tiver apenas 1 jogador (criador) e for o mesmo email
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
    users: {
      white: whitePlayer.user.email,
      black: blackPlayer.user.email,
      whiteName: whitePlayer.user.username || whitePlayer.user.email,
      blackName: blackPlayer.user.username || blackPlayer.user.email,
      whiteAvatar: whitePlayer.user.avatar,
      blackAvatar: blackPlayer.user.avatar,
    },
    boardState: boardState,
    boardSize: boardSize,
    currentPlayer: "b",
    // O timer só será ativado no primeiro movimento válido
    timerActive: false,
    isFirstMove: true,
    movesSinceCapture: 0,
    damaMovesWithoutCaptureOrPawnMove: 0,
    openingName: openingName,
    mustCaptureWith: null,
    lastMove: null,
    moveHistory: [],
    initialBoardState: JSON.parse(JSON.stringify(boardState)),
    turnCapturedPieces: [], // INICIALIZA O ARRAY DE PEÇAS CAPTURADAS NO TURNO
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

  // Garantir que timerActive esteja explícito no payload
  gameState.timerActive = !!room.game.timerActive;

  io.to(room.roomCode).emit("gameStart", gameState);
  io.to(whitePlayer.socketId).emit("gameStart", gameState);
  io.to(blackPlayer.socketId).emit("gameStart", gameState);
}

// --- UPDATE: Agora aceita clientMoveId ---
async function executeMove(roomCode, from, to, socketId, clientMoveId = null) {
  if (!io) return;
  const gameRoom = gameRooms[roomCode];
  if (!gameRoom || !gameRoom.game) return;
  if (gameRoom.isGameConcluded) return;
  const game = gameRoom.game;

  const playerColor = game.currentPlayer;

  if (socketId) {
    const socketPlayerColor = game.players.white === socketId ? "b" : "p";
    if (socketPlayerColor !== playerColor) return;
  }

  if (game.isFirstMove) {
    game.isFirstMove = false;
    // Marca que o timer está oficialmente ativo (será enviado no estado do jogo)
    game.timerActive = true;
    // Inicia o timer no servidor
    startTimer(roomCode);
  }

  // Validação agora considera peças capturadas (fantasmas)
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

    // Move a peça no tabuleiro
    game.boardState[to.row][to.col] = game.boardState[from.row][from.col];
    game.boardState[from.row][from.col] = 0;

    // --- NOVO: Geração/Persistência do ID do Movimento ---
    // Se o cliente mandou um ID, usa ele. Se não, gera um novo.
    const moveId =
      clientMoveId ||
      Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    game.lastMove = { from, to, moveId };

    let canCaptureAgain = false;
    let wasPromotion = false;

    if (isValid.isCapture) {
      // CORREÇÃO CRÍTICA: NÃO removemos a peça do tabuleiro imediatamente
      // Apenas adicionamos à lista de 'mortos-vivos' que servem de obstáculo
      game.turnCapturedPieces.push(isValid.capturedPos);

      // Verifica se pode capturar mais
      const nextCaptures = getAllPossibleCapturesForPiece(to.row, to.col, game);
      canCaptureAgain = nextCaptures.length > 0;
    }

    if (!canCaptureAgain) {
      const currentPiece = game.boardState[to.row][to.col];
      // Promoção só acontece se parou de capturar
      if (currentPiece === "b" && to.row === 0) {
        game.boardState[to.row][to.col] = "B";
        wasPromotion = true;
      } else if (currentPiece === "p" && to.row === game.boardSize - 1) {
        game.boardState[to.row][to.col] = "P";
        wasPromotion = true;
      }

      // AGORA SIM, o turno acabou: removemos todas as peças capturadas do tabuleiro
      if (game.turnCapturedPieces.length > 0) {
        game.turnCapturedPieces.forEach((p) => {
          game.boardState[p.row][p.col] = 0;
        });
        game.turnCapturedPieces = []; // Limpa a lista
      }
    }

    if (wasPromotion) {
      canCaptureAgain = false;
      game.movesSinceCapture = 0;
      game.damaMovesWithoutCaptureOrPawnMove = 0;
    }

    // Salva histórico
    game.moveHistory.push({
      from,
      to,
      boardState: JSON.parse(JSON.stringify(game.boardState)),
      turn: playerColor,
      turnCapturedPieces: [...game.turnCapturedPieces], // Salva o estado das capturadas para replay fiel
      moveId, // Salva também no histórico para debug
    });

    // Lógica de empate por repetição e material
    let whitePieces = 0;
    let whiteDames = 0;
    let blackPieces = 0;
    let blackDames = 0;

    // Contagem de material
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

    // Definição dos finais específicos do PDF (Itens 99 e 100)
    const totalWhite = whitePieces;
    const totalBlack = blackPieces;

    // Cenários de Empate em 5 Lances (PDF)
    // 2 Damas vs 1 Dama
    const is2v1 =
      (whiteDames === 2 &&
        totalWhite === 2 &&
        blackDames === 1 &&
        totalBlack === 1) ||
      (blackDames === 2 &&
        totalBlack === 2 &&
        whiteDames === 1 &&
        totalWhite === 1);

    // 2 Damas vs 2 Damas (PDF Item 99)
    const is2v2 =
      whiteDames === 2 &&
      totalWhite === 2 &&
      blackDames === 2 &&
      totalBlack === 2;

    // 2 Damas vs 1 Dama e 1 Pedra (PDF Item 99 - Imagem) - Opcional, mas comum

    // 3 Damas (ou mais) vs 1 Dama (PDF Item 100)
    // Nota: O PDF exige que a dama solitária domine a "grande diagonal", mas para simplificar código,
    // costuma-se aplicar a regra de 5 lances para qualquer 3x1 de damas.
    const is3v1 =
      (whiteDames >= 3 &&
        totalWhite === whiteDames &&
        blackDames === 1 &&
        totalBlack === 1) ||
      (blackDames >= 3 &&
        totalBlack === blackDames &&
        whiteDames === 1 &&
        totalWhite === 1);

    // LÓGICA DE APLICAÇÃO DOS LIMITES
    if (gameRoom.gameMode !== "international" && !canCaptureAgain) {
      // Regra de 5 Lances (Finais Específicos)
      if (is2v1 || is2v2 || is3v1) {
        // Se entrou nesse cenário, o contador deve ser curto.
        // Nota: Você precisaria resetar um contador específico quando essa configuração de peças começa,
        // mas usar o 'movesSinceCapture' é uma aproximação aceitável se ele for zerado na captura que gerou essa posição.
        if (game.movesSinceCapture >= 10) {
          // 5 lances de CADA jogador = 10 movimentos totais no histórico
          return processEndOfGame(
            null,
            null,
            gameRoom,
            "Empate Técnico (Regra de 5 lances)."
          );
        }
      }

      // Regra Geral (20 Lances de Dama sem captura) - PDF às vezes menciona 20 ou 40 dependendo da variante
      if (game.damaMovesWithoutCaptureOrPawnMove >= 40)
        // 20 lances cada = 40 meio-lances
        return processEndOfGame(
          null,
          null,
          gameRoom,
          "Empate por 20 lances de Damas."
        );

      // Regra Geral de Falta de Progresso
      if (game.movesSinceCapture >= 40) {
        // 20 lances cada sem captura
        return processEndOfGame(
          null,
          null,
          gameRoom,
          "Empate por 20 jogadas sem captura."
        );
      }
    }

    // Se acabou o turno (não pode capturar mais)
    if (!canCaptureAgain) {
      // Checa vitória
      const winner = checkWinCondition(game.boardState, game.boardSize);
      if (winner) {
        const loser = winner === "b" ? "p" : "b";
        return processEndOfGame(winner, loser, gameRoom, "Fim de jogo!");
      }

      game.mustCaptureWith = null;
      game.currentPlayer = game.currentPlayer === "b" ? "p" : "b";
      game.turnCapturedPieces = []; // Garante limpeza de peças fantasmas na troca de turno

      // Verifica se o próximo jogador tem movimentos
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

    // Calcula próximas jogadas obrigatórias
    const bestCaptures = findBestCaptureMoves(game.currentPlayer, game);
    const mandatoryPieces = canCaptureAgain
      ? [{ row: to.row, col: to.col }]
      : bestCaptures.map((seq) => seq[0]);

    io.to(roomCode).emit("gameStateUpdate", { ...game, mandatoryPieces });

    // Auto-move se for único E for sequência de captura
    if (canCaptureAgain) {
      const uniqueMove = getUniqueCaptureMove(to.row, to.col, game);
      if (uniqueMove) {
        setTimeout(() => {
          if (gameRooms[roomCode] && !gameRooms[roomCode].isGameConcluded) {
            executeMove(
              roomCode,
              { row: to.row, col: to.col },
              uniqueMove.to,
              null,
              moveId + "_auto" // Sufixo para identificar automoves derivados
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

// Função para ser chamada externamente pelo gameManager para Tablita
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
  io = ioInstance;

  // Inicializa o GameManager com io e gameRooms para evitar erros de dependência circular
  initializeManager(io, gameRooms);

  io.on("connection", (socket) => {
    socket.on("enterLobby", (user) => {
      if (user) socket.userData = user;
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

      // Garantir campos explícitos para espectadores
      gameState.boardState = room.game.boardState;
      gameState.boardSize = room.game.boardSize;

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

      const { bet, gameMode, timerDuration, timeControl, isPrivate } = data; // Recebe isPrivate
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
        isPrivate: !!isPrivate, // Salva o status privado
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

      // Segurança para salas de Torneio
      if (room.isTournament) {
        if (
          !room.expectedPlayers ||
          !room.expectedPlayers.includes(socket.userData.email)
        ) {
          return socket.emit("joinError", {
            message: "Você não está escalado para esta partida de torneio.",
          });
        }
      }

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

      const creatorEmail = room.players[0].user.email;
      const joinerEmail = socket.userData.email;
      const bet = room.bet;

      // 1. Cobrança Atômica do Criador
      const creatorUpdate = await User.findOneAndUpdate(
        { email: creatorEmail, saldo: { $gte: bet } },
        [{ $set: { saldo: { $round: [{ $add: ["$saldo", -bet] }, 2] } } }],
        { new: true }
      );

      if (!creatorUpdate) {
        io.to(room.players[0].socketId).emit("joinError", {
          message: "O criador da sala não tem saldo suficiente.",
        });
        delete gameRooms[roomCode];
        io.emit("updateLobby", getLobbyInfo());
        return;
      }

      // 2. Cobrança Atômica do Entrante
      const joinerUpdate = await User.findOneAndUpdate(
        { email: joinerEmail, saldo: { $gte: bet } },
        [{ $set: { saldo: { $round: [{ $add: ["$saldo", -bet] }, 2] } } }],
        { new: true }
      );

      if (!joinerUpdate) {
        // Reembolsa o criador se o entrante falhar
        await User.findOneAndUpdate({ email: creatorEmail }, [
          { $set: { saldo: { $round: [{ $add: ["$saldo", bet] }, 2] } } },
        ]);
        socket.emit("joinError", { message: "Saldo insuficiente." });
        return;
      }

      if (room.disconnectTimeout) {
        clearTimeout(room.disconnectTimeout);
        room.disconnectTimeout = null;
      }
      socket.join(roomCode);
      room.players.push({ socketId: socket.id, user: socket.userData });

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
      await executeMove(
        moveData.room,
        moveData.from,
        moveData.to,
        socket.id,
        moveData.moveId
      );
    });

    socket.on("getValidMoves", (data) => {
      const { row, col, roomCode } = data;
      const room = gameRooms[roomCode];
      if (!room || !room.game) return socket.emit("showValidMoves", []);

      const game = room.game;
      const validMoves = [];
      const captures = getAllPossibleCapturesForPiece(row, col, game);

      if (game.mustCaptureWith) {
        if (
          row !== game.mustCaptureWith.row ||
          col !== game.mustCaptureWith.col
        ) {
          return socket.emit("showValidMoves", []);
        }
        captures.forEach((seq) => validMoves.push(seq[1]));
        return socket.emit("showValidMoves", validMoves);
      }

      const bestCaptures = findBestCaptureMoves(game.currentPlayer, game);
      if (bestCaptures.length > 0) {
        const capturesForThis = bestCaptures.filter(
          (seq) => seq[0].row === row && seq[0].col === col
        );
        capturesForThis.forEach((seq) => validMoves.push(seq[1]));
      } else {
        const boardSize = game.boardSize;
        for (let r = 0; r < boardSize; r++) {
          for (let c = 0; c < boardSize; c++) {
            if (
              isMoveValid(
                { row, col },
                { row: r, col: c },
                game.currentPlayer,
                game,
                true
              ).valid
            ) {
              validMoves.push({ row: r, col: c });
            }
          }
        }
      }

      socket.emit("showValidMoves", validMoves);
    });

    socket.on("rejoinActiveGame", (data) => {
      const { roomCode, user } = data;
      if (!roomCode || !user) return;
      socket.userData = user; // Garante que o userData esteja atualizado para verificações de torneio
      const room = gameRooms[roomCode];
      if (!room) {
        socket.emit("gameNotFound");
        return;
      }
      if (room.disconnectTimeout) {
        clearTimeout(room.disconnectTimeout);
        room.disconnectTimeout = null;
      }

      // Lógica para Torneio: Adicionar jogador à sala se ele for esperado
      if (
        room.isTournament &&
        room.expectedPlayers &&
        room.expectedPlayers.includes(user.email)
      ) {
        const alreadyIn = room.players.some((p) => p.user.email === user.email);
        if (!alreadyIn) {
          room.players.push({ socketId: socket.id, user: user });
          socket.join(roomCode);
          // Se ambos os jogadores entraram, inicia o jogo
          if (room.players.length === 2) {
            startGameLogic(room);
          }
          return;
        }
      }

      const player = room.players.find((p) => p.user.email === user.email);
      if (player) {
        player.socketId = socket.id;
        if (room.game && room.game.users) {
          if (room.game.users.white === user.email) {
            room.game.players.white = socket.id;
          } else if (room.game.users.black === user.email) {
            room.game.players.black = socket.id;
          }
        }
        socket.join(roomCode);

        let timeData = {};
        if (room.timeControl === "match") {
          timeData = { whiteTime: room.whiteTime, blackTime: room.blackTime };
        } else {
          timeData = { timeLeft: room.timeLeft };
        }

        if (room.game) {
          // Garantir timerActive explícito e logar estado de resumir jogo
          const gameResumedPayload = {
            gameState: room.game,
            ...timeData,
          };
          gameResumedPayload.gameState.timerActive = !!room.game.timerActive;
          // Emitting gameResumed (timerActive included)
          io.to(roomCode).emit("gameResumed", gameResumedPayload);

          // Só reinicia o timer se o jogo não estiver concluído e o timer já estiver ativo
          if (!room.isGameConcluded && room.game && room.game.timerActive) {
            startTimer(roomCode);

            // Força atualização imediata do timer para o usuário que reconectou
            socket.emit("timerUpdate", {
              ...timeData,
              roomCode,
            });
          } else {
            // Mesmo que não reinicie, envia estado atual do tempo (pausado ou não iniciado)
            socket.emit("timerUpdate", {
              ...timeData,
              roomCode,
              timerActive: room.game ? !!room.game.timerActive : false,
            });
          }
        }
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
            const bet = room.bet;

            // Cobrança Atômica P1
            const p1Update = await User.findOneAndUpdate(
              { email: player1.user.email, saldo: { $gte: bet } },
              [
                {
                  $set: { saldo: { $round: [{ $add: ["$saldo", -bet] }, 2] } },
                },
              ],
              { new: true }
            );

            if (!p1Update) {
              io.to(room.roomCode).emit("revancheDeclined", {
                message: "Jogador 1 sem saldo suficiente.",
              });
              delete gameRooms[room.roomCode];
              return;
            }

            // Cobrança Atômica P2
            const p2Update = await User.findOneAndUpdate(
              { email: player2.user.email, saldo: { $gte: bet } },
              [
                {
                  $set: { saldo: { $round: [{ $add: ["$saldo", -bet] }, 2] } },
                },
              ],
              { new: true }
            );

            if (!p2Update) {
              // Reembolsa P1
              await User.findOneAndUpdate({ email: player1.user.email }, [
                { $set: { saldo: { $round: [{ $add: ["$saldo", bet] }, 2] } } },
              ]);
              io.to(room.roomCode).emit("revancheDeclined", {
                message: "Jogador 2 sem saldo suficiente.",
              });
              delete gameRooms[room.roomCode];
              return;
            }

            // FIX: Reset match state for Tablita to force new opening on rematch
            if (room.gameMode === "tablita") {
              room.match = null;
            }

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
