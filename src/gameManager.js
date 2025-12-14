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

function startTimer(roomCode) {
  const room = gameRooms[roomCode];
  if (!room) return;
  if (room.timerInterval) clearInterval(room.timerInterval);

  if (room.timeControl === "match") {
    const currentPlayerColor = room.game.currentPlayer;

    room.timerInterval = setInterval(() => {
      if (!gameRooms[roomCode]) {
        clearInterval(room.timerInterval);
        return;
      }

      let timeOver = false;

      if (currentPlayerColor === "b") {
        room.whiteTime--;
        if (room.whiteTime <= 0) timeOver = true;
      } else {
        room.blackTime--;
        if (room.blackTime <= 0) timeOver = true;
      }

      io.to(roomCode).emit("timerUpdate", {
        whiteTime: room.whiteTime,
        blackTime: room.blackTime,
        roomCode: roomCode,
      });

      if (timeOver) {
        clearInterval(room.timerInterval);
        const loserColor = currentPlayerColor;
        const winnerColor = loserColor === "b" ? "p" : "b";
        processEndOfGame(winnerColor, loserColor, room, "Tempo esgotado!");
      }
    }, 1000);
  } else {
    io.to(roomCode).emit("timerUpdate", {
      timeLeft: room.timeLeft,
      roomCode: roomCode,
    });

    room.timerInterval = setInterval(() => {
      if (!gameRooms[roomCode]) {
        clearInterval(room.timerInterval);
        return;
      }
      room.timeLeft--;
      io.to(roomCode).emit("timerUpdate", {
        timeLeft: room.timeLeft,
        roomCode: roomCode,
      });
      if (room.timeLeft <= 0) {
        clearInterval(room.timerInterval);
        const loserColor = room.game.currentPlayer;
        const winnerColor = loserColor === "b" ? "p" : "b";
        processEndOfGame(winnerColor, loserColor, room, "Tempo esgotado!");
      }
    }, 1000);
  }
}

function resetTimer(roomCode) {
  const room = gameRooms[roomCode];
  if (room) {
    clearInterval(room.timerInterval);

    if (room.timeControl === "match") {
      startTimer(roomCode);
    } else {
      room.timeLeft = room.timerDuration;
      io.to(roomCode).emit("timerUpdate", {
        timeLeft: room.timeLeft,
        roomCode: roomCode,
      });
      startTimer(roomCode);
    }
  }
}

async function saveMatchHistory(room, winnerEmail, reason) {
  try {
    const p1Email = room.players[0].user.email;
    const p2Email = room.players[1].user.email;

    const history = new MatchHistory({
      player1: p1Email,
      player2: p2Email,
      winner: winnerEmail || null,
      bet: room.bet,
      gameMode: room.gameMode,
      reason: reason,
    });

    await history.save();
  } catch (err) {
    console.error("Erro ao salvar histórico:", err);
  }
}

async function processEndOfGame(winnerColor, loserColor, room, reason) {
  if (!room || room.isGameConcluded) {
    return;
  }

  // Em Tablita, só concluímos o jogo "oficialmente" no fim do Match (jogo 2)
  // Se for jogo 1, apenas pausamos para o próximo.
  // Marcamos isGameConcluded apenas se não for Tablita ou se for o fim do Match Tablita

  if (room.timerInterval) clearInterval(room.timerInterval);
  room.drawOfferBy = null;
  io.to(room.roomCode).emit("drawOfferCancelled");

  // ### LÓGICA DE TORNEIO ###
  if (room.isTournament) {
    room.isGameConcluded = true; // Torneio encerra na hora
    const winnerSocketId =
      room.game.players[winnerColor === "b" ? "white" : "black"];
    const winnerData = room.players.find((p) => p.socketId === winnerSocketId);

    const loserSocketId =
      room.game.players[loserColor === "b" ? "white" : "black"];
    const loserData = room.players.find((p) => p.socketId === loserSocketId);

    const winnerEmail = winnerData ? winnerData.user.email : null;
    const loserEmail = loserData ? loserData.user.email : null;

    io.to(room.roomCode).emit("gameOver", {
      winner: winnerColor,
      reason: `Torneio: ${reason} Vencedor avança!`,
      isTournament: true,
      moveHistory: room.game.moveHistory,
      initialBoardState: room.game.initialBoardState,
    });

    if (tournamentManager && winnerEmail) {
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
        await User.findOneAndUpdate(
          { email: room.players[0].user.email },
          { $inc: { saldo: room.bet } }
        );
        await User.findOneAndUpdate(
          { email: room.players[1].user.email },
          { $inc: { saldo: room.bet } }
        );
        io.to(room.roomCode).emit("gameDraw", {
          reason,
          moveHistory: room.game.moveHistory, // Envia histórico
          initialBoardState: room.game.initialBoardState, // Envia estado inicial
        });

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
            { $inc: { saldo: prize } },
            { new: true }
          );
          io.to(room.roomCode).emit("gameOver", {
            winner: winnerColor,
            reason,
            moveHistory: room.game.moveHistory, // Envia histórico
            initialBoardState: room.game.initialBoardState, // Envia estado inicial
          });
          const winnerSocket = io.sockets.sockets.get(winnerData.socketId);
          if (winnerSocket && updatedWinner) {
            winnerSocket.emit("updateSaldo", { newSaldo: updatedWinner.saldo });
          }

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
    const winnerData = room.players.find((p) => p.socketId === winnerSocketId);
    if (winnerData) {
      room.match.score[winnerData.user.email]++;
    }
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
          { $inc: { saldo: prize } },
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
    } else {
      // Empate no placar geral (ex: 1 a 1 ou 0 a 0)
      try {
        await User.findOneAndUpdate(
          { email: p1Email },
          { $inc: { saldo: room.bet } }
        );
        await User.findOneAndUpdate(
          { email: p2Email },
          { $inc: { saldo: room.bet } }
        );

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
    // Apenas preparamos o próximo jogo. Não emitimos gameOver/gameDraw.

    room.match.currentGame++; // Vai para 2
    const scoreArray = [p1Score, p2Score];
    const nextGameTitle = `Fim da 1ª Partida!`;

    // Emite aviso que o próximo jogo vai começar (apenas overlay informativo)
    io.to(room.roomCode).emit("nextGameStarting", {
      score: scoreArray,
      title: nextGameTitle,
    });

    setTimeout(() => {
      // Import dinâmico para evitar dependência circular
      const { startNextTablitaGame } = require("./socketHandlers");
      if (startNextTablitaGame) {
        startNextTablitaGame(room.roomCode);
      }
    }, 5000);
  }
}

module.exports = {
  initializeManager,
  startTimer,
  resetTimer,
  processEndOfGame,
  setTournamentManager,
};
