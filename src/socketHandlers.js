// src/socketHandlers.js

const User = require("../models/User");
const MatchHistory = require("../models/MatchHistory");
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
  safeProcessEndOfGame,
  initializeManager,
} = require("./gameManager");

// Referência ao tournamentManager para encerrar partidas de torneio programaticamente
const tournamentManager = require("./tournamentManager");
const { enqueue } = require("./jobQueue");

const gameRooms = {};
let io; // Variável global para instância do Socket.IO
// Contador simples para razões de desconexão (diagnóstico)
const disconnectReasonCounts = {};

// Debounced/Throttled lobby update to avoid emitting too frequentemente
let _lobbyUpdateTimer = null;
let _lastLobbyPayload = null;
function scheduleLobbyUpdate(force) {
  try {
    _lastLobbyPayload = getLobbyInfo();
    if (force) {
      if (io) io.volatile.emit("updateLobby", _lastLobbyPayload);
      return;
    }
    if (_lobbyUpdateTimer) return; // já agendado
    _lobbyUpdateTimer = setTimeout(() => {
      try {
        if (io && _lastLobbyPayload)
          io.volatile.emit("updateLobby", _lastLobbyPayload);
      } catch (e) {}
      _lobbyUpdateTimer = null;
      _lastLobbyPayload = null;
    }, 300); // debounce 300ms
  } catch (e) {}
}

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

// Agenda e gerencia timeout de inatividade por turno (10s)
function scheduleTurnInactivity(roomCode) {
  const room = gameRooms[roomCode];
  if (!room || room.isGameConcluded) return;

  // limpa qualquer timeout anterior
  if (room.turnInactivityTimeout) clearTimeout(room.turnInactivityTimeout);

  // calcula duração do timeout de inatividade com base no modo de tempo da sala
  function getDurationForRoom(r) {
    if (!r) return 10 * 1000;
    try {
      // Se o jogo acabou de iniciar (primeiro lance ainda não ocorreu),
      // damos uma janela de graça maior para evitar encerramentos
      // instantâneos causados por timeouts padrão curtos.
      if (r.game && r.game.isFirstMove) {
        return Math.max(10 * 1000, 60 * 1000); // 60s de graça no primeiro lance
      }
      // Prioriza timeControl configurado
      if (r.timeControl === "match") {
        // Usa tempo restante do jogador atual (whiteTime / blackTime)
        const cp = r.game && r.game.currentPlayer;
        const rem = cp === "b" ? r.whiteTime : r.blackTime;
        return Math.max(1, typeof rem === "number" ? rem : 10) * 1000;
      }
      if (r.timeControl === "move") {
        // Usa timerDuration (segundos por jogada) caso exista
        const dur =
          typeof r.timerDuration === "number"
            ? r.timerDuration
            : r.timeLeft || 10;
        return Math.max(1, dur) * 1000;
      }

      // Se existir timerActive no game, tentamos usar timeLeft / whiteTime/blackTime
      if (r.game && r.game.timerActive) {
        if (typeof r.timeLeft === "number")
          return Math.max(1, r.timeLeft) * 1000;
        const cp2 = r.game.currentPlayer;
        const rem2 = cp2 === "b" ? r.whiteTime : r.blackTime;
        if (typeof rem2 === "number") return Math.max(1, rem2) * 1000;
      }
    } catch (e) {}
    // fallback padrão 10s
    return 10 * 1000;
  }

  const initialDuration = getDurationForRoom(room);
  room.turnInactivityTimeout = setTimeout(() => {
    try {
      const r = gameRooms[roomCode];
      if (!r || r.isGameConcluded || !r.game) return;

      const currentPlayerColor = r.game.currentPlayer; // 'b' ou 'p'
      const currentSocketId =
        r.game.players[currentPlayerColor === "b" ? "white" : "black"];
      console.log(
        `[DEBUG scheduleTurnInactivity] room=${roomCode} currentPlayer=${currentPlayerColor} currentSocketId=${currentSocketId} _autoPassCount=${
          r._autoPassCount || 0
        } moveHistoryLen=${r.game.moveHistory ? r.game.moveHistory.length : 0}`
      );

      // Verifica se o socket atual está presente/connected
      const sock = currentSocketId
        ? io.sockets.sockets.get(currentSocketId)
        : null;
      const isPresent = !!(sock && sock.connected);

      // Se ausente ou inativo por 10s, tratamos de acordo com o modo de tempo
      if (!isPresent) {
        console.log(
          `[DEBUG scheduleTurnInactivity] player absent check: room=${roomCode} currentPlayer=${currentPlayerColor} currentSocketId=${currentSocketId} playersMapping=${JSON.stringify(
            r.game.players
          )} roomPlayers=${JSON.stringify(
            r.players.map((p) => ({
              email: p.user.email,
              socketId: p.socketId,
            }))
          )}`
        );
        // Se o jogo tem timer ativo (modo com limite por jogada/partida),
        // a inatividade deve resultar em perda por tempo — não apenas passar a vez.
        if (
          rr.timeControl === "move" ||
          (rr.game && rr.game.timerActive && rr.timeControl !== "match")
        ) {
          if (rr.timerInterval) {
            console.log(
              `[scheduleTurnInactivity] Skipping inactivity-based end; timerInterval active for room=${roomCode}`
            );
            return;
          }
          try {
            const loserColor = r.game.currentPlayer;
            const winnerColor = loserColor === "b" ? "p" : "b";
            safeProcessEndOfGame(
              winnerColor,
              loserColor,
              r,
              "Tempo esgotado por inatividade"
            );
          } catch (e) {
            console.error("Erro processando perda por tempo (inatividade):", e);
          }
          return;
        }

        // Caso não haja timer ativo, passa a vez ao oponente (auto-pass)
        // Passa a vez
        r.game.currentPlayer = r.game.currentPlayer === "b" ? "p" : "b";
        r.turnInactivityTimeoutReason = "auto-pass";
        // conta auto-passes consecutivos para detectar ambos ausentes
        r._autoPassCount = (r._autoPassCount || 0) + 1;
        io.to(r.roomCode).emit("turnPassedDueToInactivity", {
          roomCode: r.roomCode,
          newCurrentPlayer: r.game.currentPlayer,
        });

        // Emite estado atualizado do jogo
        const bestCaptures = findBestCaptureMoves(r.game.currentPlayer, r.game);
        const mandatoryPieces = bestCaptures.map((seq) => seq[0]);
        sendGameState(r.roomCode, {
          ...r.game,
          mandatoryPieces,
        });

        // Reinicia timers do jogo do servidor
        try {
          if (r.timerInterval) clearInterval(r.timerInterval);
        } catch (e) {}
        // Inicia timer normal (se aplicável)
        if (r.game && r.game.timerActive) startTimer(r.roomCode);

        // Se ambos jogadores receberam auto-pass sem que haja movimentos, encerramos como ambos forfeit
        if (
          r._autoPassCount >= 2 &&
          r.game.moveHistory &&
          r.game.moveHistory.length === 0
        ) {
          (async () => {
            try {
              // Marca fim de partida por dupla falta
              await tournamentManager.handleTournamentGameEnd(
                "BOTH_FORFEIT",
                null,
                r
              );
            } catch (e) {
              console.error("Erro encerrando partida BOTH_FORFEIT:", e);
            }
          })();
          return;
        }

        // Agenda nova verificação para o próximo jogador
        scheduleTurnInactivity(roomCode);
      } else {
        // jogador presente; se não jogar dentro de mais 10s, também passamos a vez
        // Reagenda uma checagem final (usa duração recalculada)
        const rrDuration = getDurationForRoom(room);
        room.turnInactivityTimeout = setTimeout(() => {
          const rr = gameRooms[roomCode];
          if (!rr || rr.isGameConcluded || !rr.game) return;
          // Se ainda for o mesmo jogador e não houver movimento (moveHistory não cresceu),
          // tratamos conforme o modo de tempo: se houver timer ativo, encerramos por perda de tempo;
          // caso contrário, passa-se a vez.
          if (
            r.timeControl === "move" ||
            (r.game && r.game.timerActive && r.timeControl !== "match")
          ) {
            // If the server-side timer is already running, prefer it as the canonical
            // source of time loss. Avoid double-calling the end-of-game from the
            // inactivity watchdog when the per-move timer (`timerInterval`) is active.
            if (r.timerInterval) {
              console.log(
                `[scheduleTurnInactivity] Skipping inactivity-based end; timerInterval active for room=${roomCode}`
              );
              return;
            }
            try {
              const loserColor = rr.game.currentPlayer;
              const winnerColor = loserColor === "b" ? "p" : "b";
              safeProcessEndOfGame(
                winnerColor,
                loserColor,
                rr,
                "Tempo esgotado por inatividade"
              );
            } catch (e) {
              console.error(
                "Erro processando perda por tempo (inatividade):",
                e
              );
            }
            return;
          }

          // Sem timer ativo: passa a vez
          rr.game.currentPlayer = rr.game.currentPlayer === "b" ? "p" : "b";
          io.to(rr.roomCode).emit("turnPassedDueToInactivity", {
            roomCode: rr.roomCode,
            newCurrentPlayer: rr.game.currentPlayer,
          });
          rr._autoPassCount = (rr._autoPassCount || 0) + 1;
          if (
            rr._autoPassCount >= 2 &&
            rr.game.moveHistory &&
            rr.game.moveHistory.length === 0
          ) {
            (async () => {
              try {
                await tournamentManager.handleTournamentGameEnd(
                  "BOTH_FORFEIT",
                  null,
                  rr
                );
              } catch (e) {
                console.error("Erro encerrando partida BOTH_FORFEIT:", e);
              }
            })();
            return;
          }
          const bestCaptures2 = findBestCaptureMoves(
            rr.game.currentPlayer,
            rr.game
          );
          const mandatoryPieces2 = bestCaptures2.map((seq) => seq[0]);
          sendGameState(rr.roomCode, {
            ...rr.game,
            mandatoryPieces: mandatoryPieces2,
          });
          if (rr.game && rr.game.timerActive) startTimer(rr.roomCode);
          scheduleTurnInactivity(roomCode);
        }, rrDuration);
      }
    } catch (err) {
      console.error("Error in scheduleTurnInactivity:", err);
    }
  }, initialDuration);
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
    try {
      console.log(
        `[${new Date().toISOString()}] [Limpeza] Removendo sala ${code} (creator=${userEmail}) totalBefore=${
          Object.keys(gameRooms).length
        }`
      );
    } catch (e) {}
    delete gameRooms[code];
    console.log(
      `[Limpeza] Sala ${code} excluída automaticamente pois o criador (${userEmail}) iniciou outra ação.`
    );
  });

  if (roomsToRemove.length > 0 && io) {
    scheduleLobbyUpdate();
  }
}

// Helper: envia estado completo para jogadores e versão reduzida/throttled para espectadores
function sendGameState(roomCode, fullState, opts = {}) {
  try {
    const room = gameRooms[roomCode];
    if (!room) return;

    // Envia sempre o estado completo para os jogadores (por socketId)
    if (room.players && room.players.length > 0) {
      for (const p of room.players) {
        try {
          if (p && p.socketId)
            io.to(p.socketId).emit("gameStateUpdate", fullState);
        } catch (e) {}
      }
    }

    // Throttle para espectadores: no máximo uma emissão a cada INTERVAL ms
    const INTERVAL =
      typeof opts.spectatorInterval === "number" ? opts.spectatorInterval : 350;
    const now = Date.now();
    if (!room._lastSpectatorUpdate) room._lastSpectatorUpdate = 0;
    if (now - room._lastSpectatorUpdate < INTERVAL && !opts.forceSpectator)
      return;
    room._lastSpectatorUpdate = now;

    if (room.spectators && room.spectators.size > 0) {
      // Payload reduzido para espectadores (menos campos pesados)
      const reduced = {
        boardState: fullState.boardState,
        boardSize: fullState.boardSize,
        // Alguns lugares do código vestigial usam 'turn' em vez de
        // 'currentPlayer'. Garantir compatibilidade para espectadores.
        currentPlayer: fullState.currentPlayer || fullState.turn || null,
        lastMove: fullState.lastMove || fullState.lastMove || null,
        roomCode: roomCode,
        timerActive: !!fullState.timerActive,
        // Inclui tempos para espectadores (white/black/timeLeft) para atualizar timers
        whiteTime:
          typeof fullState.whiteTime === "number" ? fullState.whiteTime : null,
        blackTime:
          typeof fullState.blackTime === "number" ? fullState.blackTime : null,
        timeLeft:
          typeof fullState.timeLeft === "number" ? fullState.timeLeft : null,
      };
      try {
        // Emit in batch to the spectators room to avoid per-socket loops.
        const specRoomName = `${roomCode}-spectators`;
        io.to(specRoomName).volatile.emit("gameStateUpdate", reduced);
      } catch (e) {}
    }
  } catch (e) {
    console.error("sendGameState error:", e);
  }
}

async function startGameLogic(room) {
  if (!io) return;
  // Proteção contra starts concorrentes / caminhos indesejados
  try {
    if (!room) return;
    if (room._noFurtherGames) {
      console.log(
        `[startGameLogic] Sala ${room.roomCode} tem _noFurtherGames -> abortando start`
      );
      return;
    }
    if (room._starting) {
      console.log(
        `[startGameLogic] Sala ${room.roomCode} já está em processo de start -> abortando start concorrente`
      );
      return;
    }
    room._starting = true;
  } catch (e) {}

  // Limpamos timeouts/contadores pendentes antes de iniciar um novo jogo
  // Guard rails: não iniciar se a sala estiver marcada como concluída,
  // se o match Tablita já foi decidido, ou se não houver 2 jogadores conectados.
  try {
    if (!room) return;
    if (room.isGameConcluded) {
      console.log(
        `[startGameLogic] Sala ${room.roomCode} marcada como concluída. Abortando novo jogo.`
      );
      return;
    }
    if (room.isTablita && room.match) {
      const p1 = room.match.player1 && room.match.player1.email;
      const p2 = room.match.player2 && room.match.player2.email;
      const p1Score =
        room.match.score && typeof room.match.score[p1] === "number"
          ? room.match.score[p1]
          : 0;
      const p2Score =
        room.match.score && typeof room.match.score[p2] === "number"
          ? room.match.score[p2]
          : 0;
      if (
        p1Score >= 2 ||
        p2Score >= 2 ||
        (room.match.currentGame && room.match.currentGame > 2)
      ) {
        console.log(
          `[startGameLogic] Match já decidido para sala ${room.roomCode} (p1=${p1Score} p2=${p2Score} currentGame=${room.match.currentGame}). Abortando.`
        );
        room.isGameConcluded = true;
        return;
      }
    }
    // Checa se ambos jogadores estão conectados
    const connectedCount = (room.players || []).filter((p) => {
      try {
        return (
          p &&
          p.socketId &&
          io.sockets.sockets.get(p.socketId) &&
          io.sockets.sockets.get(p.socketId).connected
        );
      } catch (e) {
        return false;
      }
    }).length;
    if (connectedCount < 2) {
      console.log(
        `[startGameLogic] Menos de 2 jogadores conectados na sala ${room.roomCode} (connected=${connectedCount}). Abortando novo jogo.`
      );
      // Se for Tablita, finaliza o match declarando vencedor pelo placar
      if (room.isTablita && room.match) {
        const p1 = room.match.player1 && room.match.player1.email;
        const p2 = room.match.player2 && room.match.player2.email;
        const p1Score =
          room.match.score && typeof room.match.score[p1] === "number"
            ? room.match.score[p1]
            : 0;
        const p2Score =
          room.match.score && typeof room.match.score[p2] === "number"
            ? room.match.score[p2]
            : 0;
        let finalWinner = null;
        if (p1Score > p2Score) finalWinner = room.match.player1;
        else if (p2Score > p1Score) finalWinner = room.match.player2;
        if (finalWinner) {
          const winnerColorFinal =
            room.game &&
            room.game.users &&
            room.game.users.white === finalWinner.email
              ? "b"
              : "p";
          const finalReason = `Fim do match: jogador ausente. Placar: ${p1Score} a ${p2Score}.`;
          io.to(room.roomCode).emit("gameOver", {
            winner: winnerColorFinal,
            reason: finalReason,
            moveHistory: room.game ? room.game.moveHistory : [],
            initialBoardState: room.game ? room.game.initialBoardState : null,
          });
          try {
            const specRoom = `${room.roomCode}-spectators`;
            io.to(specRoom).emit("gameOver", {
              winner: winnerColorFinal,
              reason: finalReason,
              moveHistory: room.game ? room.game.moveHistory : [],
              initialBoardState: room.game ? room.game.initialBoardState : null,
            });
          } catch (e) {}
          room.isGameConcluded = true;
        }
      }
      return;
    }
  } catch (e) {
    console.error("Erro nas checagens iniciais de startGameLogic:", e);
  }
  try {
    if (room.turnInactivityTimeout) {
      clearTimeout(room.turnInactivityTimeout);
      room.turnInactivityTimeout = null;
    }
    if (room.firstMoveTimeout) {
      clearTimeout(room.firstMoveTimeout);
      room.firstMoveTimeout = null;
    }
    // Reset contador de auto-pass para evitar transportar estados da partida anterior
    room._autoPassCount = 0;
    // Limpa timestamp de encerramento anterior para permitir novo fluxo
    try {
      room._lastEndTimestamp = null;
    } catch (e) {}
  } catch (e) {}
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
    return safeProcessEndOfGame(
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
  // Inicializa/garante sequência da sala para detecção de dessincronização
  try {
    room.seq = room.seq || 0;
    gameState.seq = room.seq;
  } catch (e) {}
  console.log(
    `[DEBUG startGameLogic] room=${room.roomCode} players=${room.players
      .map((p) => p.user.email)
      .join(",")} isTournament=${room.isTournament}`
  );

  // Garantir que timerActive esteja explícito no payload
  gameState.timerActive = !!room.game.timerActive;

  io.to(room.roomCode).emit("gameStart", gameState);
  if (whitePlayer && whitePlayer.socketId)
    io.to(whitePlayer.socketId).emit("gameStart", gameState);
  if (blackPlayer && blackPlayer.socketId)
    io.to(blackPlayer.socketId).emit("gameStart", gameState);
  // notify current spectator count to all in room
  io.to(room.roomCode).volatile.emit("spectatorCount", {
    count: room.spectators ? room.spectators.size : 0,
  });

  // clear the starting lock shortly after starting to allow future legitimate starts
  try {
    setTimeout(() => {
      try {
        if (room) room._starting = false;
      } catch (e) {}
    }, 2000);
  } catch (e) {}

  // Para partidas de torneio, iniciar verificação de inatividade por turno (10s)
  if (room.isTournament) {
    try {
      scheduleTurnInactivity(room.roomCode);
    } catch (e) {}
  }

  // If no move is made within 20 seconds from game start, refund both players and remove the room
  try {
    if (room.firstMoveTimeout) clearTimeout(room.firstMoveTimeout);
    room.firstMoveTimeout = setTimeout(async () => {
      try {
        const currentRoom = gameRooms[room.roomCode];
        if (!currentRoom) return;
        const g = currentRoom.game;
        if (!g) return;
        // If no moves were made yet
        if (!g.moveHistory || g.moveHistory.length === 0) {
          // Se for partida de torneio, NÃO reembolsar automaticamente;
          // aplicamos regras de inatividade específicas.
          if (currentRoom.isTournament) {
            console.log(
              `[GameWatchdog] Torneio: sem movimento em 20s na sala ${room.roomCode}. Aplicando regras de inatividade (auto-pass).`
            );
            scheduleTurnInactivity(currentRoom.roomCode);
            return;
          }

          console.log(
            `[GameWatchdog] No moves in 20s for room ${room.roomCode}. Refunding and removing room.`
          );

          // Refund each player and emit balance + redirect event
          const playersEmails = currentRoom.players.map((x) => x.user.email);
          for (const p of currentRoom.players) {
            try {
              const updated = await User.findOneAndUpdate(
                { email: p.user.email },
                { $inc: { saldo: currentRoom.bet } },
                { new: true }
              );
              if (updated && io && p.socketId) {
                io.to(p.socketId).emit("balanceUpdate", {
                  email: updated.email,
                  newSaldo: updated.saldo,
                });
                io.to(p.socketId).emit("refundAndReturn", {
                  message: "Partida inativa: reembolso efetuado.",
                  roomCode: currentRoom.roomCode,
                });
              }
            } catch (userErr) {
              console.error("Error refunding user:", userErr);
            }
          }

          // Save a single MatchHistory entry marking the refund
          if (typeof MatchHistory !== "undefined") {
            try {
              // Enfileira a gravação serializável para não bloquear o watchdog
              enqueue({
                type: "saveMatchHistory",
                payload: {
                  player1: playersEmails[0] || "",
                  player2: playersEmails[1] || "",
                  winner: null,
                  bet: currentRoom.bet,
                  gameMode: currentRoom.gameMode || "classic",
                  reason: "Partida inativa (nenhum lance) - reembolso",
                },
              });
            } catch (eh) {
              console.error("Failed to enqueue refund MatchHistory:", eh);
            }
          }

          // Clean up timers and room
          if (currentRoom.timerInterval)
            clearInterval(currentRoom.timerInterval);
          try {
            console.log(
              `[${new Date().toISOString()}] [FirstMoveTimeout] Removendo room ${
                room.roomCode
              } por inatividade totalBefore=${Object.keys(gameRooms).length}`
            );
          } catch (e) {}
          delete gameRooms[room.roomCode];
          scheduleLobbyUpdate();
        }
      } catch (err) {
        console.error("Error in firstMove timeout handler:", err);
      }
    }, 20 * 1000);
  } catch (err) {
    console.error("Error scheduling firstMove timeout:", err);
  }
}

// --- UPDATE: Agora aceita clientMoveId ---
async function executeMove(roomCode, from, to, socketId, clientMoveId = null) {
  if (!io) return;
  try {
    console.log(
      `[DEBUG executeMove] room=${roomCode} from=${JSON.stringify(
        from
      )} to=${JSON.stringify(
        to
      )} socketId=${socketId} clientMoveId=${clientMoveId}`
    );
  } catch (e) {}
  const gameRoom = gameRooms[roomCode];
  if (!gameRoom || !gameRoom.game) return;
  if (gameRoom.isGameConcluded) return;
  const game = gameRoom.game;

  // Clear any per-turn inactivity timer when a move is being processed
  if (gameRoom.turnInactivityTimeout) {
    clearTimeout(gameRoom.turnInactivityTimeout);
    gameRoom.turnInactivityTimeout = null;
  }
  // Reset auto-pass counter since a real move occurred
  gameRoom._autoPassCount = 0;

  const playerColor = game.currentPlayer;

  if (socketId) {
    const socketPlayerColor = game.players.white === socketId ? "b" : "p";
    if (socketPlayerColor !== playerColor) return;
  }

  if (game.isFirstMove) {
    // clear first-move watchdog (player acted within allowed window)
    if (gameRoom.firstMoveTimeout) {
      clearTimeout(gameRoom.firstMoveTimeout);
      gameRoom.firstMoveTimeout = null;
    }
    game.isFirstMove = false;
    // Marca que o timer está oficialmente ativo (será enviado no estado do jogo)
    game.timerActive = true;
    // Inicia o timer no servidor
    startTimer(roomCode);
  }

  // Validação agora considera peças capturadas (fantasmas)
  const isValid = isMoveValid(from, to, playerColor, game);

  // Validação extra de captura obrigatória no servidor:
  try {
    const bestCaps = findBestCaptureMoves(game.currentPlayer, game);
    if (bestCaps && bestCaps.length > 0 && !isValid.isCapture) {
      // Jogada inválida: existe captura obrigatória
      if (socketId) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket)
          socket.emit("invalidMove", { message: "Captura obrigatória." });
      }
      return;
    }
  } catch (e) {
    console.error("Erro validando captura obrigatória:", e);
  }

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

    // Guarda localmente as posições capturadas neste movimento (se houver)
    let capturedThisMove = [];
    if (isValid.isCapture) {
      // CORREÇÃO CRÍTICA: NÃO removemos a peça do tabuleiro imediatamente
      // Apenas adicionamos à lista de 'mortos-vivos' que servem de obstáculo
      if (Array.isArray(isValid.capturedPos)) {
        isValid.capturedPos.forEach((p) => game.turnCapturedPieces.push(p));
        capturedThisMove = [...isValid.capturedPos];
      } else if (isValid.capturedPos) {
        game.turnCapturedPieces.push(isValid.capturedPos);
        capturedThisMove = [isValid.capturedPos];
      }

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

    // Salva histórico (inclui as capturas deste movimento)
    game.moveHistory.push({
      from,
      to,
      boardState: JSON.parse(JSON.stringify(game.boardState)),
      turn: playerColor,
      turnCapturedPieces:
        capturedThisMove.length > 0 ? [...capturedThisMove] : [],
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
      // Regras para finais específicos
      // - 2 Damas vs 1 Dama e 2 Damas vs 2 Damas: Regra de 5 lances (10 meio-lances)
      // - 3 Damas vs 1 Dama: aplicar regra de 20 lances (20 lances de cada jogador = 40 meio-lances)
      if (is2v1 || is2v2 || is3v1) {
        // Nota: idealmente deveríamos iniciar/resetar um contador específico quando a
        // configuração material aparece pela primeira vez; usamos 'movesSinceCapture'
        // como aproximação desde que ele seja zerado nas capturas que geram a posição.
        if (is3v1) {
          // 20 lances de CADA jogador = 40 movimentos totais no histórico
          if (game.movesSinceCapture >= 40) {
            return safeProcessEndOfGame(
              null,
              null,
              gameRoom,
              "Empate Técnico (3 Damas vs 1 Dama — 20 lances)."
            );
          }
        } else {
          // 5 lances de CADA jogador = 10 movimentos totais no histórico
          if (game.movesSinceCapture >= 10) {
            return safeProcessEndOfGame(
              null,
              null,
              gameRoom,
              "Empate Técnico (Regra de 5 lances)."
            );
          }
        }
      }

      // Regra Geral (20 Lances de Dama sem captura) - PDF às vezes menciona 20 ou 40 dependendo da variante
      if (game.damaMovesWithoutCaptureOrPawnMove >= 40)
        // 20 lances cada = 40 meio-lances
        return safeProcessEndOfGame(
          null,
          null,
          gameRoom,
          "Empate por 20 lances de Damas."
        );

      // Regra Geral de Falta de Progresso
      if (game.movesSinceCapture >= 40) {
        // 20 lances cada sem captura
        return safeProcessEndOfGame(
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
        return safeProcessEndOfGame(winner, loser, gameRoom, "Fim de jogo!");
      }

      game.mustCaptureWith = null;
      game.currentPlayer = game.currentPlayer === "b" ? "p" : "b";
      game.turnCapturedPieces = []; // Garante limpeza de peças fantasmas na troca de turno

      // Verifica se o próximo jogador tem movimentos
      if (!hasValidMoves(game.currentPlayer, game)) {
        const winner = game.currentPlayer === "b" ? "p" : "b";
        return safeProcessEndOfGame(
          winner,
          game.currentPlayer,
          gameRoom,
          "Oponente bloqueado!"
        );
      }
      resetTimer(roomCode);
      // Agenda verificação de inatividade para o próximo jogador (10s)
      try {
        scheduleTurnInactivity(roomCode);
      } catch (e) {}
    } else {
      game.mustCaptureWith = { row: to.row, col: to.col };
      // Reinicia o cronômetro para cada tomada sequencial (auto-move),
      // garantindo que o jogador tenha tempo suficiente para executar
      // múltiplas capturas em salas com timers curtos (ex: 5s por jogada).
      try {
        resetTimer(roomCode);
      } catch (e) {
        console.error("resetTimer failed on sequential capture:", e);
      }
    }

    // Calcula próximas jogadas obrigatórias
    const bestCaptures = findBestCaptureMoves(game.currentPlayer, game);
    const mandatoryPieces = canCaptureAgain
      ? [{ row: to.row, col: to.col }]
      : bestCaptures.map((seq) => seq[0]);

    // Incrementa um número de sequência simples para detectar dessincronizações
    try {
      room.seq = (room.seq || 0) + 1;
      game.seq = room.seq;
    } catch (e) {}

    // Emite apenas o delta do movimento para reduzir payloads (clientes podem animar localmente)
    try {
      // Garante que o payload do delta contenha as posições capturadas
      // ocorridas neste movimento (mesmo que o servidor já tenha removido
      // as peças do tabuleiro ao terminar o turno).
      const pieceMovedPayload = {
        lastMove: game.lastMove,
        captured: capturedThisMove.length > 0 ? [...capturedThisMove] : [],
        currentPlayer: game.currentPlayer,
        mandatoryPieces,
        seq: game.seq,
        boardSize: game.boardSize,
      };
      io.to(roomCode).emit("pieceMoved", pieceMovedPayload);
    } catch (e) {
      console.error("Erro emitindo pieceMoved:", e);
    }

    // Ainda emitimos o estado completo para jogadores conectados por compatibilidade,
    // e forçamos uma atualização imediata para espectadores para que seus
    // timers (contadores) sejam atualizados imediatamente após a jogada.
    sendGameState(
      roomCode,
      {
        ...game,
        mandatoryPieces,
        // Garantir que campos de tempo venham do room para espectadores
        whiteTime:
          typeof gameRoom.whiteTime === "number"
            ? gameRoom.whiteTime
            : undefined,
        blackTime:
          typeof gameRoom.blackTime === "number"
            ? gameRoom.blackTime
            : undefined,
        timeLeft:
          typeof gameRoom.timeLeft === "number" ? gameRoom.timeLeft : undefined,
        timerActive:
          game.timerActive !== undefined ? !!game.timerActive : undefined,
        currentPlayer: game.currentPlayer,
      },
      { forceSpectator: true }
    );

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
    // Defensive resets: garante que sinais residuais da partida anterior
    // (timers, timeouts, marcações de conclusão) não impeçam o novo jogo.
    try {
      room.isGameConcluded = false;
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
      }
      if (room.turnInactivityTimeout) {
        clearTimeout(room.turnInactivityTimeout);
        room.turnInactivityTimeout = null;
      }
      if (room.firstMoveTimeout) {
        clearTimeout(room.firstMoveTimeout);
        room.firstMoveTimeout = null;
      }
      room._autoPassCount = 0;
    } catch (e) {
      console.error("Erro ao resetar timers antes da próxima Tablita:", e);
    }

    // Antes de iniciar o próximo jogo, verifica primeiro se o match já não
    // foi decidido (placar ou currentGame inválido). Em seguida checa
    // conectividade; se faltar jogador, finalizamos o match.
    try {
      const p1Email =
        room.match && room.match.player1 && room.match.player1.email;
      const p2Email =
        room.match && room.match.player2 && room.match.player2.email;
      const p1Score =
        room.match && room.match.score ? room.match.score[p1Email] || 0 : 0;
      const p2Score =
        room.match && room.match.score ? room.match.score[p2Email] || 0 : 0;
      const matchAlreadyOver =
        p1Score >= 2 ||
        p2Score >= 2 ||
        (room.match && room.match.currentGame > 2);
      if (matchAlreadyOver) {
        console.log(
          `[Tablita] Não iniciando próxima partida para ${roomCode}: match já decidido (p1=${p1Score} p2=${p2Score} currentGame=${
            room.match && room.match.currentGame
          })`
        );
        room.isGameConcluded = true;
        room.cleanupTimeout = setTimeout(() => {
          if (gameRooms[room.roomCode]) delete gameRooms[room.roomCode];
        }, 60000);
        return;
      }

      const connectedPlayers = (room.players || []).filter((p) => {
        try {
          return (
            p &&
            p.socketId &&
            io.sockets.sockets.get(p.socketId) &&
            io.sockets.sockets.get(p.socketId).connected
          );
        } catch (ee) {
          return false;
        }
      });

      if (connectedPlayers.length < 2) {
        console.log(
          `[Tablita] Não iniciando jogo 2 em ${roomCode}: jogadores conectados=${connectedPlayers.length}`
        );

        // Decide vencedor final com base no placar atual ou no jogador presente
        const p1Email =
          room.match && room.match.player1 && room.match.player1.email;
        const p2Email =
          room.match && room.match.player2 && room.match.player2.email;
        const p1Score =
          room.match && room.match.score ? room.match.score[p1Email] || 0 : 0;
        const p2Score =
          room.match && room.match.score ? room.match.score[p2Email] || 0 : 0;

        let finalWinnerData = null;
        if (p1Score > p2Score) finalWinnerData = room.match.player1;
        else if (p2Score > p1Score) finalWinnerData = room.match.player2;
        else if (connectedPlayers.length === 1) {
          const connEmail = connectedPlayers[0].user.email;
          finalWinnerData =
            room.match.player1.email === connEmail
              ? room.match.player1
              : room.match.player2;
        }

        if (finalWinnerData) {
          try {
            const prize = room.bet * 2;
            const updatedWinner = await User.findOneAndUpdate(
              { email: finalWinnerData.email },
              [
                {
                  $set: { saldo: { $round: [{ $add: ["$saldo", prize] }, 2] } },
                },
              ],
              { new: true }
            );

            const winnerColorFinal =
              room.game &&
              room.game.users &&
              room.game.users.white === finalWinnerData.email
                ? "b"
                : "p";

            const finalReason = `Fim do match: jogador ausente. Placar: ${p1Score} a ${p2Score}.`;

            io.to(room.roomCode).emit("gameOver", {
              winner: winnerColorFinal,
              reason: finalReason,
              moveHistory: room.game ? room.game.moveHistory : [],
              initialBoardState: room.game ? room.game.initialBoardState : null,
            });
            try {
              const specRoom = `${room.roomCode}-spectators`;
              io.to(specRoom).emit("gameOver", {
                winner: winnerColorFinal,
                reason: finalReason,
                moveHistory: room.game ? room.game.moveHistory : [],
                initialBoardState: room.game
                  ? room.game.initialBoardState
                  : null,
              });
            } catch (e) {}

            if (updatedWinner && finalWinnerData.socketId) {
              const ws = io.sockets.sockets.get(finalWinnerData.socketId);
              if (ws) ws.emit("updateSaldo", { newSaldo: updatedWinner.saldo });
            }

            // Salva histórico simplificado do match
            try {
              await MatchHistory.create({
                player1: p1Email || "",
                player2: p2Email || "",
                winner: finalWinnerData.email,
                bet: room.bet,
                gameMode: room.gameMode,
                reason: finalReason,
                createdAt: new Date(),
              });
            } catch (mhErr) {
              console.error(
                "Erro salvando MatchHistory ao finalizar match por ausência:",
                mhErr
              );
            }
          } catch (e) {
            console.error("Erro ao encerrar match por jogadores ausentes:", e);
          }
        }

        room.isGameConcluded = true;
        // Prevent any other code path from attempting to start new games
        room._noFurtherGames = true;
        room.cleanupTimeout = setTimeout(() => {
          if (gameRooms[room.roomCode]) delete gameRooms[room.roomCode];
        }, 60000);
        return;
      }
    } catch (err) {
      console.error(
        "Erro verificando conectividade antes de startNextTablitaGame:",
        err
      );
    }

    await startGameLogic(room);
  } else {
    console.log(
      `[Tablita] Sala ${roomCode} não encontrada para próxima partida.`
    );
  }
}

function initializeSocket(ioInstance) {
  io = ioInstance;

  // Feature flag: enable spectating for all users (spectators isolated)
  const SPECTATING_ENABLED = true;

  // Inicializa o GameManager com io e gameRooms para evitar erros de dependência circular
  initializeManager(io, gameRooms);

  io.on("connection", (socket) => {
    socket.on("enterLobby", (user) => {
      if (user) socket.userData = user;
      // send immediate lobby snapshot to this socket (non-batched)
      try {
        socket.emit("updateLobby", getLobbyInfo());
      } catch (e) {}
    });

    // Lightweight ping/pong for client RTT measurement
    socket.on("pingCheck", (clientTs) => {
      try {
        // Echo back the same timestamp so client can compute RTT
        socket.emit("pongCheck", clientTs);
      } catch (e) {}
    });

    // Client telemetry: optionally receive client latency report
    socket.on("clientTelemetry", (payload) => {
      try {
        // store last known RTT for diagnostics (not persisted)
        if (!socket.userData) socket.userData = {};
        socket.userData.lastLatency =
          payload && payload.rtt ? payload.rtt : null;
      } catch (e) {}
    });

    socket.on("joinAsSpectator", ({ roomCode }) => {
      if (!SPECTATING_ENABLED) {
        socket.emit("joinError", {
          message: "Espectadores temporariamente desativados.",
        });
        console.log(
          `[Socket] joinAsSpectator blocked (feature disabled): socket=${socket.id} room=${roomCode}`
        );
        return;
      }
      console.log(
        `[Socket] joinAsSpectator request: socket=${socket.id} user=${
          socket.userData?.email || "unknown"
        } room=${roomCode}`
      );
      const room = gameRooms[roomCode];
      if (!room || room.players.length < 2 || room.isGameConcluded) {
        return socket.emit("joinError", {
          message: "Jogo não disponível para assistir.",
        });
      }

      // Safety: if the requesting socket is already a player in this room,
      // reject the spectator request to avoid client-side UI confusion
      // that could make a player unintentionally disconnect or hide controls.
      if (room.players.some((p) => p.socketId === socket.id)) {
        console.log(
          `[Socket] joinAsSpectator rejected: socket=${socket.id} user=${
            socket.userData?.email || "unknown"
          } is a player in room=${roomCode}`
        );
        return socket.emit("joinError", {
          message: "Você já é jogador desta sala.",
        });
      }

      try {
        // Do NOT join the main player room to avoid spectators receiving
        // every broadcast intended for players. Use a separate spectator room
        // to isolate their traffic and allow throttling.
        const specRoom = `${roomCode}-spectators`;
        socket.join(specRoom);
        console.log(
          `[Socket] joinAsSpectator: socket=${socket.id} user=${
            socket.userData?.email || "unknown"
          } joined specRoom=${specRoom}`
        );
      } catch (e) {
        console.error(
          `[Socket] joinAsSpectator: socket.join failed for ${socket.id} room=${roomCode}`,
          e
        );
        return socket.emit("joinError", {
          message: "Erro ao entrar como espectador.",
        });
      }

      // Track spectators per room
      if (!room.spectators) room.spectators = new Set();
      if (!room.spectators.has(socket.id)) room.spectators.add(socket.id);

      const gameState = {
        ...room.game,
        roomCode: room.roomCode,
        // Avoid heavy synchronous computation for spectators to prevent
        // event-loop blocking under load. Mandatory pieces are optional
        // for spectators and can be computed asynchronously later if needed.
        mandatoryPieces: [],
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

      // Defer emissions to next tick to avoid blocking the main flow
      setImmediate(() => {
        try {
          // If there was a pending revanche request, notify requesters that
          // their request was declined because someone chose to spectate.
          // IMPORTANT: do NOT delete the room or clear critical timers here;
          // spectators must never interfere with the players' connection or
          // lifecycle. We simply inform requesters and clear the request list.
          if (room.revancheRequests && room.revancheRequests.size > 0) {
            try {
              for (const email of Array.from(room.revancheRequests)) {
                const p = room.players.find((pl) => pl.user.email === email);
                if (p && p.socketId) {
                  io.to(p.socketId).emit("revancheDeclined", {
                    message:
                      "Seu pedido de revanche foi recusado porque houve um espectador na sala.",
                  });
                }
              }
            } catch (innerErr) {
              console.error("Error notifying revanche requesters:", innerErr);
            }

            // Clear the revanche requests set to avoid further conflicts
            try {
              room.revancheRequests = new Set();
            } catch (sErr) {
              console.warn("Error clearing revancheRequests set:", sErr);
            }
            // Continue with spectator join; do not alter room timers or delete room.
          }

          socket.emit("spectatorJoined", {
            gameState,
            ...timeData,
            timeControl: room.timeControl,
            isSpectator: true,
            spectatorCount: room.spectators ? room.spectators.size : 0,
          });

          // Notify players (in the main room) about updated spectator count
          // and also notify spectators room so spectator UIs update consistently.
          const specRoomName = `${roomCode}-spectators`;
          io.to(roomCode).volatile.emit("spectatorCount", {
            count: room.spectators ? room.spectators.size : 0,
          });
          io.to(specRoomName).volatile.emit("spectatorCount", {
            count: room.spectators ? room.spectators.size : 0,
          });

          console.log(
            `[Socket] spectatorJoined: socket=${socket.id} user=${
              socket.userData?.email || "unknown"
            } room=${roomCode} count=${
              room.spectators ? room.spectators.size : 0
            }`
          );
        } catch (e) {
          console.error(
            `[Socket] Error emitting spectator events for room=${roomCode}`,
            e
          );
        }
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
      console.log(
        `[Socket] createRoom: socket=${socket.id} user=${
          socket.userData?.email || "unknown"
        } created room=${roomCode}`
      );

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
      scheduleLobbyUpdate();
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

      // Notifica imediatamente o criador que o entrante clicou em 'Aceitar'
      try {
        const creatorSocket = room.players[0] && room.players[0].socketId;
        if (creatorSocket && creatorSocket !== socket.id) {
          io.to(creatorSocket).emit("opponentClickedAccept", {
            email: data.user.email,
            roomCode,
          });
        }
      } catch (e) {
        console.error("Erro emitindo opponentClickedAccept:", e);
      }

      const creatorEmail = room.players[0].user.email;
      const joinerEmail = socket.userData.email;
      const bet = room.bet;

      // Segurança adicional: garante que o criador ainda esteja conectado
      try {
        const creatorSocketId = room.players[0] && room.players[0].socketId;
        const creatorSockObj = creatorSocketId
          ? io.sockets.sockets.get(creatorSocketId)
          : null;
        if (!creatorSockObj || !creatorSockObj.connected) {
          // Criador ausente - remove a sala imediatamente para evitar cobranças indevidas
          try {
            delete gameRooms[roomCode];
          } catch (e) {}
          scheduleLobbyUpdate();
          socket.emit("joinError", {
            message: "Criador ausente. Sala removida.",
          });
          return;
        }
      } catch (e) {}

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
        try {
          console.log(
            `[${new Date().toISOString()}] [acceptBet] Removendo room ${roomCode} (creator insufficient) totalBefore=${
              Object.keys(gameRooms).length
            }`
          );
        } catch (e) {}
        delete gameRooms[roomCode];
        scheduleLobbyUpdate();
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
        // Notifica o criador que a aceitação falhou
        try {
          const creatorSocket = room.players[0] && room.players[0].socketId;
          if (creatorSocket && creatorSocket !== socket.id) {
            io.to(creatorSocket).emit("opponentAcceptFailed", {
              email: joinerEmail,
              reason: "Saldo insuficiente",
            });
          }
        } catch (e) {}
        return;
      }

      if (room.disconnectTimeout) {
        clearTimeout(room.disconnectTimeout);
        room.disconnectTimeout = null;
      }
      socket.join(roomCode);
      console.log(
        `[Socket] acceptBet: socket=${socket.id} user=${
          socket.userData?.email || "unknown"
        } joined room=${roomCode}`
      );
      room.players.push({ socketId: socket.id, user: socket.userData });

      // Notifica o criador da sala que um oponente entrou (para tocar som no cliente)
      try {
        const creatorSocket = room.players[0] && room.players[0].socketId;
        if (creatorSocket && creatorSocket !== socket.id) {
          io.to(creatorSocket).emit("playerJoined", {
            email: socket.userData.email,
          });

          // Emite evento indicando que a partida está prestes a iniciar
          // (útil para tocar alerta sonoro mesmo quando a aba não está em foco)
          try {
            io.to(creatorSocket).emit("gameAboutToStart", {
              roomCode: roomCode,
              opponent: socket.userData.email,
            });
          } catch (e) {
            console.error("Erro emitindo gameAboutToStart:", e);
          }
        }
      } catch (e) {
        console.error("Erro emitindo playerJoined:", e);
      }

      await startGameLogic(room);
      scheduleLobbyUpdate();
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

      try {
        room.seq = room.seq || 0;
        // assegura que o game enviado contenha a sequência atual
        const gameCopy = Object.assign({}, room.game, { seq: room.seq });
        socket.emit("gameResumed", {
          gameState: gameCopy,
          ...timeData,
        });
      } catch (e) {
        socket.emit("gameResumed", {
          gameState: room.game,
          ...timeData,
        });
      }
    });

    socket.on("cancelRoom", (data) => {
      const { roomCode } = data;
      const room = gameRooms[roomCode];
      if (
        room &&
        room.players.length === 1 &&
        room.players[0].socketId === socket.id
      ) {
        try {
          console.log(
            `[${new Date().toISOString()}] [cancelRoom] Removendo room ${roomCode} requested by creator totalBefore=${
              Object.keys(gameRooms).length
            }`
          );
        } catch (e) {}
        delete gameRooms[roomCode];
        socket.emit("roomCancelled");
        scheduleLobbyUpdate();
      }
    });

    socket.on("playerMove", async (moveData) => {
      try {
        // Atualiza socketId do jogador na sala caso ele tenha reconectado
        const room = gameRooms[moveData.room];
        if (room && room.players && socket.userData && socket.userData.email) {
          const player = room.players.find(
            (p) => p.user && p.user.email === socket.userData.email
          );
          if (player) player.socketId = socket.id;
        }
      } catch (e) {
        console.warn("playerMove: erro ao atualizar socketId do jogador", e);
      }
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
        captures.forEach((seq) => {
          for (let i = 1; i < seq.length; i++) validMoves.push(seq[i]);
        });
        return socket.emit("showValidMoves", validMoves);
      }

      const bestCaptures = findBestCaptureMoves(game.currentPlayer, game);
      if (bestCaptures.length > 0) {
        const capturesForThis = bestCaptures.filter(
          (seq) => seq[0].row === row && seq[0].col === col
        );
        capturesForThis.forEach((seq) => {
          for (let i = 1; i < seq.length; i++) validMoves.push(seq[i]);
        });
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
          console.log(
            `[Socket] rejoinActiveGame: socket=${socket.id} user=${
              socket.userData?.email || "unknown"
            } rejoined room=${roomCode}`
          );
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
        // If a creator/player rejoins and there was a scheduled cleanup for private room, cancel it
        if (room.cleanupTimeout) {
          clearTimeout(room.cleanupTimeout);
          room.cleanupTimeout = null;
        }
        if (room.game && room.game.users) {
          if (room.game.users.white === user.email) {
            room.game.players.white = socket.id;
          } else if (room.game.users.black === user.email) {
            room.game.players.black = socket.id;
          }
        }
        socket.join(roomCode);

        // Se houver um timeout de inatividade de turno pendente (possivelmente
        // criado antes da reconexão), limpe-o para evitar que seja disparado
        // contra um socketId antigo. Em seguida, reagendamos a verificação
        // de inatividade com os dados atualizados.
        try {
          if (room.turnInactivityTimeout) {
            clearTimeout(room.turnInactivityTimeout);
            room.turnInactivityTimeout = null;
            console.log(
              `[Socket] rejoinActiveGame: cleared stale turnInactivityTimeout for room=${roomCode} socket=${socket.id}`
            );
          }
        } catch (e) {}

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
          // include spectator count so players get current number immediately
          gameResumedPayload.spectatorCount = room.spectators
            ? room.spectators.size
            : 0;
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
          // Reagenda verificação de inatividade com os dados atualizados
          try {
            scheduleTurnInactivity(roomCode);
          } catch (e) {}
        }
      }
    });

    socket.on("disconnect", (reason) => {
      const WAIT_TIME = 60;

      // First, check if this socket was a spectator in any room. Prioritize
      // spectator removal to avoid mis-classifying spectator disconnects
      // as player disconnects (which would notify opponents).
      const specRoomCode = Object.keys(gameRooms).find(
        (rc) =>
          gameRooms[rc].spectators && gameRooms[rc].spectators.has(socket.id)
      );
      if (specRoomCode) {
        const room = gameRooms[specRoomCode];
        try {
          room.spectators.delete(socket.id);
          // Notify players and remaining spectators
          const specRoomName = `${specRoomCode}-spectators`;
          io.to(specRoomCode).volatile.emit("spectatorCount", {
            count: room.spectators ? room.spectators.size : 0,
          });
          io.to(specRoomName).volatile.emit("spectatorCount", {
            count: room.spectators ? room.spectators.size : 0,
          });
        } catch (e) {
          console.warn("Error removing spectator on disconnect:", e);
        }
        try {
          socket.leave(`${specRoomCode}-spectators`);
        } catch (e) {}
        // Spectator removal complete — do not proceed to player disconnect logic
        return;
      }

      // If not a spectator, try to find if it's a player socket.
      let roomCode = Object.keys(gameRooms).find((rc) =>
        gameRooms[rc].players.some((p) => p.socketId === socket.id)
      );

      if (!roomCode) {
        console.log(
          `[Socket] disconnect: no room found for socket ${
            socket.id
          } reason=${reason} user=${
            socket.userData?.email || "unknown"
          } totalRooms=${Object.keys(gameRooms).length}`
        );
        return;
      }
      const room = gameRooms[roomCode];
      console.log(
        `[Socket] disconnect: socket=${socket.id} user=${
          socket.userData?.email || "unknown"
        } room=${roomCode} reason=${reason}`
      );

      if (room && !room.isGameConcluded && room.players.length === 2) {
        const opponent = room.players.find((p) => p.socketId !== socket.id);
        if (opponent) {
          if (room.timerInterval) clearInterval(room.timerInterval);

          // Notify opponent that their adversary disconnected and should return
          // within WAIT_TIME seconds. This tells the remaining player to wait
          // without closing the game.
          try {
            io.to(opponent.socketId).emit("opponentConnectionLost", {
              waitTime: WAIT_TIME,
            });
            console.log(
              `[Socket] Notified opponent ${opponent.socketId} of disconnect, starting ${WAIT_TIME}s timeout for room ${roomCode}`
            );
          } catch (e) {
            console.error(
              `[Socket] Error emitting opponentConnectionLost to ${opponent.socketId}`,
              e
            );
          }
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
            // Immediately remove room after declaring victory due to disconnect
            try {
              if (gameRooms[roomCode]) {
                delete gameRooms[roomCode];
                scheduleLobbyUpdate();
              }
            } catch (e) {
              console.error("Error removing room after disconnect end:", e);
            }
          }, WAIT_TIME * 1000);
        }
      } else if (room && room.players.length === 1 && !room.isGameConcluded) {
        // For private rooms, do not delete immediately — schedule a delayed cleanup
        if (room.isPrivate) {
          try {
            if (room.cleanupTimeout) clearTimeout(room.cleanupTimeout);
            // keep private room available for 30 minutes for sharing the code
            room.cleanupTimeout = setTimeout(() => {
              try {
                try {
                  console.log(
                    `[${new Date().toISOString()}] [privateCleanup] Removendo private room ${roomCode} totalBefore=${
                      Object.keys(gameRooms).length
                    }`
                  );
                } catch (e) {}
                delete gameRooms[roomCode];
                scheduleLobbyUpdate();
              } catch (e) {
                console.error("Error cleaning up private room:", e);
              }
            }, 30 * 60 * 1000);
            // notify lobby so UI shows private room still available (optional)
            scheduleLobbyUpdate();
          } catch (e) {
            console.error("Error scheduling cleanup for private room:", e);
          }
        } else {
          // Evita deletar imediatamente salas ativas quando um jogador desconecta
          // (p.ex. reconexão rápida pode trocar socket.id). Agendamos limpeza
          // para 60 segundos — o mesmo tempo de espera usado para desconexões.
          try {
            if (room.cleanupTimeout) clearTimeout(room.cleanupTimeout);
            room.cleanupTimeout = setTimeout(() => {
              try {
                if (gameRooms[roomCode]) {
                  delete gameRooms[roomCode];
                  scheduleLobbyUpdate();
                  console.log(
                    `[Socket] cleanup: removed room ${roomCode} after idle timeout`
                  );
                }
              } catch (e) {
                console.error("Error cleaning up room after disconnect:", e);
              }
            }, WAIT_TIME * 1000);
            // Notifica lobby que há mudança (mostra sala como aguardando/ausente)
            scheduleLobbyUpdate();
          } catch (e) {
            console.error(
              "Error scheduling cleanup for room after disconnect:",
              e
            );
          }
        }
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
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
      }

      // Notify both players that the timer is paused and send current time state
      const timeData =
        room.timeControl === "match"
          ? { whiteTime: room.whiteTime, blackTime: room.blackTime }
          : { timeLeft: room.timeLeft };
      io.to(roomCode).emit("timerPaused");
      io.to(roomCode).emit("timerUpdate", {
        ...timeData,
        roomCode,
        timerActive: false,
        // include currentPlayer if available
        currentPlayer: room.game && room.game.currentPlayer,
      });

      const opponent = room.players.find((p) => p.socketId !== socket.id);
      if (opponent) io.to(opponent.socketId).emit("drawRequested");
      socket.emit("drawRequestSent");
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
    socket.on("acceptDraw", (data) => {
      const { roomCode } = data;
      const room = gameRooms[roomCode];
      if (!room || !room.drawOfferBy) return;
      // Only the other player may accept
      if (room.drawOfferBy === socket.id) return;
      try {
        room.drawOfferBy = null;
        // Declare draw
        processEndOfGame(
          null,
          null,
          room,
          "Empate por acordo entre jogadores."
        );
        // ensure room is cleaned up in case processEndOfGame didn't delete it
        if (gameRooms[roomCode] && gameRooms[roomCode].isGameConcluded) {
          try {
            // Em vez de remover imediatamente, agendamos limpeza em 10s
            // para evitar races com eventos de disconnect/rejoin do cliente.
            const rm = gameRooms[roomCode];
            try {
              console.log(
                `[${new Date().toISOString()}] [acceptDraw] Agendando limpeza de room ${roomCode} em 10s totalBefore=${
                  Object.keys(gameRooms).length
                }`
              );
            } catch (e) {}
            if (rm) {
              if (rm.cleanupTimeout) clearTimeout(rm.cleanupTimeout);
              rm.cleanupTimeout = setTimeout(() => {
                try {
                  if (gameRooms[roomCode]) {
                    // Apenas remove se a sala ainda estiver concluída (não foi reiniciada)
                    if (gameRooms[roomCode].isGameConcluded) {
                      delete gameRooms[roomCode];
                      scheduleLobbyUpdate();
                      console.log(
                        `[${new Date().toISOString()}] [acceptDraw] Removido room ${roomCode} após agendamento`
                      );
                    } else {
                      console.log(
                        `[${new Date().toISOString()}] [acceptDraw] Skip removal for room ${roomCode} because isGameConcluded=${
                          gameRooms[roomCode].isGameConcluded
                        }`
                      );
                    }
                  }
                } catch (e) {
                  console.error(
                    "Error removing room after scheduled acceptDraw cleanup:",
                    e
                  );
                }
              }, 10 * 1000);
            }
          } catch (e) {
            console.error("Error scheduling removal after draw accepted:", e);
          }
        }
      } catch (e) {
        console.error("Error handling acceptDraw:", e);
      }
    });
    socket.on("requestRevanche", async ({ roomCode }) => {
      const room = gameRooms[roomCode];
      if (!room || !room.isGameConcluded) return;

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return;

      if (!room.revancheRequests) room.revancheRequests = new Set();
      // Usa Email em vez de Socket ID para persistência entre reconexões
      room.revancheRequests.add(player.user.email);

      if (room.players.length === 2) {
        const p1Email = room.players[0].user.email;
        const p2Email = room.players[1].user.email;
        if (
          room.revancheRequests.has(p1Email) &&
          room.revancheRequests.has(p2Email)
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
              try {
                console.log(
                  `[${new Date().toISOString()}] [revanche] Removendo room ${
                    room.roomCode
                  } (p1 insufficient) totalBefore=${
                    Object.keys(gameRooms).length
                  }`
                );
              } catch (e) {}
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
              try {
                console.log(
                  `[${new Date().toISOString()}] [revanche] Removendo room ${
                    room.roomCode
                  } (p2 insufficient) totalBefore=${
                    Object.keys(gameRooms).length
                  }`
                );
              } catch (e) {}
              delete gameRooms[room.roomCode];
              return;
            }

            // Avisa clientes que a revanche foi aceita (para eles cancelarem timers UI)
            try {
              if (player1.socketId)
                io.to(player1.socketId).emit("revancheAccepted");
              if (player2.socketId)
                io.to(player2.socketId).emit("revancheAccepted");
            } catch (e) {
              console.error("Erro emitindo revancheAccepted:", e);
            }

            // Limpa pedidos pendentes para evitar races com spectate/limpeza
            try {
              room.revancheRequests = new Set();
            } catch (e) {}

            // FIX: Reset match state for Tablita to force new opening on rematch
            if (room.gameMode === "tablita") {
              room.match = null;
            }

            // Allow starting a new game: clear concluded flag and pending cleanup/timeouts
            try {
              room.isGameConcluded = false;
              room._noFurtherGames = false;
              // clear any scheduled cleanup that would delete the room
              if (room.cleanupTimeout) {
                clearTimeout(room.cleanupTimeout);
                room.cleanupTimeout = null;
              }
              // clear any leftover timers to avoid interference
              try {
                if (room.timerInterval) clearInterval(room.timerInterval);
              } catch (e) {}
              try {
                if (room.turnInactivityTimeout)
                  clearTimeout(room.turnInactivityTimeout);
                room.turnInactivityTimeout = null;
              } catch (e) {}
              try {
                if (room.firstMoveTimeout) clearTimeout(room.firstMoveTimeout);
                room.firstMoveTimeout = null;
              } catch (e) {}
            } catch (e) {}

            await startGameLogic(room);
          } catch (err) {
            console.error(err);
            io.to(room.roomCode).emit("revancheDeclined", {
              message: "Erro ao processar a aposta da revanche.",
            });
            try {
              console.log(
                `[${new Date().toISOString()}] [revanche] Removendo room ${
                  room.roomCode
                } (error) totalBefore=${Object.keys(gameRooms).length}`
              );
            } catch (e) {}
            delete gameRooms[room.roomCode];
          }
        }
      }
    });
    socket.on("leaveEndGameScreen", ({ roomCode }) => {
      const room = gameRooms[roomCode];
      // Proteção CRÍTICA: Só processa saída se o jogo REALMENTE estiver concluído.
      // Isso evita que o timeout de 5s da revanche mate um jogo que acabou de começar.
      if (!room || !room.isGameConcluded) return;

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
          try {
            console.log(
              `[${new Date().toISOString()}] [leaveEndGameScreen] Removendo room ${roomCode} (empty after leave) totalBefore=${
                Object.keys(gameRooms).length
              }`
            );
          } catch (e) {}
          delete gameRooms[roomCode];
        }
      } else {
        // If non-player leaving (likely spectator), remove from spectators set
        if (room.spectators && room.spectators.has(socket.id)) {
          room.spectators.delete(socket.id);
          const specRoomName = `${roomCode}-spectators`;
          io.to(roomCode).volatile.emit("spectatorCount", {
            count: room.spectators ? room.spectators.size : 0,
          });
          io.to(specRoomName).volatile.emit("spectatorCount", {
            count: room.spectators ? room.spectators.size : 0,
          });
        }
        socket.leave(`${roomCode}-spectators`);
      }

      // If still not found, try to locate by user email (handles races where socketId changed)
      if (!roomCode && socket.userData && socket.userData.email) {
        try {
          const email = socket.userData.email;
          roomCode = Object.keys(gameRooms).find((rc) =>
            gameRooms[rc].players.some((p) => p.user && p.user.email === email)
          );
          if (roomCode) {
            console.log(
              `[Socket] disconnect: located room by email for socket=${socket.id} email=${email} room=${roomCode}`
            );
          }
        } catch (e) {
          console.error("Error finding room by email on disconnect:", e);
        }
      }
    });
  });
}

module.exports = {
  initializeSocket,
  gameRooms,
  startNextTablitaGame,
  startGameLogic,
};
