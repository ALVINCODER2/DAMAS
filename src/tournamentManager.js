const Tournament = require("../models/Tournament");
const User = require("../models/User");
const MatchHistory = require("../models/MatchHistory"); // <--- IMPORTANTE: Adicionado para registrar o histórico

// Configurações
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 4; // Limite máximo de inscritos
const ENTRY_FEE = 2.0;
const TOURNAMENT_HOUR = 21;
const TOURNAMENT_MINUTE = 0;

let io; // Referência ao Socket.IO
let gameRooms; // Referência aos quartos de jogo (Injeção de Dependência)
let checkInterval;
let isProcessingStart = false;

// Recebe gameRooms na inicialização para evitar require circular
function initializeTournamentManager(ioInstance, gameRoomsInstance) {
  io = ioInstance;
  gameRooms = gameRoomsInstance;

  // Verifica o horário a cada 10 segundos
  checkInterval = setInterval(checkSchedule, 10 * 1000);
  console.log(
    `[Torneio] Gerenciador iniciado. Agendado para ${TOURNAMENT_HOUR}:${TOURNAMENT_MINUTE.toString().padStart(
      2,
      "0"
    )} BRT.`
  );

  recoverStuckTournaments();
}

async function getTodaysTournament() {
  let tournament = await Tournament.findOne({
    status: { $in: ["open", "active"] },
  }).sort({ createdAt: -1 });

  if (!tournament) {
    tournament = new Tournament({
      entryFee: ENTRY_FEE,
      status: "open",
      participants: [],
    });
    await tournament.save();
  }
  return tournament;
}

async function checkSchedule() {
  const now = new Date();
  const options = {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    minute: "numeric",
  };
  const formatter = new Intl.DateTimeFormat("pt-BR", options);
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour").value);
  const minute = parseInt(parts.find((p) => p.type === "minute").value);

  if (hour === TOURNAMENT_HOUR && minute === TOURNAMENT_MINUTE) {
    if (isProcessingStart) return;

    isProcessingStart = true;
    setTimeout(() => {
      isProcessingStart = false;
    }, 65000);

    const tournament = await getTodaysTournament();
    if (tournament.status === "open") {
      console.log("[Torneio] Horário atingido. Iniciando em 5 segundos...");
      setTimeout(() => {
        startTournament(tournament).catch((err) =>
          console.error("Erro ao iniciar torneio:", err)
        );
      }, 5000);
    }
  }
}

// --- FUNÇÃO DE INSCRIÇÃO SEGURA (ATÔMICA) ---
async function registerPlayer(email) {
  // 1. Verifica estado preliminar do torneio
  const tournamentCheck = await getTodaysTournament();

  if (tournamentCheck.status !== "open") {
    return {
      success: false,
      message: "Inscrições encerradas ou torneio em andamento.",
    };
  }
  // Bloqueia se já atingiu o limite máximo de inscritos
  if (tournamentCheck.participants.length >= MAX_PLAYERS) {
    return { success: false, message: "Torneio cheio. Inscrições encerradas." };
  }
  if (tournamentCheck.participants.includes(email)) {
    return { success: false, message: "Você já está inscrito." };
  }

  // 2. COBRANÇA ATÔMICA (Segurança Financeira)
  // Só desconta se o usuário tiver saldo suficiente no momento exato da query
  const userUpdate = await User.findOneAndUpdate(
    { email: email, saldo: { $gte: tournamentCheck.entryFee } },
    { $inc: { saldo: -tournamentCheck.entryFee } },
    { new: true }
  );

  if (!userUpdate) {
    return { success: false, message: "Saldo insuficiente para inscrição." };
  }

  try {
    // 3. INSCRIÇÃO ATÔMICA (Segurança de Dados)
    // Usa $addToSet para evitar duplicação e garante que o torneio ainda está 'open'
    const updatedTournament = await Tournament.findOneAndUpdate(
      { _id: tournamentCheck._id, status: "open" },
      {
        $addToSet: { participants: email },
        $inc: { prizePool: tournamentCheck.entryFee },
      },
      { new: true }
    );

    if (!updatedTournament) {
      // Caso raríssimo: O torneio mudou de status (fechou) APÓS a cobrança do usuário.
      // DEVOLUÇÃO IMEDIATA (Rollback)
      await User.findOneAndUpdate(
        { email },
        { $inc: { saldo: tournamentCheck.entryFee } }
      );
      return {
        success: false,
        message:
          "O torneio foi iniciado ou cancelado durante sua inscrição. Valor estornado.",
      };
    }

    if (io) {
      io.emit("tournamentUpdate", {
        participantsCount: updatedTournament.participants.length,
        prizePool: updatedTournament.prizePool,
      });
    }

    return { success: true, message: "Inscrição realizada com sucesso!" };
  } catch (err) {
    console.error("Erro crítico na inscrição:", err);
    // Reembolso de segurança em caso de erro de banco de dados
    await User.findOneAndUpdate(
      { email },
      { $inc: { saldo: tournamentCheck.entryFee } }
    );
    return { success: false, message: "Erro interno. Tente novamente." };
  }
}

// --- FUNÇÃO DE SAÍDA SEGURA (ATÔMICA) ---
async function unregisterPlayer(email) {
  const tournament = await getTodaysTournament();

  if (tournament.status !== "open") {
    return {
      success: false,
      message: "Não é possível sair agora (Torneio já iniciou ou fechou).",
    };
  }

  // 1. REMOÇÃO ATÔMICA DO TORNEIO
  // Tenta remover o jogador. Se falhar (não estava inscrito ou torneio fechou), não devolve dinheiro.
  const updatedTournament = await Tournament.findOneAndUpdate(
    { _id: tournament._id, status: "open", participants: email },
    {
      $pull: { participants: email },
      $inc: { prizePool: -tournament.entryFee },
    },
    { new: true }
  );

  if (!updatedTournament) {
    return {
      success: false,
      message: "Você não está inscrito ou o torneio já fechou.",
    };
  }

  // Correção visual para não deixar prizePool negativo por erro de arredondamento (raro)
  if (updatedTournament.prizePool < 0) {
    await Tournament.updateOne(
      { _id: tournament._id },
      { $set: { prizePool: 0 } }
    );
  }

  // 2. REEMBOLSO ATÔMICO
  // Como a remoção do torneio foi confirmada, devolvemos o dinheiro com segurança.
  await User.findOneAndUpdate(
    { email },
    { $inc: { saldo: tournament.entryFee } }
  );

  if (io) {
    io.emit("tournamentUpdate", {
      participantsCount: updatedTournament.participants.length,
      prizePool:
        updatedTournament.prizePool < 0 ? 0 : updatedTournament.prizePool,
    });
  }

  return { success: true, message: "Inscrição cancelada e valor reembolsado." };
}

async function cancelTournamentAndRefund(tournament, reason) {
  if (tournament.status === "cancelled") return;

  console.log(
    `[Torneio] Cancelando torneio ${tournament._id}. Motivo: ${reason}`
  );
  tournament.status = "cancelled";
  await tournament.save();

  // Reembolso em massa seguro e Registro no Histórico
  for (const email of tournament.participants) {
    const updatedUser = await User.findOneAndUpdate(
      { email },
      { $inc: { saldo: tournament.entryFee } },
      { new: true }
    );

    if (updatedUser) {
      // 1. Notifica via Socket
      if (io) {
        io.emit("balanceUpdate", {
          email: updatedUser.email,
          newSaldo: updatedUser.saldo,
        });
      }

      // 2. Salva no Histórico do Usuário
      try {
        await MatchHistory.create({
          player1: email,
          player2: "Sistema (Reembolso)",
          winner: email, // Define usuário como vencedor para indicar ganho ($)
          bet: tournament.entryFee,
          gameMode: "Torneio",
          reason: `Cancelado: ${reason}`,
          createdAt: new Date(),
        });
      } catch (histError) {
        console.error(
          `Erro ao salvar histórico de reembolso para ${email}:`,
          histError
        );
      }
    }
  }

  // Limpa salas de jogo da memória
  if (tournament.matches && gameRooms) {
    tournament.matches.forEach((m) => {
      if (m.roomCode && gameRooms[m.roomCode]) delete gameRooms[m.roomCode];
    });
  }

  if (io) io.emit("tournamentCancelled", { message: reason });
}

async function startTournament(tournament) {
  console.log("[Torneio] Verificando presença...");

  const onlineEmails = new Set();
  const sockets = await io.fetchSockets();

  sockets.forEach((socket) => {
    if (socket.userData && socket.userData.email) {
      onlineEmails.add(socket.userData.email);
    }
  });

  console.log(
    "[Torneio] Jogadores Online Detectados:",
    Array.from(onlineEmails)
  );

  // Usaremos todos os inscritos (mesmo ausentes) para criar os pares
  const originalParticipants = [...tournament.participants];

  console.log("[Torneio] Iniciando com inscritos: ", originalParticipants);
  tournament.status = "active";

  const shuffled = originalParticipants.sort(() => 0.5 - Math.random());

  const matches = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const p1 = shuffled[i];
    const p2 = shuffled[i + 1] || null;

    matches.push({
      matchId: `R1-M${matches.length + 1}`,
      round: 1,
      player1: p1,
      player2: p2,
      winner: p2 ? null : p1,
      status: p2 ? "pending" : "finished",
      roomCode: null,
    });
  }

  tournament.matches = matches;
  await tournament.save();

  io.emit("tournamentStarted", { bracket: matches });
  processRoundMatches(tournament);
}

async function processRoundMatches(tournament) {
  const pendingMatches = tournament.matches.filter(
    (m) => m.round === tournament.round && m.status === "pending"
  );

  for (const match of pendingMatches) {
    if (match.player1 && match.player2) {
      const roomCode = `TRN-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;
      match.roomCode = roomCode;
      match.status = "active";

      if (gameRooms) {
        // Preenche a lista de players com sockets online quando possível.
        const sockets = await io.fetchSockets();
        const emailToSocket = {};
        sockets.forEach((s) => {
          if (s.userData && s.userData.email)
            emailToSocket[s.userData.email] = s.id;
        });

        const playersPlaceholders = [match.player1, match.player2].map(
          (email) => {
            return { socketId: emailToSocket[email] || null, user: { email } };
          }
        );

        gameRooms[roomCode] = {
          roomCode,
          bet: 0,
          gameMode: "classic",
          timeControl: "move",
          timerDuration: 7, // 7 segundos por jogada
          players: playersPlaceholders,
          isTournament: true,
          matchId: match.matchId,
          tournamentId: tournament._id,
          isGameConcluded: false,
          expectedPlayers: [match.player1, match.player2],
        };

        console.log(
          `[DEBUG tournament] criada sala ${roomCode} para match=${
            match.matchId
          } players=${playersPlaceholders.map((p) => p.user.email).join(",")}`
        );

        // Se sockets estão online, faça com que entrem na sala para receber eventos
        try {
          const room = gameRooms[roomCode];
          for (const p of room.players) {
            if (p.socketId) {
              const s = io.sockets.sockets.get(p.socketId);
              if (s) {
                try {
                  s.join(roomCode);
                } catch (e) {}
                // Preenche dados do usuário a partir do socket quando disponíveis
                if (s.userData) p.user = s.userData;
              } else {
                // socket desconectado entre fetchSockets e agora
                p.socketId = null;
              }
            }
          }
        } catch (e) {
          console.error("Erro ao juntar sockets à sala do torneio:", e);
        }

        io.emit("tournamentMatchReady", {
          matchId: match.matchId,
          player1: match.player1,
          player2: match.player2,
          roomCode: roomCode,
        });

        // Iniciamos a sala e o jogo mesmo que os jogadores não estejam conectados.
        // O jogo será iniciado pelo servidor chamando a lógica de jogo diretamente,
        // permitindo que ausentes sejam tratados por timeout/auto-pass na camada
        // do jogo (`scheduleTurnInactivity`).
        try {
          // Start game immediately (placeholders com socketId === null são permitidos)
          const room = gameRooms[roomCode];
          if (room) {
            // Import dinâmico para evitar dependência circular
            const { startGameLogic } = require("./socketHandlers");
            if (startGameLogic) {
              console.log(
                `[DEBUG tournament] chamando startGameLogic para sala ${roomCode}`
              );
              startGameLogic(room);
            }
          }
        } catch (e) {
          console.error("Erro iniciando partida de torneio:", e);
        }
      } else {
        console.error(
          "[Torneio] CRÍTICO: gameRooms não definido no processRoundMatches"
        );
      }
    }
  }
  await tournament.save();
}

async function handleTournamentGameEnd(winnerEmail, loserEmail, room) {
  if (!room.isTournament || !room.tournamentId) return;

  const tournament = await Tournament.findById(room.tournamentId);
  if (!tournament) return;

  const matchIndex = tournament.matches.findIndex(
    (m) => m.matchId === room.matchId
  );
  if (matchIndex === -1) return;

  // Se não houve jogo (W.O. direto)
  if (!room.game) {
    tournament.matches[matchIndex].winner = winnerEmail;
    tournament.matches[matchIndex].status = "finished";
    await tournament.save();
    console.log(
      `[Torneio] Partida ${room.matchId} finalizada por W.O. Vencedor: ${winnerEmail}`
    );
    checkRoundCompletion(tournament);
    return;
  }

  // Caso especial: ambos forfeitaram (nenhum movimento) — marcar como finalizado sem vencedor
  if (winnerEmail === "BOTH_FORFEIT") {
    tournament.matches[matchIndex].winner = null;
    tournament.matches[matchIndex].status = "finished";
    await tournament.save();
    console.log(
      `[Torneio] Partida ${room.matchId} finalizada: Ambos desistiram por inatividade.`
    );
    io.emit("tournamentMatchEnded", {
      matchId: room.matchId,
      reason: "Ambos ausentes: desclassificados.",
    });
    // Forçar retorno ao lobby dos jogadores conectados (se houver socketId)
    try {
      if (room && room.players && room.players.length > 0) {
        for (const p of room.players) {
          if (p && p.socketId) {
            try {
              const s = io.sockets.sockets.get(p.socketId);
              if (s) s.emit("forceReturnToLobby");
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    checkRoundCompletion(tournament);
    return;
  }

  // Se houve jogo mas deu empate (Timer ou Regra de Empate)
  if (!winnerEmail) {
    console.log(
      `[Torneio] Empate na partida ${room.matchId}. Iniciando desempate (Tablita 5s)...`
    );

    io.to(room.roomCode).emit("tournamentTieBreak", {
      winner: null,
      reason: "Empate! Iniciando revanche imediata: Tablita (5s).",
    });

    const newRoomCode = `TRN-TB-${Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}`;

    tournament.matches[matchIndex].roomCode = newRoomCode;
    await tournament.save();

    if (gameRooms) {
      gameRooms[newRoomCode] = {
        roomCode: newRoomCode,
        bet: 0,
        gameMode: "tablita",
        timeControl: "move",
        timerDuration: 5,
        players: [],
        isTournament: true,
        matchId: room.matchId,
        tournamentId: tournament._id,
        isGameConcluded: false,
        expectedPlayers: room.expectedPlayers,
      };

      io.emit("tournamentMatchReady", {
        matchId: room.matchId,
        player1: room.expectedPlayers[0],
        player2: room.expectedPlayers[1],
        roomCode: newRoomCode,
      });

      setTimeout(async () => {
        const r = gameRooms[newRoomCode];
        if (r && !r.isGameConcluded && r.players.length < 2) {
          console.log(
            `[Torneio] Sala de Desempate ${newRoomCode} expirou. Aplicando W.O.`
          );

          const p1 = r.expectedPlayers[0];
          const p2 = r.expectedPlayers[1];
          const joined = r.players.map((p) => p.user.email);

          let winner = null;
          if (joined.includes(p1) && !joined.includes(p2)) winner = p1;
          else if (joined.includes(p2) && !joined.includes(p1)) winner = p2;
          else winner = Math.random() < 0.5 ? p1 : p2;

          await handleTournamentGameEnd(winner, null, r);

          if (gameRooms[newRoomCode]) delete gameRooms[newRoomCode];
        }
      }, 60 * 1000);
    }
    return;
  }

  // Vitória normal
  tournament.matches[matchIndex].winner = winnerEmail;
  tournament.matches[matchIndex].status = "finished";

  await tournament.save();
  console.log(
    `[Torneio] Partida ${room.matchId} finalizada. Vencedor: ${winnerEmail}`
  );

  // Forçar retorno ao lobby de todos os jogadores desta partida (tanto vencedor quanto perdedor)
  try {
    if (room && room.players && room.players.length > 0) {
      for (const p of room.players) {
        if (p && p.socketId) {
          try {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.emit("forceReturnToLobby");
          } catch (e) {
            console.error(
              "Erro emitindo forceReturnToLobby para jogador do torneio:",
              e
            );
          }
        }
      }
    }
  } catch (e) {}

  // Funcionalidade "Assistir Oponente"
  if (winnerEmail) {
    const currentRoundMatches = tournament.matches.filter(
      (m) => m.round === tournament.round
    );
    const myRelativeIndex = currentRoundMatches.findIndex(
      (m) => m.matchId === room.matchId
    );

    if (myRelativeIndex !== -1) {
      // Se índice par, oponente vem do próximo. Se ímpar, do anterior.
      const siblingIndex =
        myRelativeIndex % 2 === 0 ? myRelativeIndex + 1 : myRelativeIndex - 1;

      if (siblingIndex >= 0 && siblingIndex < currentRoundMatches.length) {
        const siblingMatch = currentRoundMatches[siblingIndex];
        if (siblingMatch.status === "active" && siblingMatch.roomCode) {
          const winnerPlayer = room.players.find(
            (p) => p.user.email === winnerEmail
          );
          if (winnerPlayer && io) {
            io.to(winnerPlayer.socketId).emit("tournamentSpectateOpponent", {
              roomCode: siblingMatch.roomCode,
            });
          }
        }
      }
    }
  }

  checkRoundCompletion(tournament);
}

async function checkRoundCompletion(tournament) {
  const currentRoundMatches = tournament.matches.filter(
    (m) => m.round === tournament.round
  );
  const allFinished = currentRoundMatches.every((m) => m.status === "finished");

  if (allFinished) {
    console.log(`[Torneio] Rodada ${tournament.round} finalizada.`);

    const winners = currentRoundMatches.map((m) => m.winner).filter((w) => w);

    if (winners.length === 1) {
      await distributePrizes(tournament, winners[0]);
    } else {
      tournament.round++;
      const nextMatches = [];

      for (let i = 0; i < winners.length; i += 2) {
        const p1 = winners[i];
        const p2 = winners[i + 1] || null;

        nextMatches.push({
          matchId: `R${tournament.round}-M${nextMatches.length + 1}`,
          round: tournament.round,
          player1: p1,
          player2: p2,
          winner: p2 ? null : p1,
          status: p2 ? "pending" : "finished",
          roomCode: null,
        });
      }

      tournament.matches.push(...nextMatches);
      await tournament.save();

      io.emit("tournamentRoundUpdate", {
        round: tournament.round,
        bracket: nextMatches,
      });
      processRoundMatches(tournament);
    }
  }
}

async function distributePrizes(tournament, championEmail) {
  const finalMatch = tournament.matches.find(
    (m) => m.round === tournament.round
  );
  const runnerUpEmail =
    finalMatch.player1 === championEmail
      ? finalMatch.player2
      : finalMatch.player1;

  tournament.winner = championEmail;
  tournament.runnerUp = runnerUpEmail;
  tournament.status = "completed";

  const totalPool = tournament.prizePool;
  const championPrize = totalPool * 0.7; // 70% para o campeão
  const runnerUpPrize = totalPool * 0.3; // 30% para o vice

  if (championEmail) {
    const updatedChampion = await User.findOneAndUpdate(
      { email: championEmail },
      { $inc: { saldo: championPrize } },
      { new: true }
    );
    if (updatedChampion)
      io.emit("balanceUpdate", {
        email: championEmail,
        newSaldo: updatedChampion.saldo,
      });
  }
  if (runnerUpEmail) {
    const updatedRunnerUp = await User.findOneAndUpdate(
      { email: runnerUpEmail },
      { $inc: { saldo: runnerUpPrize } },
      { new: true }
    );
    if (updatedRunnerUp)
      io.emit("balanceUpdate", {
        email: runnerUpEmail,
        newSaldo: updatedRunnerUp.saldo,
      });
  }

  await tournament.save();

  io.emit("tournamentEnded", {
    winner: championEmail,
    runnerUp: runnerUpEmail,
    championPrize,
    runnerUpPrize,
  });

  console.log(
    `[Torneio] Finalizado. Campeão: ${championEmail} (+${championPrize}), Vice: ${runnerUpEmail} (+${runnerUpPrize})`
  );

  // Forçar retorno ao lobby dos finalistas (se estiverem conectados)
  try {
    const sockets = await io.fetchSockets();
    sockets.forEach((sock) => {
      try {
        if (!sock.userData || !sock.userData.email) return;
        const email = sock.userData.email;
        if (email === championEmail || email === runnerUpEmail) {
          sock.emit("forceReturnToLobby");
        }
      } catch (e) {}
    });
  } catch (e) {}
}

async function recoverStuckTournaments() {
  try {
    const stuck = await Tournament.find({ status: "active" });
    if (stuck.length > 0) {
      console.log(
        `[Torneio] Encontrados ${stuck.length} torneios travados. Cancelando e Reembolsando...`
      );
      for (const t of stuck) {
        await cancelTournamentAndRefund(
          t,
          "Torneio interrompido por reinício do servidor."
        );
      }
    }
  } catch (err) {
    console.error("Erro ao recuperar torneios:", err);
  }
}

module.exports = {
  initializeTournamentManager,
  registerPlayer,
  unregisterPlayer,
  handleTournamentGameEnd,
  getTodaysTournament,
};
