// src/sharedGameLogic.js
// Lógica de regras puras otimizada para o Servidor

function isValidPos(r, c, size) {
  return r >= 0 && r < size && c >= 0 && c < size;
}

function isMyPiece(piece, playerColor) {
  if (!piece) return false;
  return piece.toLowerCase() === playerColor; // 'b' ou 'p'
}

function isEnemy(piece, myColor) {
  if (!piece) return false;
  const p = piece.toLowerCase();
  const me = myColor.toLowerCase();
  return p !== me && (p === "b" || p === "p");
}

// Helper: Verifica se posição está na lista de capturadas
function isCaptured(row, col, list) {
  if (!list || list.length === 0) return false;
  return list.some((p) => p.row === row && p.col === col);
}

// Retorna SEQUÊNCIAS de captura: [ [{r,c}, {r,c}], ... ]
function findBestCaptureMoves(playerColor, game) {
  let bestMoves = [];
  let maxCaptures = 0;
  const boardSize = game.boardSize || 8;
  const capturedFromStart = game.turnCapturedPieces || [];

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const piece = game.boardState[r][c];
      // Verifica se a peça existe, é minha e NÃO foi capturada neste turno (fantasma)
      if (
        piece !== 0 &&
        piece.toLowerCase() === playerColor &&
        !isCaptured(r, c, capturedFromStart)
      ) {
        const isDama = piece === piece.toUpperCase();

        // Passamos uma cópia leve do tabuleiro apenas se necessário,
        // mas aqui usamos backtracking lógico sem clonar o board inteiro a cada passo para performance
        const sequences = findCaptureSequencesForPiece(
          r,
          c,
          game.boardState,
          isDama,
          boardSize,
          capturedFromStart,
          piece // Passa a peça atual para saber a cor do oponente
        );

        sequences.forEach((seq) => {
          const numCaptures = seq.length - 1; // Sequência inclui origem, então capturas = length - 1
          if (numCaptures > maxCaptures) {
            maxCaptures = numCaptures;
            bestMoves = [seq];
          } else if (numCaptures === maxCaptures && maxCaptures > 0) {
            bestMoves.push(seq);
          }
        });
      }
    }
  }
  return bestMoves;
}

function findCaptureSequencesForPiece(
  row,
  col,
  board,
  isDama,
  boardSize,
  capturedSoFar,
  currentPieceChar
) {
  let sequences = [];
  const opponentColor = currentPieceChar.toLowerCase() === "b" ? "p" : "b";

  const directions = [
    { r: -1, c: -1 },
    { r: -1, c: 1 },
    { r: 1, c: -1 },
    { r: 1, c: 1 },
  ];

  for (const dir of directions) {
    if (isDama) {
      // Lógica Dama
      for (let i = 1; i < boardSize; i++) {
        const checkRow = row + i * dir.r;
        const checkCol = col + i * dir.c;

        if (!isValidPos(checkRow, checkCol, boardSize)) break;

        const pieceOnPath = board[checkRow][checkCol];

        if (pieceOnPath !== 0) {
          // Bloqueio por peça já capturada ou amiga
          if (isCaptured(checkRow, checkCol, capturedSoFar)) break;
          if (pieceOnPath.toLowerCase() !== opponentColor) break; // Amiga

          // Achou inimiga. Verifica pouso.
          const capturedPos = { row: checkRow, col: checkCol };

          // Verifica casas após a peça inimiga
          for (let j = 1; j < boardSize; j++) {
            const landRow = checkRow + j * dir.r;
            const landCol = checkCol + j * dir.c;

            if (!isValidPos(landRow, landCol, boardSize)) break;

            // Se encontrar qualquer peça no pouso (viva ou morta), para
            if (board[landRow][landCol] !== 0) break;

            // Simula passo
            const newCapturedSoFar = [...capturedSoFar, capturedPos];

            // Simulação "virtual": movemos a peça no argumento das próximas chamadas
            // Não alteramos o board real aqui para evitar clone pesado
            // Mas precisamos garantir que a recursão "veja" o board alterado.
            // Para performance em JS, clonar array 8x8 é aceitável, mas vamos otimizar:
            // Criamos um board temporário APENAS para a recursão profunda se houver captura múltipla

            const tempBoard = cloneBoard(board);
            tempBoard[landRow][landCol] = tempBoard[row][col];
            tempBoard[row][col] = 0;
            // IMPORTANTE: NÃO remove a peça capturada do tempBoard (regra brasileira)

            const nextSequences = findCaptureSequencesForPiece(
              landRow,
              landCol,
              tempBoard,
              true,
              boardSize,
              newCapturedSoFar,
              currentPieceChar
            );

            if (nextSequences.length > 0) {
              nextSequences.forEach((seq) =>
                sequences.push([{ row, col }, ...seq])
              );
            } else {
              sequences.push([
                { row, col },
                { row: landRow, col: landCol },
              ]);
            }
          }
          // Após encontrar a primeira peça na diagonal e testar seus pousos, para essa direção.
          break;
        }
      }
    } else {
      // Lógica Peça Comum
      const capRow = row + dir.r;
      const capCol = col + dir.c;
      const landRow = row + 2 * dir.r;
      const landCol = col + 2 * dir.c;

      if (isValidPos(landRow, landCol, boardSize)) {
        const pieceToCap = board[capRow][capCol];
        const landSpot = board[landRow][landCol];

        if (
          pieceToCap !== 0 &&
          pieceToCap.toLowerCase() === opponentColor &&
          landSpot === 0 &&
          !isCaptured(capRow, capCol, capturedSoFar)
        ) {
          const newCapturedSoFar = [
            ...capturedSoFar,
            { row: capRow, col: capCol },
          ];

          const tempBoard = cloneBoard(board);
          tempBoard[landRow][landCol] = tempBoard[row][col];
          tempBoard[row][col] = 0;

          // Verifica se virou Dama no meio da captura?
          // Regra Brasileira: Se passar pela coroa mas tiver que continuar comendo, NÃO vira dama.
          // Só vira se PARAR na coroa. Então passamos isDama = false na recursão.

          const nextSequences = findCaptureSequencesForPiece(
            landRow,
            landCol,
            tempBoard,
            false, // Continua como peça comum
            boardSize,
            newCapturedSoFar,
            currentPieceChar
          );

          if (nextSequences.length > 0) {
            nextSequences.forEach((seq) =>
              sequences.push([{ row, col }, ...seq])
            );
          } else {
            sequences.push([
              { row, col },
              { row: landRow, col: landCol },
            ]);
          }
        }
      }
    }
  }
  return sequences;
}

function cloneBoard(board) {
  return board.map((row) => [...row]);
}

function isMoveValid(from, to, playerColor, game, ignoreMajorityRule = false) {
  const board = game.boardState;
  const boardSize = game.boardSize || 8;
  const capturedFromStart = game.turnCapturedPieces || [];

  if (!board[from.row] || !board[to.row])
    return { valid: false, reason: "Inválido" };

  // Se a peça de origem já foi capturada (fantasma), erro
  if (isCaptured(from.row, from.col, capturedFromStart))
    return { valid: false, reason: "Peça capturada" };

  const piece = board[from.row][from.col];
  if (piece === 0 || piece.toLowerCase() !== playerColor)
    return { valid: false, reason: "Não é sua peça" };
  if (board[to.row][to.col] !== 0)
    return { valid: false, reason: "Destino ocupado" };

  // Validação Captura Obrigatória Específica (Cadeia)
  if (game.mustCaptureWith) {
    if (
      from.row !== game.mustCaptureWith.row ||
      from.col !== game.mustCaptureWith.col
    ) {
      return {
        valid: false,
        reason: "Deve continuar capturando com a mesma peça",
      };
    }
  }

  // Lei da Maioria Global
  if (!ignoreMajorityRule) {
    const bestCaptures = findBestCaptureMoves(playerColor, game);
    // Se existem capturas disponíveis
    if (bestCaptures.length > 0) {
      // Verifica se o movimento atual faz parte de ALGUMA das melhores sequências
      // O movimento é válido se coincidir com o início (seq[0] -> seq[1]) de uma melhor captura
      const isOptimal = bestCaptures.some(
        (seq) =>
          seq[0].row === from.row &&
          seq[0].col === from.col &&
          seq[1].row === to.row &&
          seq[1].col === to.col
      );

      if (!isOptimal) {
        // Se é captura mas não a máxima? (Regra diz MAX captures)
        // O código findBestCaptureMoves já filtra pelo maxCaptures.
        return {
          valid: false,
          reason: "Lei da Maioria: Existe captura melhor ou obrigatória.",
        };
      }
    }
  }

  // Validação Física do Movimento
  let result = null;
  const isDama = piece === "B" || piece === "P";

  if (isDama) {
    result = getDamaMove(
      from,
      to,
      playerColor,
      board,
      boardSize,
      capturedFromStart
    );
  } else {
    result = getNormalPieceMove(
      from,
      to,
      playerColor,
      board,
      boardSize,
      capturedFromStart
    );
  }

  // Se não for captura, mas houver capturas disponíveis no tabuleiro (já validado acima pela MajorityRule,
  // mas reforço para movimentos simples vs captura qualquer)
  if (!ignoreMajorityRule && !result.isCapture) {
    const anyCapture = findBestCaptureMoves(playerColor, game);
    if (anyCapture.length > 0) {
      return { valid: false, reason: "Captura obrigatória!" };
    }
  }

  return result || { valid: false, reason: "Movimento ilegal" };
}

function getNormalPieceMove(
  from,
  to,
  playerColor,
  board,
  boardSize,
  capturedList
) {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  if (absDr !== absDc) return { valid: false };

  // Movimento Simples
  if (absDr === 1) {
    const forward = playerColor === "b" ? -1 : 1;
    if (dr !== forward)
      return { valid: false, reason: "Pedra só anda pra frente" };
    return { valid: true, isCapture: false };
  }

  // Captura
  if (absDr === 2) {
    const midR = from.row + dr / 2;
    const midC = from.col + dc / 2;
    const midPiece = board[midR][midC];

    if (isCaptured(midR, midC, capturedList))
      return { valid: false, reason: "Já capturado" };
    if (midPiece === 0) return { valid: false };
    if (midPiece.toLowerCase() === playerColor)
      return { valid: false, reason: "Não pode comer própria cor" };

    return {
      valid: true,
      isCapture: true,
      capturedPos: { row: midR, col: midC },
    };
  }

  return { valid: false };
}

function getDamaMove(from, to, playerColor, board, boardSize, capturedList) {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (Math.abs(dr) !== Math.abs(dc)) return { valid: false };

  const stepR = Math.sign(dr);
  const stepC = Math.sign(dc);

  let currentR = from.row + stepR;
  let currentC = from.col + stepC;
  let captured = null;

  while (currentR !== to.row) {
    const p = board[currentR][currentC];

    if (p !== 0) {
      // Se encontrar peça
      if (isCaptured(currentR, currentC, capturedList))
        return { valid: false, reason: "Bloqueio (Peça morta)" };
      if (p.toLowerCase() === playerColor)
        return { valid: false, reason: "Bloqueio (Aliada)" };

      if (captured) return { valid: false, reason: "Não pode pular 2 peças" };
      captured = { row: currentR, col: currentC };
    }

    currentR += stepR;
    currentC += stepC;
  }

  return { valid: true, isCapture: !!captured, capturedPos: captured };
}

function getAllPossibleCapturesForPiece(row, col, game) {
  const board = game.boardState;
  const boardSize = game.boardSize || 8;
  const capturedFromStart = game.turnCapturedPieces || [];
  const piece = board[row][col];
  if (!piece) return [];
  const isDama = piece === piece.toUpperCase();

  return findCaptureSequencesForPiece(
    row,
    col,
    board,
    isDama,
    boardSize,
    capturedFromStart,
    piece
  );
}

function hasValidMoves(playerColor, game) {
  // Otimização: Verifica apenas se existe algum movimento válido simples ou captura
  const best = findBestCaptureMoves(playerColor, game);
  if (best.length > 0) return true;

  const boardSize = game.boardSize;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (isMyPiece(game.boardState[r][c], playerColor)) {
        // Tenta 4 direções simples
        const dirs = [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ];
        for (let d of dirs) {
          const toR = r + d[0];
          const toC = c + d[1];
          // Validação rápida sem deep checks de maioria (pois já checamos acima)
          if (
            isValidPos(toR, toC, boardSize) &&
            game.boardState[toR][toC] === 0
          ) {
            // Valida direção da pedra
            const p = game.boardState[r][c];
            const isDama = p === "B" || p === "P";
            if (!isDama) {
              const forward = playerColor === "b" ? -1 : 1;
              if (d[0] !== forward) continue;
            }
            return true;
          }
          // Se for Dama, checar longo alcance
          if (game.boardState[r][c] === "B" || game.boardState[r][c] === "P") {
            // Se a adjacente estiver livre, dama move
            if (
              isValidPos(toR, toC, boardSize) &&
              game.boardState[toR][toC] === 0
            )
              return true;
          }
        }
      }
    }
  }
  return false;
}

function getUniqueCaptureMove(row, col, game) {
  const seqs = getAllPossibleCapturesForPiece(row, col, game);
  if (seqs.length === 0) return null;

  // Verifica se todos os caminhos levam ao mesmo destino imediato
  const firstSteps = new Set();
  seqs.forEach((s) => {
    if (s.length > 1) firstSteps.add(`${s[1].row},${s[1].col}`);
  });

  if (firstSteps.size === 1) {
    const coords = firstSteps.values().next().value.split(",");
    return { to: { row: parseInt(coords[0]), col: parseInt(coords[1]) } };
  }
  return null;
}

function checkWinCondition(boardState, boardSize) {
  let white = false;
  let black = false;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const p = boardState[r][c];
      if (p !== 0) {
        if (p.toLowerCase() === "b") white = true;
        if (p.toLowerCase() === "p") black = true;
      }
    }
  }
  if (!white) return "p";
  if (!black) return "b";
  return null;
}

module.exports = {
  isMoveValid,
  checkWinCondition,
  hasValidMoves,
  getAllPossibleCapturesForPiece,
  findBestCaptureMoves,
  getUniqueCaptureMove,
};
