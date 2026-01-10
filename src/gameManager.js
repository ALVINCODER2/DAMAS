// src/gameManager.js
const User = require("../models/User");
const MatchHistory = require("../models/MatchHistory");
// Certifique-se de que o caminho está correto conforme sua estrutura
const { findBestCaptureMoves } = require("../public/js/gameLogic");

let io;
let gameRooms;
let tournamentManager = null;

function initializeManager(ioInstance, roomsInstance, tmInstance) {
  io = ioInstance;
  gameRooms = roomsInstance;
  if (tmInstance) tournamentManager = tmInstance;
}

function setTournamentManager(tm) {
  tournamentManager = tm;
}

// Verifica se existe captura obrigatória para o jogador atual no objeto game
function isMandatoryCapturePresent(game) {
  try {
    const caps = findBestCaptureMoves(game.currentPlayer, game);
    return Array.isArray(caps) && caps.length > 0;
  } catch (e) {
    console.error("isMandatoryCapturePresent error:", e);
    return false;
  }
}

function startTimer(roomCode) {
  const room = gameRooms[roomCode];
  if (!room) return;
  if (room.isGameConcluded) return;
  
  // PROTEÇÃO CRÍTICA: Se o timer está explicitamente pausado, NÃO iniciar
  if (room._timerPaused) {
    return;
  }
  
  // PROTEÇÃO CRÍTICA: Se já está iniciando, NÃO fazer nada
  if (room._timerStarting) {
    return;
  }
  
  // PROTEÇÃO CRÍTICA: Se já existe um interval rodando, NÃO fazer nada
  if (room.timerInterval) {
    return;
  }
  
  // Marca que está iniciando
  room._timerStarting = true;

  // CORREÇÃO CRÍTICA: Modos "match" e "move" usam whiteTime/blackTime
  // Apenas modo "total" (ou undefined) usa timeLeft
  if (room.timeControl === "match" || room.timeControl === "move") {
    // CORREÇÃO CRÍTICA: NÃO capturar currentPlayerColor aqui!
    // Deve ser lido DENTRO do interval para pegar o jogador correto após troca de turno
    
    // PROTEÇÃO: Verificar se os tempos são válidos antes de iniciar
    if (typeof room.whiteTime !== 'number' || room.whiteTime < 0) {
      console.error(`[Timer] whiteTime inválido: ${room.whiteTime}, resetando para timerDuration`);
      room.whiteTime = room.timerDuration || 7;
    }
    if (typeof room.blackTime !== 'number' || room.blackTime < 0) {
      console.error(`[Timer] blackTime inválido: ${room.blackTime}, resetando para timerDuration`);
      room.blackTime = room.timerDuration || 7;
    }

    room.timerInterval = setInterval(() => {
      if (!gameRooms[roomCode]) {
        clearInterval(room.timerInterval);
        return;
      }

      // DELAY REMOVIDO: Timer agora começa a contar imediatamente após cada movimento
      // para melhorar a responsividade e eliminar a percepção de "delay"

      // Lê o jogador atual AGORA, não quando o timer foi criado
      const currentPlayerColor = room.game.currentPlayer;
      let timeOver = false;

      // LOG DEBUG TABLITA
      console.log(`[Timer] TICK: room=${roomCode} mode=${room.timeControl} player=${currentPlayerColor} W=${room.whiteTime} B=${room.blackTime}`);

      if (currentPlayerColor === "b") {
        room.whiteTime--;
        if (room.whiteTime <= 0) {
          timeOver = true;
          console.log(`[Timer] Tempo esgotado para BRANCAS: room=${roomCode}`);
        }
      } else {
        room.blackTime--;
        if (room.blackTime <= 0) {
          timeOver = true;
          console.log(`[Timer] Tempo esgotado para PRETAS: room=${roomCode}`);
        }
      }

      // OTIMIZAÇÃO: Emitir timerUpdate apenas a cada 2s (reduz 50% do tráfego)
      // Timer visual atualiza a cada 2s, mas lógica interna continua a cada 1s
      const now = Date.now();
      if (!room._lastTimerEmit) room._lastTimerEmit = 0;
      if (now - room._lastTimerEmit >= 2000) {
        // Timer updates são frequentes e podem criar backlog em redes lentas;
        // emitir como `volatile` reduz chance de crescimento na fila do socket
        io.to(roomCode).volatile.emit("timerUpdate", {
          whiteTime: room.whiteTime,
          blackTime: room.blackTime,
          roomCode: roomCode,
          currentPlayer: room.game && room.game.currentPlayer,
          timerActive: room.game ? !!room.game.timerActive : true,
        });
        room._lastTimerEmit = now;
      }

      if (timeOver) {
        // Limpar timer para evitar ticks adicionais
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        
        // CORREÇÃO AGRESSIVA: Limpar TODOS os timeouts
        if (room.turnInactivityTimeout) {
          clearTimeout(room.turnInactivityTimeout);
          room.turnInactivityTimeout = null;
        }
        if (room.firstMoveTimeout) {
          clearTimeout(room.firstMoveTimeout);
          room.firstMoveTimeout = null;
        }
        
        const loserColor = currentPlayerColor;
        const winnerColor = loserColor === "b" ? "p" : "b";
        console.log(`[Timer] TEMPO ESGOTADO! winner=${winnerColor} loser=${loserColor} room=${roomCode} isTablita=${room.isTablita} isGameConcluded=${room.isGameConcluded}`);
        
        // IMPORTANTE: NÃO marcar isGameConcluded aqui!
        // processEndOfGame fará isso APÓS emitir os eventos gameOver
        safeProcessEndOfGame(winnerColor, loserColor, room, "Tempo esgotado!");
      }
    }, 1000);
    
    // Libera flag após criar interval
    room._timerStarting = false;
    console.log(`[Timer] Iniciado para room=${roomCode} whiteTime=${room.whiteTime} blackTime=${room.blackTime} currentPlayer=${room.game.currentPlayer}`);
  } else {
    // PROTEÇÃO: Verificar se timeLeft é válido
    if (typeof room.timeLeft !== 'number' || room.timeLeft < 0) {
      console.error(`[Timer] timeLeft inválido: ${room.timeLeft}, resetando para timerDuration`);
      room.timeLeft = room.timerDuration || 300;
    }
    
    io.to(roomCode).volatile.emit("timerUpdate", {
      timeLeft: room.timeLeft,
      roomCode: roomCode,
      currentPlayer: room.game && room.game.currentPlayer,
      timerActive: room.game ? !!room.game.timerActive : true,
    });

    room.timerInterval = setInterval(() => {
      if (!gameRooms[roomCode]) {
        clearInterval(room.timerInterval);
        return;
      }
      room.timeLeft--;
      
      // OTIMIZAÇÃO: Emitir timerUpdate apenas a cada 2s (reduz 50% do tráfego)
      const now = Date.now();
      if (!room._lastTimerEmit) room._lastTimerEmit = 0;
      if (now - room._lastTimerEmit >= 2000) {
        io.to(roomCode).volatile.emit("timerUpdate", {
          timeLeft: room.timeLeft,
          roomCode: roomCode,
        });
        room._lastTimerEmit = now;
      }
      if (room.timeLeft <= 0) {
        // Limpar timer para evitar ticks adicionais
        clearInterval(room.timerInterval);
        room.timerInterval = null;
    
        // CORREÇÃO: Limpar timeouts secundários para evitar que disparem após o fim do jogo
        // (Crucial para Tablita, onde o jogo "continua" para a próxima partida)
        if (room.turnInactivityTimeout) {
          clearTimeout(room.turnInactivityTimeout);
          room.turnInactivityTimeout = null;
        }
        if (room.firstMoveTimeout) {
          clearTimeout(room.firstMoveTimeout);
          room.firstMoveTimeout = null;
        }
        
        const loserColor = room.game.currentPlayer;
        const winnerColor = loserColor === "b" ? "p" : "b";
        console.log(`[Timer] Processando fim de jogo (modo total): winner=${winnerColor} loser=${loserColor} room=${roomCode}`);
        
        // IMPORTANTE: NÃO marcar isGameConcluded aqui!
        // processEndOfGame fará isso APÓS emitir os eventos gameOver
        safeProcessEndOfGame(winnerColor, loserColor, room, "Tempo esgotado!");
      }
    }, 1000);
    
    // Libera flag após criar interval
    room._timerStarting = false;
  }
}

function resetTimer(roomCode) {
  const stack = new Error().stack.split('\n')[2].trim();
  console.log(`[Timer] resetTimer chamado: roomCode=${roomCode} de: ${stack}`);
  const room = gameRooms[roomCode];
  if (room) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;

    if (room.timeControl === "match") {
      // CORREÇÃO CRÍTICA: NO MODO "MATCH" (tempo por partida), NÃO resetar os tempos!
      // Os tempos devem continuar diminuindo ao longo de toda a partida.
      // Apenas limpar e reiniciar o interval para garantir funcionamento correto.
      // NÃO fazer: room.whiteTime = room.timerDuration;
      // NÃO fazer: room.blackTime = room.timerDuration;
      
      // Apenas emitir o estado atual e reiniciar o timer
      io.to(roomCode).volatile.emit("timerUpdate", {
        whiteTime: room.whiteTime,
        blackTime: room.blackTime,
        roomCode: roomCode,
        currentPlayer: room.game && room.game.currentPlayer,
        timerActive: room.game ? !!room.game.timerActive : true,
      });
      startTimer(roomCode);
    } else {
      // Modo "total": resetar o tempo total (comportamento original correto)
      room.timeLeft = room.timerDuration;
      io.to(roomCode).volatile.emit("timerUpdate", {
        timeLeft: room.timeLeft,
        roomCode: roomCode,
      });
      startTimer(roomCode);
    }
  }
}

const { enqueue } = require("./jobQueue");

async function saveMatchHistory(room, winnerEmail, reason) {
  try {
    const p1Email = room.players[0].user.email;
    const p2Email = room.players[1].user.email;

    const payload = {
      player1: p1Email,
      player2: p2Email,
      winner: winnerEmail || null,
      bet: room.bet,
      gameMode: room.gameMode,
      reason: reason,
      createdAt: new Date(),
    };

    // Try to persist immediately in this process so the match is visible
    // immediately in DB and can be published to Redis for other instances.
    let saved = null;
    try {
      saved = await MatchHistory.create(payload);
      // update in-process cache and emit
      try {
        const doc = saved.toObject ? saved.toObject() : saved;
        if (io) {
          io.recentMatchCache = io.recentMatchCache || [];
          io.recentMatchCache.unshift(doc);
          if (io.recentMatchCache.length > 500)
            io.recentMatchCache.length = 500;
          io.emit("matchRecorded", doc);
        }
      } catch (e) {}

      // publish to Redis channel so other instances receive the notification
      try {
        const REDIS_URL = process.env.REDIS_URL;
        if (REDIS_URL) {
          const { createClient } = require("redis");
          const rc = createClient({ url: REDIS_URL });
          rc.connect()
            .then(() =>
              rc.publish(
                "damas:matchSaved",
                JSON.stringify({
                  _id: saved._id,
                  player1: saved.player1,
                  player2: saved.player2,
                  winner: saved.winner,
                  bet: saved.bet,
                  gameMode: saved.gameMode,
                  reason: saved.reason,
                  createdAt: saved.createdAt,
                })
              )
            )
            .catch(() => {})
            .finally(() => {
              try {
                rc.disconnect().catch(() => {});
              } catch (e) {}
            });
        }
      } catch (e) {}
    } catch (e) {
      // if immediate save fails, fall back to enqueueing job for worker
      try {
        enqueue({
          type: "saveMatchHistory",
          payload,
        });
      } catch (er) {}
    }
    // Also emit immediate socket event for local players (if saved failed earlier,
    // we still emit optimistic payload so players see immediate feedback)
    try {
      const optimistic = {
        player1: p1Email,
        player2: p2Email,
        winner: winnerEmail || null,
        bet: room.bet,
        gameMode: room.gameMode,
        reason: reason,
        createdAt: new Date(),
      };
      if (io && room && room.roomCode) {
        try {
          io.to(room.roomCode).emit("matchRecorded", optimistic);
        } catch (e) {}
      }
      try {
        if (Array.isArray(room.players)) {
          room.players.forEach((p) => {
            if (p && p.socketId && io && io.sockets) {
              try {
                const s = io.sockets.sockets.get(p.socketId);
                if (s) s.emit("matchRecorded", optimistic);
              } catch (er) {}
            }
          });
        }
      } catch (e) {}
    } catch (e) {}
  } catch (err) {
    try {
      console.error("Erro ao enfileirar histórico:", err);
    } catch (e) {}
  }
}

async function processEndOfGame(winnerColor, loserColor, room, reason) {
  if (!room) return;
  // Debounce sequential end-of-game calls: ignore duplicates within 3s
  try {
    const now = Date.now();
    if (room._lastEndTimestamp && now - room._lastEndTimestamp < 3000) {
      console.log(
        `[processEndOfGame] room=${
          room.roomCode
        } ignoring duplicate end (last=${
          now - room._lastEndTimestamp
        }ms) reason=${reason}`
      );
      // debug trace removed to reduce overhead in hot path
      return;
    }
    room._lastEndTimestamp = now;
  } catch (e) {}

  // Prevent duplicate concurrent processing of the same end-of-game event
  if (room._endProcessing) {
    console.log(
      `[processEndOfGame] room=${room.roomCode} already processing end -> ignoring duplicate call. reason=${reason}`
    );
    // debug trace removed to reduce overhead in hot path
    return;
  }

  // mark processing and log entry stack to help debugging race conditions
  room._endProcessing = true;
  try {
    if (room.isGameConcluded) return;

    console.log(`[processEndOfGame] room=${room.roomCode} winner=${winnerColor} reason=${reason} isTablita=${room.isTablita}`);

    // Marca como concluído para evitar re-entradas (exceto para Tablita que tem 2 jogos)
    // Em Tablita, só concluímos o jogo "oficialmente" no fim do Match (jogo 2)
    // Se for jogo 1, apenas pausamos para o próximo.
    // Marcamos isGameConcluded apenas se não for Tablita ou se for o fim do Match Tablita

    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }
    
    // CORREÇÃO: Limpar timeouts secundários para evitar que disparem após o fim do jogo
    // (Crucial para Tablita, onde o jogo "continua" para a próxima partida)
    if (room.turnInactivityTimeout) {
      clearTimeout(room.turnInactivityTimeout);
      room.turnInactivityTimeout = null;
    }
    if (room.firstMoveTimeout) {
      clearTimeout(room.firstMoveTimeout);
      room.firstMoveTimeout = null;
    }

    // CORREÇÃO CRÍTICA: Resetar valores de tempo para evitar que sejam carregados na revanche
    // Isso previne que movimentos sejam bloqueados por tempo esgotado após revanche
    if (room.timeControl === "match" || room.timeControl === "move") {
      room.whiteTime = room.timerDuration || 7;
      room.blackTime = room.timerDuration || 7;
    } else {
      room.timeLeft = room.timerDuration || 300;
    }

    room.drawOfferBy = null;
    io.to(room.roomCode).emit("drawOfferCancelled");

    // ### LÓGICA DE TORNEIO ###
    if (room.isTournament) {
      room.isGameConcluded = true; // Torneio encerra na hora

      let winnerSocketId = null;
      let loserSocketId = null;

      if (winnerColor) {
        winnerSocketId =
          room.game.players[winnerColor === "b" ? "white" : "black"];
        loserSocketId =
          room.game.players[loserColor === "b" ? "white" : "black"];
      }

      const winnerData = room.players.find(
        (p) => p.socketId === winnerSocketId
      );
      const loserData = room.players.find((p) => p.socketId === loserSocketId);

      const winnerEmail = winnerData ? winnerData.user.email : null;
      const loserEmail = loserData ? loserData.user.email : null;

      if (winnerColor) {
        io.to(room.roomCode).emit("gameOver", {
          winner: winnerColor,
          reason: `Torneio: ${reason} Vencedor avança!`,
          isTournament: true,
          moveHistory: room.game.moveHistory,
          initialBoardState: room.game.initialBoardState,
        });
        try {
          const specRoom = `${room.roomCode}-spectators`;
          io.to(specRoom).emit("gameOver", {
            winner: winnerColor,
            reason: `Torneio: ${reason} Vencedor avança!`,
            isTournament: true,
            moveHistory: room.game.moveHistory,
            initialBoardState: room.game.initialBoardState,
          });
        } catch (e) {}
        // Forçar retorno ao lobby do vencedor (se conectado)
        if (winnerData && winnerData.socketId) {
          try {
            const s = io.sockets.sockets.get(winnerData.socketId);
            if (s) s.emit("forceReturnToLobby");
          } catch (e) {}
        }
        // Se houver um jogador perdedor conectado, forçar retorno ao lobby
        if (loserData && loserData.socketId) {
          try {
            const s = io.sockets.sockets.get(loserData.socketId);
            if (s) s.emit("forceReturnToLobby");
          } catch (e) {}
        }
      }

      if (tournamentManager) {
        await tournamentManager.handleTournamentGameEnd(
          winnerEmail,
          loserEmail,
          room
        );
      }

      room.cleanupTimeout = setTimeout(() => {
        if (gameRooms[room.roomCode]) delete gameRooms[room.roomCode];
      }, 10000);
      return;
    }
    // ### FIM LÓGICA TORNEIO ###

    // ### MODO CLÁSSICO / INTERNACIONAL (NÃO É TABLITA) ###
    if (!room.isTablita) {
      room.isGameConcluded = true;
      if (!winnerColor) {
        // Empate
        try {
          await User.findOneAndUpdate({ email: room.players[0].user.email }, [
            {
              $set: { saldo: { $round: [{ $add: ["$saldo", room.bet] }, 2] } },
            },
          ]);
          await User.findOneAndUpdate({ email: room.players[1].user.email }, [
            {
              $set: { saldo: { $round: [{ $add: ["$saldo", room.bet] }, 2] } },
            },
          ]);
          io.to(room.roomCode).emit("gameDraw", {
            reason,
            moveHistory: room.game.moveHistory, // Envia histórico
            initialBoardState: room.game.initialBoardState, // Envia estado inicial
          });
          try {
            const specRoom = `${room.roomCode}-spectators`;
            io.to(specRoom).emit("gameDraw", {
              reason,
              moveHistory: room.game.moveHistory,
              initialBoardState: room.game.initialBoardState,
            });
          } catch (e) {}

          await saveMatchHistory(room, null, reason);
        } catch (err) {
          console.error("Erro ao processar empate clássico:", err);
        }
      } else {
        // Vitória
        const winnerSocketId =
          room.game.players[winnerColor === "b" ? "white" : "black"];
        const winnerData = room.players.find(
          (p) => p.socketId === winnerSocketId
        );
        if (winnerData) {
          try {
            const prize = room.bet * 2;
            const updatedWinner = await User.findOneAndUpdate(
              { email: winnerData.user.email },
              [
                {
                  $set: { saldo: { $round: [{ $add: ["$saldo", prize] }, 2] } },
                },
              ],
              { new: true }
            );
            io.to(room.roomCode).emit("gameOver", {
              winner: winnerColor,
              reason,
              moveHistory: room.game.moveHistory, // Envia histórico
              initialBoardState: room.game.initialBoardState, // Envia estado inicial
            });
            try {
              const specRoom = `${room.roomCode}-spectators`;
              io.to(specRoom).emit("gameOver", {
                winner: winnerColor,
                reason,
                moveHistory: room.game.moveHistory,
                initialBoardState: room.game.initialBoardState,
              });
            } catch (e) {}
            const winnerSocket = io.sockets.sockets.get(winnerData.socketId);
            if (winnerSocket && updatedWinner) {
              winnerSocket.emit("updateSaldo", {
                newSaldo: updatedWinner.saldo,
              });
            }

            // NÃO forçar retorno ao lobby do perdedor em partidas clássicas.
            // Permitimos que o cliente mostre o modal de revanche e aguarde
            // a decisão dos jogadores antes de redirecionar.

            await saveMatchHistory(room, winnerData.user.email, reason);
          } catch (err) {
            console.error("Erro ao pagar prêmio clássico:", err);
          }
        }
      }
      room.cleanupTimeout = setTimeout(() => {
        if (gameRooms[room.roomCode]) delete gameRooms[room.roomCode];
      }, 60000);
      return;
    }

    // ### MODO TABLITA (MATCH DE 2 JOGOS) ###

    // Atualiza pontuação do jogo atual
    if (winnerColor) {
      const winnerSocketId =
        room.game.players[winnerColor === "b" ? "white" : "black"];
      const winnerData = room.players.find(
        (p) => p.socketId === winnerSocketId
      );
      if (winnerData) {
        room.match.score[winnerData.user.email]++;
      }
    } else {
      // Empate: 0.5 para cada
      room.match.score[room.match.player1.email] += 0.5;
      room.match.score[room.match.player2.email] += 0.5;
    }

    const p1Email = room.match.player1.email;
    const p2Email = room.match.player2.email;
    const p1Score = room.match.score[p1Email];
    const p2Score = room.match.score[p2Email];

    // Verifica se o match acabou.
    // Acaba se for o Jogo 2 (currentGame === 2)
    // OU se alguém já fez 2 pontos (improvável no jogo 1 pois cada win vale 1, mas seguro checar).
    const matchOver =
      room.match.currentGame === 2 || p1Score >= 2 || p2Score >= 2;

    if (matchOver) {
      // --- FIM DO MATCH (MOSTRAR REPLAY) ---
      room.isGameConcluded = true;

      let finalWinnerData;
      if (p1Score > p2Score) finalWinnerData = room.match.player1;
      else if (p2Score > p1Score) finalWinnerData = room.match.player2;

      if (finalWinnerData) {
        try {
          const prize = room.bet * 2;
          const updatedWinner = await User.findOneAndUpdate(
            { email: finalWinnerData.email },
            [{ $set: { saldo: { $round: [{ $add: ["$saldo", prize] }, 2] } } }],
            { new: true }
          );
          const winnerColorFinal =
            room.game.users.white === finalWinnerData.email ? "b" : "p"; // Cor do vencedor no ÚLTIMO jogo

          const finalReason = `Fim da partida! Placar: ${p1Score} a ${p2Score}. ${reason}`;

          // EMITE O GAME OVER (COM O BOTÃO DE REPLAY E HISTÓRICO DA ÚLTIMA PARTIDA)
          io.to(room.roomCode).emit("gameOver", {
            winner: winnerColorFinal,
            reason: finalReason,
            moveHistory: room.game.moveHistory, // Histórico do Jogo 2
            initialBoardState: room.game.initialBoardState,
          });
          const winnerSocket = io.sockets.sockets.get(finalWinnerData.socketId);
          if (winnerSocket && updatedWinner) {
            winnerSocket.emit("updateSaldo", { newSaldo: updatedWinner.saldo });
          }

          await saveMatchHistory(room, finalWinnerData.email, finalReason);
        } catch (err) {
          console.error("Erro ao pagar prêmio Tablita:", err);
        }
        // Notificar perdedor para retornar ao lobby
        // Não forçamos retorno ao lobby aqui para partidas do modo Tablita.
        // Deixamos o `room.isGameConcluded = true` e emitimos o evento `gameOver`
        // acima — o cliente mostrará a tela de fim de jogo com a opção de revanche.
        // A sala será removida automaticamente pelo `cleanupTimeout` abaixo após 60s
        // se os jogadores não aceitarem a revanche ou saírem.
      } else {
        // Empate no placar geral (ex: 1 a 1 ou 0 a 0)
        try {
          await User.findOneAndUpdate({ email: p1Email }, [
            {
              $set: { saldo: { $round: [{ $add: ["$saldo", room.bet] }, 2] } },
            },
          ]);
          await User.findOneAndUpdate({ email: p2Email }, [
            {
              $set: { saldo: { $round: [{ $add: ["$saldo", room.bet] }, 2] } },
            },
          ]);

          const finalReason = `Match empatado! Placar final: ${p1Score} a ${p2Score}. ${reason}`;

          // EMITE O GAME DRAW (COM O BOTÃO DE REPLAY)
          io.to(room.roomCode).emit("gameDraw", {
            reason: finalReason,
            moveHistory: room.game.moveHistory,
            initialBoardState: room.game.initialBoardState,
          });

          await saveMatchHistory(room, null, finalReason);
        } catch (err) {
          console.error("Erro ao devolver aposta em empate Tablita:", err);
        }
      }
      room.cleanupTimeout = setTimeout(() => {
        if (gameRooms[room.roomCode]) delete gameRooms[room.roomCode];
      }, 60000);
    } else {
      // --- FIM DO JOGO 1 (NÃO MOSTRAR REPLAY) ---
      // CORREÇÃO: Emitir gameOver para mostrar quem ganhou o Jogo 1!

      const game1WinnerColor = winnerColor;
      const game1Reason = `Jogo 1: ${reason}`;
      
      // Emite gameOver para mostrar resultado do Jogo 1
      io.to(room.roomCode).emit("gameOver", {
        winner: game1WinnerColor,
        reason: game1Reason,
        moveHistory: room.game.moveHistory,
        initialBoardState: room.game.initialBoardState,
        isTablitaGame1: true,
      });
      
      room.match.currentGame++; // Vai para 2
      const scoreArray = [p1Score, p2Score];
      const nextGameTitle = `Fim da 1ª Partida!`;

      console.log(`[Tablita] Fim do jogo 1. Placar: ${p1Score}-${p2Score}. Preparando próximo jogo...`);

      // Emite aviso que o próximo jogo vai começar (apenas overlay informativo)
      io.to(room.roomCode).emit("nextGameStarting", {
        score: scoreArray,
        title: nextGameTitle,
      });

      setTimeout(() => {
        try {
          // Import dinâmico para evitar dependência circular
          const { startNextTablitaGame } = require("./socketHandlers");
          if (startNextTablitaGame) {
            console.log(`[Tablita] Chamando startNextTablitaGame para room=${room.roomCode}`);
            startNextTablitaGame(room.roomCode);
          } else {
            console.error(`[Tablita] startNextTablitaGame não encontrado!`);
          }
        } catch (e) {
          console.error(`[Tablita] Erro ao iniciar próximo jogo:`, e);
        }
      }, 5000);
    }
  } catch (err) {
    console.error(`[Tablita] Erro fatal no processEndOfGame:`, err);
  } finally {
    try {
      room._endProcessing = false;
    } catch (e) {}
  }
}

// Wrapper to ensure only one end-of-game is processed per room at a time.
async function safeProcessEndOfGame(winnerColor, loserColor, room, reason) {
  try {
    if (!room) return;
    if (room._safeEndRequested) {
      console.log(
        `[safeProcessEndOfGame] room=${room.roomCode} already requested end -> ignoring (${reason})`
      );
      return;
    }
    room._safeEndRequested = true;
    await processEndOfGame(winnerColor, loserColor, room, reason);
  } catch (e) {
    console.error("safeProcessEndOfGame error:", e);
  } finally {
    // allow future legitimate end events after short delay
    setTimeout(() => {
      try {
        room._safeEndRequested = false;
      } catch (e) {}
    }, 3000);
  }
}

module.exports = {
  initializeManager,
  startTimer,
  resetTimer,
  processEndOfGame,
  safeProcessEndOfGame,
  setTournamentManager,
  isMandatoryCapturePresent,
};
