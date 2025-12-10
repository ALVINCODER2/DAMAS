// src/gameLogic.js (ATUALIZADO PARA SUPORTE A CAPTURA AUTOMÁTICA)

function findBestCaptureMoves(playerColor, game) {
  let bestMoves = [];
  let maxCaptures = 0;
  const boardSize = game.boardSize || 8;

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const piece = game.boardState[r][c];
      if (piece !== 0 && piece.toLowerCase() === playerColor) {
        const isDama = piece === piece.toUpperCase();
        const sequences = findCaptureSequencesForPiece(
          r,
          c,
          game.boardState,
          isDama,
          boardSize
        );
        sequences.forEach((seq) => {
          const numCaptures = seq.length - 1;
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

function findCaptureSequencesForPiece(row, col, board, isDama, boardSize) {
  let sequences = [];
  const piece = board[row][col];
  if (piece === 0) return [];
  const opponentColor = piece.toLowerCase() === "b" ? "p" : "b";
  const directions = [
    { r: -1, c: -1 },
    { r: -1, c: 1 },
    { r: 1, c: -1 },
    { r: 1, c: 1 },
  ];

  for (const dir of directions) {
    if (isDama) {
      let capturedPos = null;
      for (let i = 1; i < boardSize; i++) {
        const nextRow = row + i * dir.r;
        const nextCol = col + i * dir.c;
        if (
          nextRow < 0 ||
          nextRow >= boardSize ||
          nextCol < 0 ||
          nextCol >= boardSize
        )
          break;
        const pieceOnPath = board[nextRow][nextCol];
        if (pieceOnPath !== 0) {
          if (
            pieceOnPath.toLowerCase() === opponentColor &&
            board[nextRow + dir.r]?.[nextCol + dir.c] === 0
          ) {
            capturedPos = { row: nextRow, col: nextCol };
            for (let j = 1; j < boardSize; j++) {
              const landRow = capturedPos.row + j * dir.r;
              const landCol = capturedPos.col + j * dir.c;
              if (
                landRow < 0 ||
                landRow >= boardSize ||
                landCol < 0 ||
                landCol >= boardSize ||
                board[landRow]?.[landCol] !== 0
              )
                break;
              const newBoard = JSON.parse(JSON.stringify(board));
              newBoard[landRow][landCol] = newBoard[row][col];
              newBoard[row][col] = 0;
              newBoard[capturedPos.row][capturedPos.col] = 0;
              const nextSequences = findCaptureSequencesForPiece(
                landRow,
                landCol,
                newBoard,
                true,
                boardSize
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
            break;
          } else {
            break;
          }
        }
      }
    } else {
      const capturedRow = row + dir.r;
      const capturedCol = col + dir.c;
      const landRow = row + 2 * dir.r;
      const landCol = col + 2 * dir.c;

      if (
        landRow >= 0 &&
        landRow < boardSize &&
        landCol >= 0 &&
        landCol < boardSize
      ) {
        const capturedPiece = board[capturedRow]?.[capturedCol];
        const landingSquare = board[landRow]?.[landCol];
        if (
          capturedPiece &&
          capturedPiece.toLowerCase() === opponentColor &&
          landingSquare === 0
        ) {
          let becomesDama = false;
          const pieceColor = board[row][col].toLowerCase();
          if (
            (pieceColor === "b" && landRow === 0) ||
            (pieceColor === "p" && landRow === boardSize - 1)
          ) {
            becomesDama = true;
          }
          const newBoard = JSON.parse(JSON.stringify(board));
          newBoard[landRow][landCol] = newBoard[row][col];
          newBoard[row][col] = 0;
          newBoard[capturedRow][capturedCol] = 0;
          const nextSequences = findCaptureSequencesForPiece(
            landRow,
            landCol,
            newBoard,
            becomesDama,
            boardSize
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

function isMoveValid(from, to, playerColor, game, ignoreMajorityRule = false) {
  const board = game.boardState;
  const boardSize = game.boardSize || 8;

  if (!board || !board[from.row] || !board[to.row])
    return { valid: false, reason: "Tabuleiro inválido." };
  const piece = board[from.row][from.col];
  const destination = board[to.row][to.col];
  if (piece === 0 || piece.toLowerCase() !== playerColor || destination !== 0)
    return { valid: false, reason: "Seleção ou destino inválido." };

  if (game.mustCaptureWith) {
    if (
      from.row !== game.mustCaptureWith.row ||
      from.col !== game.mustCaptureWith.col
    ) {
      return {
        valid: false,
        reason:
          "Em sequência de captura, você deve continuar com a mesma peça.",
      };
    }
  }

  if (!ignoreMajorityRule) {
    const bestCaptures = findBestCaptureMoves(playerColor, game);
    if (bestCaptures.length > 0) {
      const isMoveInBestCaptures = bestCaptures.some(
        (seq) =>
          seq[0].row === from.row &&
          seq[0].col === from.col &&
          seq[1].row === to.row &&
          seq[1].col === to.col
      );
      if (!isMoveInBestCaptures) {
        return {
          valid: false,
          reason:
            "Lei da Maioria: Você é obrigado a fazer a captura com o maior número de peças.",
        };
      }
    }
  }

  let moveResult;
  if (piece === "B" || piece === "P") {
    moveResult = getDamaMove(from, to, playerColor, board, boardSize);
  } else {
    moveResult = getNormalPieceMove(from, to, playerColor, board, boardSize);
  }

  if (
    !ignoreMajorityRule &&
    findBestCaptureMoves(playerColor, game).length > 0 &&
    !moveResult.isCapture
  ) {
    return {
      valid: false,
      reason: "Você tem uma captura obrigatória a fazer.",
    };
  }

  return moveResult || { valid: false, reason: "Movimento não permitido." };
}

function getNormalPieceMove(from, to, playerColor, board, boardSize) {
  if (
    to.row < 0 ||
    to.row >= boardSize ||
    to.col < 0 ||
    to.col >= boardSize ||
    board[to.row]?.[to.col] !== 0
  ) {
    return { valid: false };
  }
  const opponentColor = playerColor === "b" ? "p" : "b";
  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  const moveDirection = playerColor === "b" ? -1 : 1;

  if (Math.abs(colDiff) === 1 && rowDiff === moveDirection) {
    return { valid: true, isCapture: false };
  }

  if (Math.abs(colDiff) === 2 && Math.abs(rowDiff) === 2) {
    const capturedPos = {
      row: from.row + rowDiff / 2,
      col: from.col + colDiff / 2,
    };
    const capturedPiece = board[capturedPos.row]?.[capturedPos.col];
    if (capturedPiece && capturedPiece.toLowerCase() === opponentColor) {
      return { valid: true, isCapture: true, capturedPos };
    }
  }
  return { valid: false };
}

function getDamaMove(from, to, playerColor, board, boardSize) {
  if (
    to.row < 0 ||
    to.row >= boardSize ||
    to.col < 0 ||
    to.col >= boardSize ||
    board[to.row]?.[to.col] !== 0
  )
    return { valid: false };
  const opponentColor = playerColor === "b" ? "p" : "b";
  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  if (Math.abs(rowDiff) !== Math.abs(colDiff)) return { valid: false };

  const stepRow = rowDiff > 0 ? 1 : -1;
  const stepCol = colDiff > 0 ? 1 : -1;
  let capturedPieces = [];
  let capturedPos = null;

  for (let i = 1; i < Math.abs(rowDiff); i++) {
    const currRow = from.row + i * stepRow;
    const currCol = from.col + i * stepCol;
    const pieceOnPath = board[currRow][currCol];
    if (pieceOnPath !== 0) {
      if (pieceOnPath.toLowerCase() === opponentColor) {
        capturedPieces.push(pieceOnPath);
        capturedPos = { row: currRow, col: currCol };
      } else {
        return {
          valid: false,
          reason: "Não pode saltar sobre peças da mesma cor.",
        };
      }
    }
  }

  if (capturedPieces.length > 1)
    return {
      valid: false,
      reason: "Dama não pode capturar mais de uma peça na mesma diagonal.",
    };
  if (capturedPieces.length === 1) {
    const landRow = capturedPos.row + stepRow;
    const landCol = capturedPos.col + stepCol;
    if (landRow !== to.row || landCol !== to.col) {
      const squareAfterCaptureRow = capturedPos.row + stepRow;
      const squareAfterCaptureCol = capturedPos.col + stepCol;
      if (board[squareAfterCaptureRow]?.[squareAfterCaptureCol] !== 0) {
        return {
          valid: false,
          reason: "Casa de aterragem da Dama está ocupada.",
        };
      }
      if (
        board[to.row]?.[to.col] !== 0 &&
        (to.row !== squareAfterCaptureRow || to.col !== squareAfterCaptureCol)
      ) {
        return {
          valid: false,
          reason: "Casa de aterragem final da Dama está ocupada.",
        };
      }
    }
    return { valid: true, isCapture: true, capturedPos };
  }
  return { valid: true, isCapture: false };
}

function checkWinCondition(boardState, boardSize) {
  let whitePieces = 0;
  let blackPieces = 0;
  const size = boardSize || 8;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const piece = boardState[r][c];
      if (piece !== 0) {
        if (piece.toLowerCase() === "b") whitePieces++;
        else if (piece.toLowerCase() === "p") blackPieces++;
      }
    }
  }
  if (whitePieces === 0) return "p";
  if (blackPieces === 0) return "b";
  return null;
}

function getAllPossibleCapturesForPiece(row, col, game) {
  const board = game.boardState;
  const boardSize = game.boardSize || 8;
  const piece = board[row][col];
  if (!piece || piece === 0) return [];
  const isDama = piece === piece.toUpperCase();
  return findCaptureSequencesForPiece(row, col, board, isDama, boardSize);
}

function hasValidMoves(playerColor, game) {
  const boardSize = game.boardSize || 8;

  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const piece = game.boardState[r][c];
      if (piece !== 0 && piece.toLowerCase() === playerColor) {
        for (let toRow = 0; toRow < boardSize; toRow++) {
          for (let toCol = 0; toCol < boardSize; toCol++) {
            if (
              isMoveValid(
                { row: r, col: c },
                { row: toRow, col: toCol },
                playerColor,
                game,
                true
              ).valid
            ) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

// NOVA FUNÇÃO AUXILIAR: Identifica se há apenas UM movimento de captura possível para a peça
// Útil para automação: Se houver bifurcação, não automatiza (deixa o jogador escolher).
function getUniqueCaptureMove(row, col, game) {
  const captures = getAllPossibleCapturesForPiece(row, col, game);
  if (captures.length === 0) return null;

  // Filtra apenas os "próximos passos" imediatos
  // sequences é algo como: [[{r,c}, {r1,c1}, {r2,c2}], [{r,c}, {r3,c3}]]
  // Queremos saber quantos {r1,c1} únicos existem.

  const nextSteps = new Set();
  captures.forEach((seq) => {
    if (seq.length > 1) {
      // seq[1] é o destino da primeira captura
      const key = `${seq[1].row},${seq[1].col}`;
      nextSteps.add(key);
    }
  });

  if (nextSteps.size === 1) {
    // Só tem um caminho imediato de captura. Vamos pegar o primeiro.
    return {
      to: captures[0][1], // O destino da captura
      // Precisamos recalcular se é Dama ou Normal para saber a posição exata da captura?
      // A função isMoveValid já faz isso, então só precisamos do 'to'.
    };
  }

  return null; // Múltiplas escolhas, não automatizar.
}

module.exports = {
  isMoveValid,
  checkWinCondition,
  hasValidMoves,
  getAllPossibleCapturesForPiece,
  findBestCaptureMoves,
  getUniqueCaptureMove, // Exportando
};
