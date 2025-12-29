const path = require("path");
const gameLogic = require(path.resolve(__dirname, "../public/js/gameLogic.js"));

function log(...args) {
  console.log(...args);
}

const board = [
  [0, 0, 0, "p", 0, "p", 0, 0],
  ["p", 0, "p", 0, "p", 0, "b", 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  ["b", 0, 0, 0, 0, 0, "b", 0],
  [0, 0, 0, 0, 0, 0, 0, "b"],
  ["b", 0, 0, 0, "b", 0, "p", 0],
  [0, 0, 0, "b", 0, "b", 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

function cloneBoard(b) {
  return JSON.parse(JSON.stringify(b));
}

async function reproduce() {
  const game = {
    boardState: cloneBoard(board),
    boardSize: 8,
    currentPlayer: "b",
    turnCapturedPieces: [],
  };

  // Try both players and pick the one with 2 mandatory pieces if found
  const players = ["b", "p"];
  let chosenPlayer = null;
  let bestSeqs = null;
  for (const pl of players) {
    const seqs = gameLogic.findBestCaptureMoves(pl, game);
    const starts = new Set(seqs.map((s) => `${s[0].row},${s[0].col}`));
    log(
      `player ${pl} -> ${seqs.length} sequences, unique starting pieces: ${starts.size}`
    );
    if (starts.size === 2) {
      chosenPlayer = pl;
      bestSeqs = seqs;
      break;
    }
    if (!chosenPlayer && seqs.length > 0) {
      chosenPlayer = pl;
      bestSeqs = seqs;
    }
  }

  if (!chosenPlayer) {
    log("Nenhum movimento de captura encontrado para nenhum jogador.");
    process.exit(2);
  }

  log("Escolhido jogador:", chosenPlayer);

  // pick first sequence overall (automatic choice)
  const seq = bestSeqs[0];
  log("Sequência escolhida:", seq);

  // simulate step-by-step like client: do NOT remove captured pieces until sequence ends
  const simGame = {
    boardState: cloneBoard(game.boardState),
    boardSize: game.boardSize,
    currentPlayer: chosenPlayer,
    turnCapturedPieces: [],
  };

  const capturedList = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const from = seq[i];
    const to = seq[i + 1];
    log(
      `Validando passo ${i + 1}: from ${from.row},${from.col} -> to ${to.row},${
        to.col
      }`
    );
    const res = gameLogic.isMoveValid(from, to, chosenPlayer, simGame, false);
    log("isMoveValid =>", res);
    if (!res || !res.valid) {
      log("Movimento inválido detectado durante reprodução. Saindo.");
      process.exit(3);
    }

    // apply move (do not remove captured pieces yet)
    const piece = simGame.boardState[from.row][from.col];
    simGame.boardState[to.row][to.col] = piece;
    simGame.boardState[from.row][from.col] = 0;

    if (res.isCapture && res.capturedPos) {
      if (Array.isArray(res.capturedPos))
        res.capturedPos.forEach((p) => capturedList.push(p));
      else capturedList.push(res.capturedPos);
      simGame.turnCapturedPieces = capturedList.slice();
    }
  }

  log("Sequência aplicada sem erros. Capturados acumulados:", capturedList);

  // finalize: remove captured pieces
  for (const p of capturedList) {
    if (
      simGame.boardState[p.row] &&
      typeof simGame.boardState[p.row][p.col] !== "undefined"
    ) {
      simGame.boardState[p.row][p.col] = 0;
    }
  }

  log("Estado final do tabuleiro após aplicação da sequência:");
  console.table(simGame.boardState);
  log("Reprodução concluída com sucesso.");
}

reproduce().catch((err) => {
  console.error("Erro durante reprodução:", err && err.stack ? err.stack : err);
  process.exit(99);
});
