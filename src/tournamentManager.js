const Tournament = require("../models/Tournament");
const User = require("../models/User");
// Note: gameRooms is required inside functions to avoid circular dependency issues at startup if they exist
// const { gameRooms } = require("./socketHandlers");

// Configurações
const MIN_PLAYERS = 4;
const ENTRY_FEE = 2.0;
const TOURNAMENT_HOUR = 21;
const TOURNAMENT_MINUTE = 0;

let io; // Referência ao Socket.IO
let checkInterval;
let isProcessingStart = false; // Previne execução dupla do startTournament

function initializeTournamentManager(ioInstance) {
  io = ioInstance;

  // Verifica o horário a cada 30 segundos
  checkInterval = setInterval(checkSchedule, 30 * 1000);
  console.log(
    `[Torneio] Gerenciador iniciado. Agendado para ${TOURNAMENT_HOUR}:${TOURNAMENT_MINUTE.toString().padStart(
      2,
      "0"
    )} BRT.`
  );

  // Recupera e cancela torneios que ficaram travados (ex: crash do servidor ou bug anterior)
  recoverStuckTournaments();
}

async function getTodaysTournament() {
  // Busca o último torneio que esteja Aberto ou Ativo (independente da data)
  // Isso permite que, assim que um acabe, o sistema crie/use o próximo.
  let tournament = await Tournament.findOne({
    status: { $in: ["open", "active"] },
  }).sort({ createdAt: -1 });

  if (!tournament) {
    // Se não houver nenhum aberto (ex: o anterior foi 'completed' ou 'cancelled'),
    // cria um novo imediatamente para o próximo ciclo.
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
    if (isProcessingStart) return; // Já está iniciando

    isProcessingStart = true;
    // Reseta a flag após 65 segundos (garante que o minuto passou)
    setTimeout(() => {
      isProcessingStart = false;
    }, 65000);

    const tournament = await getTodaysTournament();
    if (tournament.status === "open") {
      startTournament(tournament).catch((err) =>
        console.error("Erro ao iniciar torneio:", err)
      );
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

// Função auxiliar para cancelar e reembolsar (usada em falhas e recuperação)
async function cancelTournamentAndRefund(tournament, reason) {
  if (tournament.status === "cancelled") return;

  console.log(
    `[Torneio] Cancelando torneio ${tournament._id}. Motivo: ${reason}`
  );
  tournament.status = "cancelled";
  await tournament.save();

  // Reembolsa participantes
  for (const email of tournament.participants) {
    const updatedUser = await User.findOneAndUpdate(
      { email },
      { $inc: { saldo: tournament.entryFee } },
      { new: true }
    );
    if (updatedUser && io) {
      io.emit("balanceUpdate", {
        email: updatedUser.email,
        newSaldo: updatedUser.saldo,
      });
    }
  }

  // Limpa salas de jogo da memória se existirem
  if (tournament.matches) {
    const { gameRooms } = require("./socketHandlers");
    tournament.matches.forEach((m) => {
      if (m.roomCode && gameRooms[m.roomCode]) delete gameRooms[m.roomCode];
    });
  }

  if (io) io.emit("tournamentCancelled", { message: reason });
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

  console.log(
    "[Torneio] Jogadores Online Detectados:",
    Array.from(onlineEmails)
  );

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
  // CORREÇÃO: Usar MIN_PLAYERS (4) em vez de apenas 2.
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
        timerDuration: 60, // Tempo por jogada no torneio (ajustado de 7 para 60s)
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

      // Timeout de segurança: Se a partida não iniciar em 60s (jogadores não entrarem), cancela tudo
      setTimeout(async () => {
        const { gameRooms } = require("./socketHandlers");
        const room = gameRooms[roomCode];
        // Se a sala ainda existe, o jogo não acabou e não tem 2 jogadores
        if (room && !room.isGameConcluded && room.players.length < 2) {
          console.log(`[Torneio] Sala ${roomCode} expirou. Aplicando W.O.`);

          // Lógica de W.O.
          const p1 = match.player1;
          const p2 = match.player2;
          const joined = room.players.map((p) => p.user.email);

          let winner = null;
          // Se P1 entrou e P2 não
          if (joined.includes(p1) && !joined.includes(p2)) winner = p1;
          // Se P2 entrou e P1 não
          else if (joined.includes(p2) && !joined.includes(p1)) winner = p2;
          // Se ninguém entrou, sorteio para não travar o torneio
          else winner = Math.random() < 0.5 ? p1 : p2;

          // Registra o fim da partida por W.O.
          await handleTournamentGameEnd(winner, null, room);

          // Limpa a sala
          if (gameRooms[roomCode]) delete gameRooms[roomCode];
        }
      }, 60 * 1000);
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

  // ### PROTEÇÃO CONTRA W.O. (Jogo não iniciado) ###
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

  // #######################################################
  // ### LÓGICA DE EMPATE: CONTAGEM DE PEÇAS & SORTEIO ###
  // #######################################################
  if (!winnerEmail) {
    console.log(
      `[Torneio] Empate na partida ${room.matchId}. Aplicando regras de desempate...`
    );

    // 1. Contagem de Peças
    let whitePieces = 0;
    let blackPieces = 0;
    const board = room.game.boardState;
    const size = room.game.boardSize;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const p = board[r][c];
        if (p !== 0) {
          if (p.toString().toLowerCase() === "b") whitePieces++;
          if (p.toString().toLowerCase() === "p") blackPieces++;
        }
      }
    }

    const whiteEmail = room.game.users.white;
    const blackEmail = room.game.users.black;
    let decidedWinner = null;
    let decisionReason = "";

    if (whitePieces > blackPieces) {
      decidedWinner = whiteEmail;
      decisionReason = `Vitória por contagem de peças (${whitePieces} vs ${blackPieces}).`;
    } else if (blackPieces > whitePieces) {
      decidedWinner = blackEmail;
      decisionReason = `Vitória por contagem de peças (${blackPieces} vs ${whitePieces}).`;
    } else {
      // 2. Sorteio Automático (Peças Iguais)
      const isWhiteWinner = Math.random() < 0.5;
      decidedWinner = isWhiteWinner ? whiteEmail : blackEmail;
      decisionReason = `Empate em peças (${whitePieces}). Decisão por SORTEIO: ${
        isWhiteWinner ? "Brancas" : "Pretas"
      } venceram.`;
    }

    // Aplica o vencedor decidido
    winnerEmail = decidedWinner;

    // Notifica na sala quem venceu pelo critério
    io.to(room.roomCode).emit("tournamentTieBreak", {
      winner: winnerEmail,
      reason: decisionReason,
    });

    console.log(`[Torneio] Desempate: ${decisionReason}`);
  }
  // #######################################################

  tournament.matches[matchIndex].winner = winnerEmail;
  tournament.matches[matchIndex].status = "finished";

  await tournament.save();
  console.log(
    `[Torneio] Partida ${room.matchId} finalizada. Vencedor: ${winnerEmail}`
  );

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
  // 70% Campeão (Sem taxa da banca)
  const championPrize = totalPool * 0.7;
  // 30% Vice
  const runnerUpPrize = totalPool * 0.3;
  // 0% Banca

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

async function recoverStuckTournaments() {
  try {
    const stuck = await Tournament.find({ status: "active" });
    if (stuck.length > 0) {
      console.log(
        `[Torneio] Encontrados ${stuck.length} torneios travados. Cancelando...`
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
