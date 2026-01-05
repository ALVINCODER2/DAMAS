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

// ============================================================================
// CONFIGURAÇÕES OTIMIZADAS PARA REDUÇÃO DE LATÊNCIA
// ============================================================================
// Estas configurações foram ajustadas para reduzir o tráfego Socket.IO
// mantendo a funcionalidade completa do jogo.

// Throttling/Debouncing (ms)
const SPECTATOR_UPDATE_INTERVAL = 1000; // Espectadores: 1000ms (era 350ms)
const LOBBY_UPDATE_DEBOUNCE = 2000; // Lobby: 2000ms (era 300ms)

// Latency thresholds (ms)
const LATENCY_WARNING_MS = 1000; // apenas aviso
const LATENCY_PAUSE_MS = 200; // pausar partida quando alcançado
const LATENCY_RESUME_MS = 150; // retomar quando abaixo deste valor

// ============================================================================

// Monitor simples do event-loop: loga se o loop ficar bloqueado além de um limiar.
try {
  const LAG_THRESHOLD_MS = 200; // warn se o loop atrasar mais que isso
  let _lastTick = Date.now();
  setInterval(() => {
    try {
      const now = Date.now();
      const drift = now - _lastTick - 500;
      _lastTick = now;
      if (drift > LAG_THRESHOLD_MS) {
        try {
          console.warn(
            `[EVENT_LOOP_LAG] drift=${drift}ms at ${new Date().toISOString()}`
          );
        } catch (e) {}
      }
    } catch (e) {}
  }, 500).unref();
} catch (e) {}

// Wrappers temporizados para funções de lógica que podem ser pesadas.
const _TIMING_WARN_MS =
  typeof process.env.LOG_SLOW_THRESHOLD_MS === "number"
    ? process.env.LOG_SLOW_THRESHOLD_MS
    : 30;
function timedFindBestCaptureMoves(playerColor, game, ctx) {
  const s = Date.now();
  try {
    return findBestCaptureMoves(playerColor, game);
  } finally {
    const dt = Date.now() - s;
    if (dt > _TIMING_WARN_MS) {
      try {
        console.warn(
          `[SLOW] findBestCaptureMoves dt=${dt}ms room=${
            ctx || (game && game.roomCode) || "unknown"
          }`
        );
      } catch (e) {}
    }
  }
}

function timedGetAllPossibleCapturesForPiece(row, col, game, ctx) {
  const s = Date.now();
  try {
    return getAllPossibleCapturesForPiece(row, col, game);
  } finally {
    const dt = Date.now() - s;
    if (dt > _TIMING_WARN_MS) {
      try {
        console.warn(
          `[SLOW] getAllPossibleCapturesForPiece dt=${dt}ms room=${
            ctx || (game && game.roomCode) || "unknown"
          }`
        );
      } catch (e) {}
    }
  }
}

function timedHasValidMoves(playerColor, game, ctx) {
  const s = Date.now();
  try {
    return hasValidMoves(playerColor, game);
  } finally {
    const dt = Date.now() - s;
    if (dt > _TIMING_WARN_MS) {
      try {
        console.warn(
          `[SLOW] hasValidMoves dt=${dt}ms room=${
            ctx || (game && game.roomCode) || "unknown"
          }`
        );
      } catch (e) {}
    }
  }
}

function timedIsMoveValid(
  from,
  to,
  playerColor,
  game,
  ignoreMajorityRule,
  ctx
) {
  const s = Date.now();
  try {
    return isMoveValid(from, to, playerColor, game, ignoreMajorityRule);
  } finally {
    const dt = Date.now() - s;
    if (dt > _TIMING_WARN_MS) {
      try {
        console.warn(
          `[SLOW] isMoveValid dt=${dt}ms room=${
            ctx || (game && game.roomCode) || "unknown"
          }`
        );
      } catch (e) {}
    }
  }
}

// Filtro de logs: suprime mensagens de depuração verbosas em produção.
// Para habilitar novamente, defina a variável de ambiente `VERBOSE_LOGS=true`.
try {
  const VERBOSE = process.env.VERBOSE_LOGS === "true";
  if (!VERBOSE) {
    const _log = console.log.bind(console);
    const _info = console.info.bind(console);
    const _warn = console.warn.bind(console);
    const _error = console.error.bind(console);
    const FILTER_TOKENS = [
      "[Socket]",
      "[DEBUG",
      "[Novo Jogo]",
      "[gameStart Debug]",
      "[InvalidMove Debug]",
      "[GameWatchdog]",
      "[scheduleTurnInactivity]",
      "[cleanup]",
      "[acceptBet]",
    ];

    function shouldFilter(args) {
      try {
        for (const a of args) {
          if (typeof a !== "string") continue;
          for (const t of FILTER_TOKENS) if (a.includes(t)) return true;
        }
      } catch (e) {}
      return false;
    }

    console.log = function (...args) {
      if (shouldFilter(args)) return;
      return _log(...args);
    };
    console.info = function (...args) {
      if (shouldFilter(args)) return;
      return _info(...args);
    };
    console.warn = function (...args) {
      if (shouldFilter(args)) return;
      return _warn(...args);
    };
    console.error = function (...args) {
      if (shouldFilter(args)) return;
      return _error(...args);
    };
  }
} catch (e) {}

// Debounced/Throttled lobby update to avoid emitting too frequentemente
let _lobbyUpdateTimer = null;
let _lastLobbyPayload = null;
function scheduleLobbyUpdate(force) {
  try {
    const processStartTs = Date.now();
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
    }, 2000); // debounce 2000ms (otimizado para reduzir latência)
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
      let baseMs = 10 * 1000;
      // Se o jogo acabou de iniciar (primeiro lance ainda não ocorreu),
      // aplicamos regra específica para torneios: passagem rápida de vez.
      // Em torneios, se o jogador não der o primeiro lance em 20s, passa-se a vez.
      if (r.game && r.game.isFirstMove) {
        if (r.isTournament) {
          baseMs = 20 * 1000; // 20s para primeiro lance em torneio
        } else {
          baseMs = Math.max(10 * 1000, 60 * 1000); // 60s de graça no primeiro lance para não-torneios
        }
      } else if (r.timeControl === "match") {
        // Usa tempo restante do jogador atual (whiteTime / blackTime)
        const cp = r.game && r.game.currentPlayer;
        const rem = cp === "b" ? r.whiteTime : r.blackTime;
        baseMs = Math.max(1, typeof rem === "number" ? rem : 10) * 1000;
      } else if (r.timeControl === "move") {
        // Usa timerDuration (segundos por jogada) caso exista
        const dur =
          typeof r.timerDuration === "number"
            ? r.timerDuration
            : r.timeLeft || 10;
        baseMs = Math.max(1, dur) * 1000;
      } else if (r.game && r.game.timerActive) {
        if (typeof r.timeLeft === "number")
          baseMs = Math.max(1, r.timeLeft) * 1000;
        else {
          const cp2 = r.game.currentPlayer;
          const rem2 = cp2 === "b" ? r.whiteTime : r.blackTime;
          if (typeof rem2 === "number") baseMs = Math.max(1, rem2) * 1000;
        }
      }

      // Ajuste dinâmico baseado em latência do jogador atual (se disponível).
      try {
        const cp = r.game && r.game.currentPlayer;
        const currentSocketId =
          cp === "b" ? r.game.players.white : r.game.players.black;
        const sock = currentSocketId
          ? io.sockets.sockets.get(currentSocketId)
          : null;
        const lastLatency =
          sock && sock.userData && typeof sock.userData.lastLatency === "number"
            ? sock.userData.lastLatency
            : 0;
        if (lastLatency && lastLatency > 200) {
          // Aumenta o timeout linearmente com o RTT (até um limite razoável)
          const extra = Math.min(15000, Math.ceil(lastLatency / 500) * 1000); // até +15s
          baseMs = Math.max(baseMs, baseMs + extra);
        }
      } catch (e) {}

      return baseMs;
    } catch (e) {}
    // fallback padrão 10s
    return 10 * 1000;
  }

  const initialDuration = getDurationForRoom(room);
  // Pequena tolerância para torneios: suaviza perda por tempo devido a ping.
  try {
    if (room && room.isTournament) initialDuration += 500; // +500ms de tolerância
  } catch (e) {}
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
      if (!isPresent) {
        // Se o jogo tem timer ativo (modo com limite por jogada/partida),
        // a inatividade deve resultar em perda por tempo — não apenas passar a vez.
        if (
          r.timeControl === "move" ||
          (r.game && r.game.timerActive && r.timeControl !== "match")
        ) {
          if (r.timerInterval) {
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
        const bestCaptures = timedFindBestCaptureMoves(
          r.game.currentPlayer,
          r.game,
          r.roomCode
        );
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
          const bestCaptures = timedFindBestCaptureMoves(
            game.currentPlayer,
            game,
            roomCode
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

    // Envia para os jogadores: por padrão um payload reduzido (para economizar
    // banda). Se o chamador explicitamente passar `opts.fullForPlayers = true`
    // então enviaremos o `fullState`.
    if (room.players && room.players.length > 0) {
      for (const p of room.players) {
        try {
          if (!p || !p.socketId) continue;
          if (opts.fullForPlayers) {
            io.to(p.socketId).emit("gameStateUpdate", fullState);
            continue;
          }

          // Payload enxuto para players — inclui tudo o necessário para
          // atualizar o tabuleiro e timers sem enviar campos extras.
          const playerPayload = {
            boardState: fullState.boardState,
            boardSize: fullState.boardSize,
            currentPlayer: fullState.currentPlayer || fullState.turn || null,
            lastMove: fullState.lastMove || null,
            mandatoryPieces: fullState.mandatoryPieces || null,
            seq: typeof fullState.seq === "number" ? fullState.seq : undefined,
            timerActive: !!fullState.timerActive,
            whiteTime:
              typeof fullState.whiteTime === "number"
                ? fullState.whiteTime
                : null,
            blackTime:
              typeof fullState.blackTime === "number"
                ? fullState.blackTime
                : null,
            timeLeft:
              typeof fullState.timeLeft === "number"
                ? fullState.timeLeft
                : null,
            team: p && p.user ? p.user.team || null : null,
            users: fullState.users || null,
          };
          io.to(p.socketId).emit("gameStateUpdate", playerPayload);
        } catch (e) {}
      }
    }

    // Throttle para espectadores: no máximo uma emissão a cada INTERVAL ms
    const INTERVAL =
      typeof opts.spectatorInterval === "number" ? opts.spectatorInterval : 1000; // otimizado: 1000ms (era 350ms)
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
        // incluir users para que espectadores também recebam badges/teams
        users: fullState.users || null,
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
                gameMode: room.gameMode,
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
    // Revanche: determina cores por email (sem debug log)
    // Usa email dos usuários para detectar quem foi branco anteriormente.
    try {
      const previousWhiteEmail = room.game.users && room.game.users.white;
      const p1Email = player1.user && player1.user.email;
      if (previousWhiteEmail && p1Email && previousWhiteEmail === p1Email) {
        // player1 foi branco antes -> invertemos as cores
        whitePlayer = player2;
        blackPlayer = player1;
      } else {
        whitePlayer = player1;
        blackPlayer = player2;
      }
    } catch (e) {
      // fallback para comportamento original em caso de erro
      console.error("Erro determinando cores por email:", e);
      const previousWhiteSocketId = room.game.players.white;
      if (player1.socketId === previousWhiteSocketId) {
        whitePlayer = player2;
        blackPlayer = player1;
      } else {
        whitePlayer = player1;
        blackPlayer = player2;
      }
    }
  } else {
    // Atribui cores aleatoriamente (sem log)
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
      // team fields para uso no frontend
      whiteTeam: (whitePlayer.user && whitePlayer.user.team) || null,
      blackTeam: (blackPlayer.user && blackPlayer.user.team) || null,
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

  if (!timedHasValidMoves(room.game.currentPlayer, room.game, room.roomCode)) {
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

  const bestCaptures = timedFindBestCaptureMoves(
    room.game.currentPlayer,
    room.game,
    room.roomCode
  );
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
  try {
    // Log diagnóstico para Tablita: mostra mandatoryPieces e estado do match
    const dbgMandatory = mandatoryPieces || [];
    console.info(
      `[gameStart Debug] room=${room.roomCode} mode=${
        room.gameMode
      } isTablita=${!!room.isTablita} currentGame=${
        room.match && room.match.currentGame
      } mandatoryCount=${dbgMandatory.length}`
    );
  } catch (e) {}
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
    // Ajusta duração do watchdog para o primeiro lance: torneio=20s, não-torneio=60s
    const firstMoveDuration = room.isTournament ? 20 * 1000 : 60 * 1000;
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
            `[GameWatchdog] No moves in firstMoveTimeout for room ${room.roomCode}. duration=${firstMoveDuration}ms moveHistoryLen=${g.moveHistory.length}`
          );

          // Log adicional para diagnóstico do motivo do reembolso
          try {
            console.warn(
              "[GameWatchdog Debug] room=",
              room.roomCode,
              "isTablita=",
              !!currentRoom.isTablita,
              "match=",
              currentRoom.match
            );
            console.warn(
              "[GameWatchdog Debug] game.isFirstMove=",
              g.isFirstMove,
              "mustCaptureWith=",
              g.mustCaptureWith,
              "turnCapturedPieces=",
              g.turnCapturedPieces
            );
          } catch (dbg) {}

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
  // Debug logs removed for production
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

  let socketPlayerColor = null;
  if (socketId) {
    try {
      const pl = gameRoom.players.find((p) => p.socketId === socketId);
      if (pl && game.users) {
        socketPlayerColor = game.users.white === pl.user.email ? "b" : "p";
      } else {
        // Fallback para mapping antigo baseado em game.players
        socketPlayerColor = game.players.white === socketId ? "b" : "p";
      }
    } catch (e) {
      try {
        socketPlayerColor = game.players.white === socketId ? "b" : "p";
      } catch (er) {
        socketPlayerColor = null;
      }
    }
    if (socketPlayerColor && socketPlayerColor !== playerColor) return;
  }

  // Bloqueio de 1s pós-movimento: evita que o jogador responda instantaneamente
  // (previne problemas quando o cliente envia jogadas muito rápidas).
  // (lock de 1s removido)

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
  const isValid = timedIsMoveValid(
    from,
    to,
    playerColor,
    game,
    false,
    roomCode
  );

  // Validação extra de captura obrigatória no servidor:
  try {
    const bestCaps = timedFindBestCaptureMoves(
      game.currentPlayer,
      game,
      roomCode
    );
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
      const nextCaptures = timedGetAllPossibleCapturesForPiece(
        to.row,
        to.col,
        game,
        roomCode
      );
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
      
      // REMOVIDO: Verificação de turnValidation que causava indicadores incorretos
      // Os indicadores devem aparecer apenas quando o jogador clica na peça,
      // não automaticamente ao trocar de turno.
      /*
      // Verificação rápida: notifica jogador novo com amostra de movimentos válidos
      try {
        const targetColor = game.currentPlayer;
        // tenta resolver socketId a partir de emails mapeados em game.users
        let targetSocketId = null;
        try {
          if (game.users && game.users.white && game.users.black) {
            const targetEmail =
              targetColor === "b" ? game.users.white : game.users.black;
            if (targetEmail) {
              const pl = gameRoom.players.find(
                (p) => p.user && p.user.email === targetEmail
              );
              if (pl) targetSocketId = pl.socketId;
            }
          }
        } catch (e) {}
        // fallback para mapping antigo
        if (!targetSocketId) {
          try {
            targetSocketId =
              targetColor === "b" ? game.players.white : game.players.black;
          } catch (e) {}
        }

        // Computa amostra de movimentos válidos (limitado para não travar)
        const sampleMoves = [];
        try {
          const bs = game.boardState || [];
          const size = game.boardSize || 8;
          for (let r = 0; r < size && sampleMoves.length < 12; r++) {
            for (let c = 0; c < size && sampleMoves.length < 12; c++) {
              const piece = bs[r] && bs[r][c];
              if (!piece || piece === 0) continue;
              if (String(piece).toLowerCase() !== targetColor) continue;
              for (let tr = 0; tr < size && sampleMoves.length < 12; tr++) {
                for (let tc = 0; tc < size && sampleMoves.length < 12; tc++) {
                  try {
                    const valid = timedIsMoveValid(
                      { row: r, col: c },
                      { row: tr, col: tc },
                      targetColor,
                      game,
                      true,
                      roomCode
                    );
                    if (valid && valid.valid) {
                      sampleMoves.push({
                        from: { row: r, col: c },
                        to: { row: tr, col: tc },
                        isCapture: !!valid.isCapture,
                      });
                    }
                  } catch (e) {}
                }
              }
            }
          }
        } catch (e) {}

        // Emite evento de validação rápida para o socket do jogador
        try {
          if (targetSocketId && io && io.sockets) {
            const sock = io.sockets.sockets.get(targetSocketId);
            const bestCapsQuick = timedFindBestCaptureMoves(
              targetColor,
              game,
              roomCode
            );
            const mandatoryQuick = bestCapsQuick.map((s) => s[0]);
            const hasMovesQuick =
              sampleMoves.length > 0 ||
              (mandatoryQuick && mandatoryQuick.length > 0);
            if (sock && sock.connected) {
              sock.emit("turnValidation", {
                hasValidMoves: !!hasMovesQuick,
                mandatoryPieces: mandatoryQuick,
                sampleMoves,
              });
            }
          }
        } catch (e) {}
      } catch (e) {
        console.error("Erro ao emitir turnValidation:", e);
      }
      */

      // Verifica se o próximo jogador tem movimentos
      if (!timedHasValidMoves(game.currentPlayer, game, roomCode)) {
        const winner = game.currentPlayer === "b" ? "p" : "b";
        return safeProcessEndOfGame(
          winner,
          game.currentPlayer,
          gameRoom,
          "Oponente bloqueado!"
        );
      }
      
      // MODO "MOVE": Resetar timer do próximo jogador após cada movimento
      if (gameRoom.timeControl === "move") {
        // Após o movimento, o próximo jogador deve ter tempo resetado
        const nextPlayer = game.currentPlayer; // Já foi trocado no executeMove
        if (nextPlayer === "b") {
          gameRoom.whiteTime = gameRoom.timerDuration;
        } else {
          gameRoom.blackTime = gameRoom.timerDuration;
        }
        
        // Marca timestamp para pausar por 1.5s
        gameRoom._lastMoveTime = Date.now();
      }
      
      // Garantir que timer está rodando
      if (gameRoom.game && gameRoom.game.timerActive && !gameRoom.timerInterval && !gameRoom._timerPaused) {
        startTimer(roomCode);
      }
      
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
    const bestCaptures = timedFindBestCaptureMoves(
      game.currentPlayer,
      game,
      roomCode
    );
    const mandatoryPieces = canCaptureAgain
      ? [{ row: to.row, col: to.col }]
      : bestCaptures.map((seq) => seq[0]);

    // Incrementa/garante um número de sequência simples para detectar dessincronizações
    try {
      // Se gameRoom.seq não existir, inicia em 0; caso exista, incrementa
      gameRoom.seq =
        typeof gameRoom.seq === "number"
          ? gameRoom.seq + 1
          : (gameRoom.seq = (gameRoom.seq || 0) + 1);
      // Propaga para o game (garantia de consistência)
      game.seq = gameRoom.seq;
    } catch (e) {}

    // Emite apenas o delta do movimento para reduzir payloads (clientes podem animar localmente)
    try {
      // Garante que o payload do delta contenha as posições capturadas
      // ocorridas neste movimento (mesmo que o servidor já tenha removido
      // as peças do tabuleiro ao terminar o turno).
      const seqValue =
        typeof game.seq === "number"
          ? game.seq
          : ((gameRoom.seq = (gameRoom.seq || 0) + 1),
            (game.seq = gameRoom.seq));
      const pieceMovedPayload = {
        lastMove: game.lastMove,
        captured: capturedThisMove.length > 0 ? [...capturedThisMove] : [],
        currentPlayer: game.currentPlayer,
        mandatoryPieces,
        seq: seqValue,
        ts: Date.now(),
        boardSize: game.boardSize,
      };
      io.to(roomCode).emit("pieceMoved", pieceMovedPayload);
      // debug removed
      // Acknowledge to origin socket so client can release local locks
      try {
        if (socketId) {
          const originSock = io.sockets.sockets.get(socketId);
          if (originSock)
            originSock.emit("moveAck", { moveId: moveId, ok: true });
        }
      } catch (ackErr) {
        /* ignore ack errors */
      }
    } catch (e) {
      console.error("Erro emitindo pieceMoved:", e);
    }

    // (lock de 1s removido)

    // CORREÇÃO: Restaurado sendGameState para jogadores (necessário para sincronização)
    // Mantemos payload otimizado e throttling para espectadores.
    // O pieceMoved sozinho não é suficiente - cliente precisa do boardState completo.
    sendGameState(
      roomCode,
      {
        ...game,
        mandatoryPieces,
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
      { forceSpectator: false } // usa throttling normal para espectadores
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
    // Log detalhado para diagnosticar recusas de movimento (Lei da Maioria / Captura obrigatória)
    try {
      const reason = isValid.reason || "Movimento inválido.";
      if (
        reason.includes("Lei da Maioria") ||
        reason.includes("Captura obrigat")
      ) {
        try {
          const best = timedFindBestCaptureMoves(
            game.currentPlayer,
            game,
            roomCode
          );
          console.error(
            "[InvalidMove Debug] room=",
            roomCode,
            "socket=",
            socketId,
            "from=",
            from,
            "to=",
            to
          );
          console.error("[InvalidMove Debug] reason=", reason);
          console.error(
            "[InvalidMove Debug] mustCaptureWith=",
            game.mustCaptureWith
          );
          console.error(
            "[InvalidMove Debug] turnCapturedPieces=",
            game.turnCapturedPieces
          );
          console.error(
            "[InvalidMove Debug] bestCaptures=",
            JSON.stringify(best)
          );
        } catch (dbgErr) {
          console.error(
            "[InvalidMove Debug] failed to compute bestCaptures:",
            dbgErr
          );
        }
      }
    } catch (e) {}

    if (socketId) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit("invalidMove", {
          message: isValid.reason || "Movimento inválido.",
        });
        try {
          // envia ack negativo para que o cliente libere travas locais
          socket.emit("moveAck", { moveId: clientMoveId || null, ok: false });
        } catch (e) {}
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
        // match já decidido; não iniciar próxima partida
        room.isGameConcluded = true;
        room.cleanupTimeout = setTimeout(() => {
      // RELAXAMENTO DA VERIFICAÇÃO DE CONECTIVIDADE
      // Como desabilitamos o sistema de disconnect/W.O., devemos confiar que os jogadores
      // ainda estão na sala e tentar iniciar o jogo. Se realmente não estiverem,
      // perderão por tempo depois.
      
      const p1Email = room.match && room.match.player1 && room.match.player1.email;
      const p2Email = room.match && room.match.player2 && room.match.player2.email;
      
      /*
      // CÓDIGO ANTIGO REMOVIDO: Verificação estrita de sockets conectados
      // Isso estava impedindo o início do Jogo 2 se houvesse micro- desconexões
      /*
      // Resto do código removido...
                },
              });
            } catch (mhErr) {
              console.error("Erro enfileirando MatchHistory:", mhErr);
            }
          } catch (e) {
            console.error("Erro ao encerrar match:", e);
          }
        }
        
        room.isGameConcluded = true;
        return;
      }
      */
      
      console.log(`[Tablita] Validando início do jogo 2 para room=${roomCode}. P1=${p1Email} P2=${p2Email}`);
      
      if (!room.match.player1 || !room.match.player2) {
          console.error(`[Tablita] Jogadores insuficientes na struct match para iniciar jogo 2.`);
          return;
      }
      /* 
       * (Bloco de código morto removido: room._noFurtherGames e cleanupTimeout) 
       */
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
    // HEARTBEAT SYSTEM: Inicializa tracking de ping para detecção de desconexão
    socket._lastPingTime = Date.now();
    socket._missedPings = 0;
    
    // Verifica heartbeat a cada 6 segundos
    socket._heartbeatCheck = setInterval(() => {
      try {
        const timeSinceLastPing = Date.now() - socket._lastPingTime;
        
        // Se passou mais de 8s sem ping, considera possivelmente desconectado
        if (timeSinceLastPing > 8000) {
          socket._missedPings++;
          
          // Após 2 verificações sem ping (16s total), pausa o jogo preventivamente
          if (socket._missedPings >= 2) {
            // Encontra sala do jogador
            const roomCode = Object.keys(gameRooms).find((rc) =>
              gameRooms[rc].players.some((p) => p.socketId === socket.id)
            );
            
            if (roomCode) {
              const room = gameRooms[roomCode];
              
              // SISTEMA DE HEARTBEAT DESABILITADO
              // O jogo continua normalmente mesmo com conexão instável
              return;
              
              if (room && !room.isGameConcluded && !room._connectionPaused) {
                // PROTEÇÃO: Só pausar por heartbeat em jogos muito rápidos (≤ 7s)
                // Para jogos mais lentos, confiar apenas no disconnect do Socket.IO
                const timerDuration = room.timerDuration || 300;
                if (timerDuration > 7) {
                  console.log(`[Heartbeat] Timer lento (${timerDuration}s), não pausando por heartbeat: room=${roomCode}`);
                  return;
                }
                
                // Pausa timer
                room._timerPaused = true; // BLOQUEIA startTimer
                if (room.timerInterval) {
                  clearInterval(room.timerInterval);
                  room.timerInterval = null;
                  console.log(`[Heartbeat] Timer LIMPO (interval=null) para room=${roomCode}`);
                } else {
                  console.log(`[Heartbeat] Timer JÁ estava null para room=${roomCode}`);
                }
                
                room._connectionPaused = true;
                
                io.to(roomCode).emit("connectionIssue", {
                  message: "Conexão instável detectada. Timer pausado.",
                });
                
                io.to(roomCode).emit("timerPaused", {
                  reason: "connectionIssue",
                });
                
                console.log(`[Heartbeat] Timer pausado por conexão instável: room=${roomCode} socket=${socket.id}`);
              }
            }
          }
        } else {
          // Reset contador se recebeu ping
          socket._missedPings = 0;
          
          // Retoma jogo se estava pausado por conexão
          const roomCode = Object.keys(gameRooms).find((rc) =>
            gameRooms[rc].players.some((p) => p.socketId === socket.id)
          );
          
          if (roomCode) {
            const room = gameRooms[roomCode];
            if (room && room._connectionPaused) {
              room._connectionPaused = false;
              
              // PROTEÇÃO: Se o jogo já terminou (ex: W.O.), não tentar retomar timer
              if (room.isGameConcluded) {
                console.log(`[Heartbeat] Jogo já concluído, não retomando timer: room=${roomCode}`);
                return;
              }
              
              console.log(`[Heartbeat] Tentando retomar timer: room=${roomCode} timerActive=${room.game?.timerActive} latencyPaused=${room._latencyPaused} timerInterval=${room.timerInterval}`);
              
              // LIBERA o timer para poder ser iniciado
              room._timerPaused = false;
              
              // CORREÇÃO: Retoma timer de onde parou (não reseta!)
              if (room.game && room.game.timerActive && !room._latencyPaused) {
                try {
                  console.log(`[Heartbeat] Chamando startTimer para room=${roomCode}`);
                  console.log(`[Heartbeat] ANTES de startTimer: _timerPaused=${room._timerPaused} timerInterval=${room.timerInterval}`);
                  startTimer(roomCode);
                  console.log(`[Heartbeat] DEPOIS de startTimer`);
                } catch (e) {
                  console.error(`[Heartbeat] Erro ao chamar startTimer:`, e);
                }
              } else {
                console.log(`[Heartbeat] NÃO chamou startTimer: timerActive=${room.game?.timerActive} latencyPaused=${room._latencyPaused}`);
              }
              
              io.to(roomCode).emit("connectionRestored", {
                message: "Conexão restaurada. Jogo retomado.",
              });
              
              console.log(`[Heartbeat] Conexão restaurada: room=${roomCode} socket=${socket.id}`);
            }
          }
        }
      } catch (e) {
        console.error("[Heartbeat] Erro no heartbeat check:", e);
      }
    }, 6000);
    
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
        // HEARTBEAT: Marca timestamp do último ping recebido para detecção de desconexão
        socket._lastPingTime = Date.now();
        
        // store last known RTT for diagnostics (not persisted)
        if (!socket.userData) socket.userData = {};
        socket.userData.lastLatency =
          payload && payload.rtt ? payload.rtt : null;
        // Se o cliente reportou latência muito alta, tente pausar a partida
        try {
          const last = socket.userData.lastLatency;
          if (typeof last === "number") {
            // Identifica sala em que o socket participa (se jogador)
            const roomCode = Object.keys(gameRooms).find((rc) =>
              gameRooms[rc].players.some((p) => p.socketId === socket.id)
            );
            if (roomCode) {
              const r = gameRooms[roomCode];
              if (
                last >= LATENCY_PAUSE_MS &&
                !r._latencyPaused &&
                !r.isGameConcluded
              ) {
                try {
                  r._latencyPaused = true;
                  // pause server-side timer to avoid penalizar jogador com ping alto
                  if (r.timerInterval) {
                    clearInterval(r.timerInterval);
                    r.timerInterval = null;
                    console.log(`[Latency] Timer LIMPO (interval=null) para room=${r.roomCode}`);
                  } else {
                    console.log(`[Latency] Timer JÁ estava null para room=${r.roomCode}`);
                  }
                  io.to(r.roomCode).emit("opponentHighLatency", {
                    roomCode: r.roomCode,
                    latency: last,
                  });
                  io.to(r.roomCode).emit("timerPaused", {
                    reason: "highLatency",
                  });
                } catch (e) {}
              }

              // Se a latência caiu abaixo do limiar de retomada e a sala estava pausada, retome
              if (last < LATENCY_RESUME_MS && r._latencyPaused) {
                try {
                  r._latencyPaused = false;
                  io.to(r.roomCode).emit("latencyResolved", {
                    roomCode: r.roomCode,
                    latency: last,
                  });
                  // CORREÇÃO: Retoma timer de onde parou (não reseta!)
                  try {
                    if (r.game && r.game.timerActive) startTimer(r.roomCode);
                  } catch (e) {}
                } catch (e) {}
              }
            }
          }
        } catch (e) {}
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

    // Permite que um jogador carregue/force um estado de tabuleiro e propague ao oponente
    socket.on("requestSetBoard", (data) => {
      try {
        if (!data || !data.roomCode) return;
        const room = gameRooms[data.roomCode];
        if (!room || !room.game) return;

        // Segurança: apenas jogadores na sala podem atualizar o estado
        const isPlayer = room.players.some((p) => p.socketId === socket.id);
        if (!isPlayer) return;

        // Validar estrutura mínima
        if (!data.boardState || !Array.isArray(data.boardState)) return;

        // Atualiza o estado do jogo no servidor
        try {
          room.game.boardState = data.boardState;
          room.game.boardSize = data.boardSize || data.boardState.length;
          if (data.currentPlayer === "b" || data.currentPlayer === "p")
            room.game.currentPlayer = data.currentPlayer;
          // limpa capturas parciais
          room.game.turnCapturedPieces = [];
        } catch (e) {
          console.error("requestSetBoard apply failed:", e);
        }

        // Envia novo estado para jogadores e espectadores
        const bestCaptures2 = timedFindBestCaptureMoves(
          room.game.currentPlayer,
          room.game,
          room.roomCode
        );
        const mandatoryPieces = bestCaptures.map((seq) => seq[0]);
        sendGameState(
          room.roomCode,
          { ...room.game, mandatoryPieces },
          { forceSpectator: true }
        );
      } catch (e) {}
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
      // garante campo `team` no userData do criador
      socket.userData = socket.userData || {};
      socket.userData.team =
        socket.userData.team ||
        socket.userData.username ||
        socket.userData.email;
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
      // garante campo `team` no userData do entrante
      socket.userData = socket.userData || {};
      socket.userData.team =
        socket.userData.team ||
        socket.userData.username ||
        socket.userData.email;
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
        // room cancel requested by creator (log removed)
        delete gameRooms[roomCode];
        socket.emit("roomCancelled");
        scheduleLobbyUpdate();
      }
    });

    socket.on("playerMove", async (moveData) => {
      try {
        // Log de recepção para diagnóstico de latência
        try {
          const recvTs = Date.now();
          // latency debug logs removed
        } catch (le) {}

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

      try {
        const startExec = Date.now();
        await executeMove(
          moveData.room,
          moveData.from,
          moveData.to,
          socket.id,
          moveData.moveId
        );
        // executeMove latency log removed
      } catch (ex) {
        console.error("executeMove erro:", ex);
      }
    });

    socket.on("getValidMoves", (data) => {
      const { row, col, roomCode } = data;
      const room = gameRooms[roomCode];
      if (!room || !room.game) return socket.emit("showValidMoves", []);

      const game = room.game;
      const validMoves = [];

      try {
        // Determina a cor da peça clicada pelo estado do tabuleiro. Em alguns
        // casos de corrida o game.currentPlayer pode não estar atualizado no
        // momento do clique; usar a peça como referência torna a resposta
        // mais resiliente (o cliente já valida turno antes de pedir).
        const piece =
          game.boardState && game.boardState[row]
            ? game.boardState[row][col]
            : null;

        if (!piece) return socket.emit("showValidMoves", []);

        const pieceColor = String(piece).toLowerCase() === "b" ? "b" : "p";

        // Prioriza sequências de captura para a cor do jogador que possui a peça
        const bestCaptures = timedFindBestCaptureMoves(
          pieceColor,
          game,
          roomCode
        );

        if (game.mustCaptureWith) {
          // Se há uma peça obrigatória diferente da clicada, não mostramos
          if (
            game.mustCaptureWith.row !== row ||
            game.mustCaptureWith.col !== col
          ) {
            return socket.emit("showValidMoves", []);
          }
          // Caso a peça clicada seja a obrigatória, extrai destinos de captura
          const capturesForThis = bestCaptures.filter(
            (seq) => seq[0] && seq[0].row === row && seq[0].col === col
          );
          capturesForThis.forEach((seq) => {
            for (let i = 1; i < seq.length; i++) validMoves.push(seq[i]);
          });
          return socket.emit("showValidMoves", validMoves);
        }

        if (bestCaptures && bestCaptures.length > 0) {
          const capturesForThis = bestCaptures.filter(
            (seq) => seq[0] && seq[0].row === row && seq[0].col === col
          );
          capturesForThis.forEach((seq) => {
            for (let i = 1; i < seq.length; i++) validMoves.push(seq[i]);
          });
          return socket.emit("showValidMoves", validMoves);
        }

        // Sem capturas obrigatórias: verifica movimentos válidos simples para
        // a peça clicada usando isMoveValid (ignorando regra da maioria aqui).
        const boardSize = game.boardSize;
        for (let r = 0; r < boardSize; r++) {
          for (let c = 0; c < boardSize; c++) {
            try {
              const mv = timedIsMoveValid(
                { row, col },
                { row: r, col: c },
                pieceColor,
                game,
                true,
                roomCode
              );
              if (mv && mv.valid) validMoves.push({ row: r, col: c });
            } catch (inner) {
              /* continue */
            }
          }
        }

        socket.emit("showValidMoves", validMoves);
      } catch (err) {
        console.error("getValidMoves error:", err);
        socket.emit("showValidMoves", []);
      }
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
          user.team = user.team || user.username || user.email;
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
          player.user.team =
            player.user.team || player.user.username || player.user.email;
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
          // CORREÇÃO: Se o jogo já terminou (ex: perdeu por W.O. enquanto desconectado),
          // envia gameOver para desbloquear a tela ao invés de gameResumed
          // MAS: não enviar se há uma revanche em andamento (race condition)
          const bothAcceptedRevanche = 
            room.revancheRequests && 
            room.revancheRequests.size === 2 &&
            room.players.length === 2;
          
          if (room.isGameConcluded && !bothAcceptedRevanche) {
            // Determina quem ganhou para enviar o evento correto
            const playerColor = room.game.users.white === user.email ? "b" : "p";
            const opponentColor = playerColor === "b" ? "p" : "b";
            
            // Assume que se o jogo terminou e o jogador está reconectando,
            // provavelmente perdeu (W.O. ou timeout). Envia gameOver.
            socket.emit("gameOver", {
              winner: opponentColor, // Oponente ganhou
              reason: "Você perdeu por desconexão ou tempo esgotado",
              moveHistory: room.game.moveHistory || [],
              initialBoardState: room.game.initialBoardState || null,
            });
            
            console.log(
              `[Socket] rejoinActiveGame: jogo já concluído, enviando gameOver para socket=${socket.id} room=${roomCode}`
            );
            return; // Não continua com gameResumed
          }
          
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
            // Preserve object shape to avoid races where other code expects
            // `room.match` to exist right after a revanche is accepted.
            if (room.gameMode === "tablita") {
              try {
                const p1 = room.players[0];
                const p2 = room.players[1];
                room.match = {
                  score: {
                    [p1.user.email]: 0,
                    [p2.user.email]: 0,
                  },
                  currentGame: 1,
                  opening: null,
                  openingBoard: null,
                  player1: { email: p1.user.email, socketId: p1.socketId },
                  player2: { email: p2.user.email, socketId: p2.socketId },
                };
              } catch (e) {
                room.match = null;
              }
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
              // CORREÇÃO: Limpar timeout de reconexão do sistema de disconnect
              if (room._reconnectTimeout) {
                clearTimeout(room._reconnectTimeout);
                room._reconnectTimeout = null;
              }
              // Limpar flags de conexão
              room._connectionPaused = false;
              room._disconnectedPlayer = null;
              room._disconnectTime = null;
              
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

    // DISCONNECT HANDLER: DESABILITADO
    socket.on("disconnect", (reason) => {
      try {
        // Limpa heartbeat check
        if (socket._heartbeatCheck) {
          clearInterval(socket._heartbeatCheck);
          socket._heartbeatCheck = null;
        }

        // SISTEMA DE DISCONNECT DESABILITADO
        // O jogo continua normalmente mesmo com desconexões
        return;

        // Pausa o timer imediatamente para evitar perda por tempo
        if (room.timerInterval) {
          clearInterval(room.timerInterval);
          room.timerInterval = null;
        }

        // Marca que está aguardando reconexão
        room._disconnectedPlayer = socket.id;
        room._disconnectTime = Date.now();

        // Notifica o oponente
        io.to(roomCode).emit("opponentDisconnected", {
          message: "Oponente desconectou. Aguardando reconexão...",
        });

        io.to(roomCode).emit("timerPaused", {
          reason: "disconnect",
        });

        // Timeout de reconexão (30 segundos) - após isso, declara W.O.
        room._reconnectTimeout = setTimeout(() => {
          const r = gameRooms[roomCode];
          if (!r || r.isGameConcluded) return;

          // Verifica se ainda está desconectado
          const stillDisconnected = !r.players.some(
            (p) =>
              p.socketId === socket.id &&
              io.sockets.sockets.get(p.socketId)?.connected
          );

          if (stillDisconnected) {
            console.log(
              `[Disconnect] Timeout de reconexão atingido: room=${roomCode} socket=${socket.id}`
            );

            // Declara vitória por W.O. para o jogador conectado
            const connectedPlayer = r.players.find(
              (p) => p.socketId !== socket.id
            );

            if (connectedPlayer) {
              try {
                const winnerColor =
                  connectedPlayer.user.email === r.game?.users?.white
                    ? "b"
                    : "p";
                // Corrigido: safeProcessEndOfGame recebe (winnerColor, loserColor, room, reason)
                const loserColor = winnerColor === "b" ? "p" : "b";
                safeProcessEndOfGame(
                  winnerColor,
                  loserColor,
                  r,
                  "Vitória por W.O. - Oponente desconectou"
                );
              } catch (e) {
                console.error("Erro ao processar W.O.:", e);
              }
            }
          }
        }, 30000);
      } catch (e) {
        console.error("[Disconnect] Erro no handler de disconnect:", e);
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
