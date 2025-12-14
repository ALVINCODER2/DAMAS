const Tournament = require("../models/Tournament");
const User = require("../models/User");
const { gameRooms } = require("./socketHandlers");

// Configurações
const MIN_PLAYERS = 8;
const ENTRY_FEE = 2.0;
const TOURNAMENT_HOUR = 21; // ALTERADO PARA 21:00
const TOURNAMENT_MINUTE = 0;

let io; // Referência ao Socket.IO
let checkInterval;

function initializeTournamentManager(ioInstance) {
  io = ioInstance;

  // Verifica o horário a cada 30 segundos
  checkInterval = setInterval(checkSchedule, 30 * 1000);
  console.log("[Torneio] Gerenciador iniciado. Agendado para 21:00 BRT.");
}

async function getTodaysTournament() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  let tournament = await Tournament.findOne({
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    status: { $ne: "cancelled" },
  });

  if (!tournament) {
    // Cria um novo se não existir para hoje
    tournament = new Tournament({
      entryFee: ENTRY_FEE,
      status: "open",
      participants: [],
    });
    await tournament.save();
  }
  return tournament;
}

// Verifica se está na hora de começar
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
    const tournament = await getTodaysTournament();
    if (tournament.status === "open") {
      startTournament(tournament);
    }
  }
}

async function registerPlayer(email) {
  const tournament = await getTodaysTournament();

  if (tournament.status !== "open") {
    return {
      success: false,
      message: "Inscrições encerradas ou torneio em andamento.",
    };
  }
  if (tournament.participants.includes(email)) {
    return { success: false, message: "Você já está inscrito." };
  }

  const user = await User.findOne({ email });
  if (!user || user.saldo < tournament.entryFee) {
    return { success: false, message: "Saldo insuficiente para inscrição." };
  }

  // Deduz saldo e inscreve
  user.saldo -= tournament.entryFee;
  await user.save();

  tournament.participants.push(email);
  tournament.prizePool += tournament.entryFee;
  await tournament.save();

  // Notifica a todos no lobby
  io.emit("tournamentUpdate", {
    participantsCount: tournament.participants.length,
    prizePool: tournament.prizePool,
  });

  return { success: true, message: "Inscrição realizada com sucesso!" };
}

// ### NOVO: FUNÇÃO PARA REMOVER INSCRIÇÃO ###
async function unregisterPlayer(email) {
  const tournament = await getTodaysTournament();

  if (tournament.status !== "open") {
    return {
      success: false,
      message: "Não é possível sair agora (Torneio já iniciou ou fechou).",
    };
  }
  if (!tournament.participants.includes(email)) {
    return { success: false, message: "Você não está inscrito." };
  }

  // Remove da lista
  tournament.participants = tournament.participants.filter((p) => p !== email);
  tournament.prizePool -= tournament.entryFee;
  if (tournament.prizePool < 0) tournament.prizePool = 0;
  await tournament.save();

  // Reembolsa o usuário
  const user = await User.findOne({ email });
  if (user) {
    user.saldo += tournament.entryFee;
    await user.save();
  }

  io.emit("tournamentUpdate", {
    participantsCount: tournament.participants.length,
    prizePool: tournament.prizePool,
  });

  return { success: true, message: "Inscrição cancelada e valor reembolsado." };
}

async function startTournament(tournament) {
  console.log("[Torneio] Verificando presença...");

  // 1. Identificar quem está ONLINE
  const onlineEmails = new Set();
  const sockets = await io.fetchSockets();

  sockets.forEach((socket) => {
    if (socket.userData && socket.userData.email) {
      onlineEmails.add(socket.userData.email);
    }
  });

  // 2. Separar presentes e ausentes
  // Clone para garantir que temos a lista original intacta para reembolso
  const originalParticipants = [...tournament.participants];
  const presentPlayers = [];
  const absentPlayers = [];

  originalParticipants.forEach((email) => {
    if (onlineEmails.has(email)) {
      presentPlayers.push(email);
    } else {
      absentPlayers.push(email);
    }
  });

  // 3. Tratar ausentes (W.O. - Perdem o valor)
  if (absentPlayers.length > 0) {
    console.log(
      `[Torneio] ${absentPlayers.length} jogadores ausentes. Eles perdem a inscrição (W.O.).`
    );
    // NÃO FAZEMOS REEMBOLSO AQUI. O valor continua no prizePool.
    // Apenas atualizamos a lista de participantes ATIVOS para criar a chave
    tournament.participants = presentPlayers;

    // O prizePool NÃO muda, pois o dinheiro dos ausentes fica para os vencedores.
    await tournament.save();

    io.emit("tournamentUpdate", {
      participantsCount: tournament.participants.length,
      prizePool: tournament.prizePool,
    });
  }

  // 4. Verificar quórum mínimo DE PRESENTES (para ter jogo)
  // CORREÇÃO: Usar MIN_PLAYERS (8) em vez de apenas 2.
  if (tournament.participants.length < MIN_PLAYERS) {
    console.log(
      `[Torneio] Cancelado: Apenas ${tournament.participants.length} jogadores online. Mínimo: ${MIN_PLAYERS}.`
    );
    tournament.status = "cancelled";
    await tournament.save();

    // Reembolsa TODOS da lista ORIGINAL (incluindo quem faltou, pois o evento não ocorreu)
    for (const email of originalParticipants) {
      const updatedUser = await User.findOneAndUpdate(
        { email },
        { $inc: { saldo: tournament.entryFee } },
        { new: true }
      );
      if (updatedUser) {
        io.emit("balanceUpdate", {
          email: updatedUser.email,
          newSaldo: updatedUser.saldo,
        });
      }
    }

    io.emit("tournamentCancelled", {
      message: `Torneio cancelado por falta de quórum (Mínimo ${MIN_PLAYERS} jogadores). Todos foram reembolsados.`,
    });
    return;
  }

  // Se tiver gente suficiente (mesmo que alguns tenham faltado e perdido o dinheiro)
  console.log(
    "[Torneio] Iniciando com " +
      tournament.participants.length +
      " jogadores presentes."
  );
  tournament.status = "active";

  const shuffled = tournament.participants.sort(() => 0.5 - Math.random());

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
  // Pega partidas pendentes da rodada atual
  const pendingMatches = tournament.matches.filter(
    (m) => m.round === tournament.round && m.status === "pending"
  );

  for (const match of pendingMatches) {
    if (match.player1 && match.player2) {
      // Cria sala de jogo
      const roomCode = `TRN-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;
      match.roomCode = roomCode;
      match.status = "active";

      // Criação manual da sala no objeto gameRooms importado
      const { gameRooms } = require("./socketHandlers");

      // Busca dados dos usuários para a sala
      const u1 = await User.findOne({ email: match.player1 });
      const u2 = await User.findOne({ email: match.player2 });

      gameRooms[roomCode] = {
        roomCode,
        bet: 0, // Sem aposta direta, prêmio é no final
        gameMode: "classic",
        timeControl: "move",
        timerDuration: 7, // Tempo por jogada no torneio é 7 segundos
        players: [], // Serão preenchidos quando eles conectarem via evento
        isTournament: true,
        matchId: match.matchId,
        tournamentId: tournament._id,
        isGameConcluded: false,

        // Pré-configuração para validação
        expectedPlayers: [match.player1, match.player2],
      };

      // Avisa os jogadores para entrarem
      io.emit("tournamentMatchReady", {
        matchId: match.matchId,
        player1: match.player1,
        player2: match.player2,
        roomCode: roomCode,
      });
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

  tournament.matches[matchIndex].winner = winnerEmail;
  tournament.matches[matchIndex].status = "finished";

  await tournament.save();
  console.log(`[Torneio] Partida ${room.matchId} venceu: ${winnerEmail}`);

  checkRoundCompletion(tournament);
}

async function checkRoundCompletion(tournament) {
  const currentRoundMatches = tournament.matches.filter(
    (m) => m.round === tournament.round
  );
  const allFinished = currentRoundMatches.every((m) => m.status === "finished");

  if (allFinished) {
    console.log(`[Torneio] Rodada ${tournament.round} finalizada.`);

    // Filtra os vencedores
    const winners = currentRoundMatches.map((m) => m.winner).filter((w) => w);

    if (winners.length === 1) {
      // Temos um campeão!
      await distributePrizes(tournament, winners[0]);
    } else {
      // Próxima rodada
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
  // Acha o vice (perdedor da final)
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
  // 50% Campeão
  const championPrize = totalPool * 0.5;
  // 30% Vice
  const runnerUpPrize = totalPool * 0.3;
  // 20% Banca (Fica no sistema, não fazemos nada)

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
}

module.exports = {
  initializeTournamentManager,
  registerPlayer,
  unregisterPlayer,
  handleTournamentGameEnd,
  getTodaysTournament,
};
