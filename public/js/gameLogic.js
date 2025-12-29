// public/gameLogic.js
(function (exports) {
  // Helper para verificar se uma posição já foi capturada na sequência atual
  function isCaptured(row, col, list) {
    if (!list || list.length === 0) return false;
    return list.some((p) => p.row === row && p.col === col);
  }

  function findBestCaptureMoves(playerColor, game) {
    let bestMoves = [];
    let maxCaptures = 0;
    const boardSize = game.boardSize || 8;
    // Pega as peças já capturadas neste turno (se houver, vindo do backend ou estado local)
    const capturedFromStart = game.turnCapturedPieces || [];

    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        const piece = game.boardState[r][c];
        // Verifica se a própria peça que vai mover não está marcada como capturada (caso raro de sync)
        if (
          piece !== 0 &&
          piece.toLowerCase() === playerColor &&
          !isCaptured(r, c, capturedFromStart)
        ) {
          const isDama = piece === piece.toUpperCase();
          const sequences = findCaptureSequencesForPiece(
            r,
            c,
            game.boardState,
            isDama,
            boardSize,
            capturedFromStart
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

  function findCaptureSequencesForPiece(
    row,
    col,
    board,
    isDama,
    boardSize,
    capturedSoFar = []
  ) {
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
        // Dama pode andar várias casas
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

          // Se encontrar uma peça no caminho
          const pieceOnPath = board[nextRow][nextCol];
          if (pieceOnPath !== 0) {
            // Se a peça já foi capturada nesta sequência, ela age como um BLOQUEIO/OBSTÁCULO.
            // Regra Brasileira: "A peça capturada só sai do tabuleiro após o lance estar completo."
            // Logo, não podemos passar por ela nem pular novamente.
            if (isCaptured(nextRow, nextCol, capturedSoFar)) {
              break;
            }

            if (pieceOnPath.toLowerCase() === opponentColor) {
              // Verifica se há espaço APÓS a peça para pousar
              const checkLandRow = nextRow + dir.r;
              const checkLandCol = nextCol + dir.c;

              // Se logo após a peça adversária tiver outra peça (seja viva ou já capturada), bloqueia.
              if (
                checkLandRow >= 0 &&
                checkLandRow < boardSize &&
                checkLandCol >= 0 &&
                checkLandCol < boardSize
              ) {
                const pieceAfter = board[checkLandRow][checkLandCol];
                // Se tiver peça (que não seja 0), e essa peça NÃO for a própria (caso de loop bizarro), é bloqueio.
                // Nota: se pieceAfter for uma peça já capturada, ainda assim é != 0 no board, então bloqueia. Correto.
                if (pieceAfter !== 0) break;
              } else {
                // Fora do tabuleiro
                break;
              }

              capturedPos = { row: nextRow, col: nextCol };

              // Agora simula os pousos possíveis APÓS a captura
              for (let j = 1; j < boardSize; j++) {
                const landRow = capturedPos.row + j * dir.r;
                const landCol = capturedPos.col + j * dir.c;

                if (
                  landRow < 0 ||
                  landRow >= boardSize ||
                  landCol < 0 ||
                  landCol >= boardSize
                )
                  break;

                // Se encontrar qualquer peça no destino de pouso (inclusive já capturadas), para.
                if (board[landRow][landCol] !== 0) break;

                // Simula o estado para o próximo passo
                const newBoard = JSON.parse(JSON.stringify(board));
                newBoard[landRow][landCol] = newBoard[row][col];
                newBoard[row][col] = 0;

                // CRUCIAL: NÃO removemos a peça capturada do tabuleiro na simulação!
                // newBoard[capturedPos.row][capturedPos.col] = 0; // <--- ISSO ESTAVA ERRADO

                // Adicionamos à lista de excluídos para a recursão
                const newCapturedSoFar = [...capturedSoFar, capturedPos];

                const nextSequences = findCaptureSequencesForPiece(
                  landRow,
                  landCol,
                  newBoard,
                  isDama,
                  boardSize,
                  newCapturedSoFar
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
              // Após encontrar a primeira peça e simular seus pousos, o loop de 'busca por peça' nessa direção encerra.
              break;
            } else {
              // Peça da mesma cor bloqueando
              break;
            }
          }
        }
      } else {
        // PEÇA NORMAL (PEDRA)
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

          // Verifica se é oponente, se destino está vazio e se a peça já não foi capturada
          if (
            capturedPiece &&
            capturedPiece.toLowerCase() === opponentColor &&
            landingSquare === 0 &&
            !isCaptured(capturedRow, capturedCol, capturedSoFar)
          ) {
            const newBoard = JSON.parse(JSON.stringify(board));
            newBoard[landRow][landCol] = newBoard[row][col];
            newBoard[row][col] = 0;
            // NÃO removemos a peça capturada aqui também
            // newBoard[capturedRow][capturedCol] = 0;

            const newCapturedSoFar = [
              ...capturedSoFar,
              { row: capturedRow, col: capturedCol },
            ];

            const nextSequences = findCaptureSequencesForPiece(
              landRow,
              landCol,
              newBoard,
              isDama,
              boardSize,
              newCapturedSoFar
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

  function isMoveValid(
    from,
    to,
    playerColor,
    game,
    ignoreMajorityRule = false
  ) {
    const board = game.boardState;
    const boardSize = game.boardSize || 8;
    const capturedFromStart = game.turnCapturedPieces || []; // Pega capturadas do turno

    if (!board || !board[from.row] || !board[to.row])
      return { valid: false, reason: "Tabuleiro inválido." };

    // Verifica se a origem não é uma peça já capturada (apenas segurança)
    if (isCaptured(from.row, from.col, capturedFromStart))
      return { valid: false, reason: "Peça inválida (capturada)." };

    const piece = board[from.row][from.col];
    const destination = board[to.row][to.col];

    // Destino deve ser 0 E não pode ser uma casa ocupada por peça capturada (embora peça capturada != 0, então ok)
    if (piece === 0 || piece.toLowerCase() !== playerColor || destination !== 0)
      return { valid: false, reason: "Seleção ou destino inválido." };

    if (game.mustCaptureWith) {
      if (
        from.row !== game.mustCaptureWith.row ||
        from.col !== game.mustCaptureWith.col
      ) {
        return {
          valid: false,
          reason: "Você deve continuar capturando com a mesma peça.",
        };
      }
    }

    // Se já houver capturas acumuladas neste turno, estamos no meio de
    // uma sequência de captura — permitir passos subsequentes sem re-aplicar
    // a "Lei da Maioria" global que compara contra o estado inicial do turno.
    if (capturedFromStart && capturedFromStart.length > 0) {
      ignoreMajorityRule = true;
    }

    if (!ignoreMajorityRule) {
      const bestCaptures = findBestCaptureMoves(playerColor, game);
      if (bestCaptures.length > 0) {
        const matchingSeq = bestCaptures.find(
          (seq) =>
            seq[0].row === from.row &&
            seq[0].col === from.col &&
            seq.slice(1).some((p) => p.row === to.row && p.col === to.col)
        );
        if (!matchingSeq) {
          return {
            valid: false,
            reason: "Lei da Maioria: Capture o maior número de peças possível.",
          };
        } else {
          // Se o destino for um pouso posterior da sequência ótima, podemos
          // permitir que o jogador escolha pousar em qualquer um dos pousos
          // intermediários/terminais da sequência. Construímos a lista de
          // posições capturadas que ocorreriam até esse pouso e retornamos
          // um resultado de captura composto.
          const destIndex = matchingSeq.findIndex(
            (p) => p.row === to.row && p.col === to.col
          );
          if (destIndex > 1 || destIndex === 1) {
            // calcular posições capturadas entre cada salto até destIndex
            const capturedPositions = [];
            for (let s = 0; s < destIndex; s++) {
              const a = matchingSeq[s];
              const b = matchingSeq[s + 1];
              // segmento a -> b: encontrar peça capturada entre eles
              if (
                Math.abs(a.row - b.row) === 2 &&
                Math.abs(a.col - b.col) === 2
              ) {
                // salto de peça normal (ponto médio)
                capturedPositions.push({
                  row: (a.row + b.row) / 2,
                  col: (a.col + b.col) / 2,
                });
              } else {
                // Dama: percorre diagonal e encontra a peça adversária entre a e b
                const stepR = b.row > a.row ? 1 : -1;
                const stepC = b.col > a.col ? 1 : -1;
                for (let i = 1; ; i++) {
                  const rr = a.row + i * stepR;
                  const cc = a.col + i * stepC;
                  if (rr === b.row && cc === b.col) break;
                  const maybe = board[rr][cc];
                  if (maybe !== 0) {
                    capturedPositions.push({ row: rr, col: cc });
                    break;
                  }
                }
              }
            }
            // Retornamos um objeto compatível com os handlers: isCapture true e capturedPos = array
            return {
              valid: true,
              isCapture: true,
              capturedPos: capturedPositions,
            };
          }
        }
      }
    }

    // Passamos a lista de capturados para as funções de movimento auxiliares
    let moveResult;
    if (piece === "B" || piece === "P") {
      moveResult = getDamaMove(
        from,
        to,
        playerColor,
        board,
        boardSize,
        capturedFromStart
      );
    } else {
      moveResult = getNormalPieceMove(
        from,
        to,
        playerColor,
        board,
        boardSize,
        capturedFromStart
      );
    }

    if (
      !ignoreMajorityRule &&
      findBestCaptureMoves(playerColor, game).length > 0 &&
      !moveResult.isCapture
    ) {
      return {
        valid: false,
        reason: "Captura obrigatória disponível.",
      };
    }

    return moveResult || { valid: false, reason: "Movimento inválido." };
  }

  function getNormalPieceMove(
    from,
    to,
    playerColor,
    board,
    boardSize,
    capturedList
  ) {
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

      // Verifica se a peça a ser comida está na lista de já comidas
      if (isCaptured(capturedPos.row, capturedPos.col, capturedList)) {
        return { valid: false };
      }

      const capturedPiece = board[capturedPos.row]?.[capturedPos.col];
      if (capturedPiece && capturedPiece.toLowerCase() === opponentColor) {
        return { valid: true, isCapture: true, capturedPos };
      }
    }
    return { valid: false };
  }

  function getDamaMove(from, to, playerColor, board, boardSize, capturedList) {
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
    let capturedPiecesInMove = [];
    let capturedPos = null;

    for (let i = 1; i < Math.abs(rowDiff); i++) {
      const currRow = from.row + i * stepRow;
      const currCol = from.col + i * stepCol;
      const pieceOnPath = board[currRow][currCol];

      if (pieceOnPath !== 0) {
        // Se encontrar uma peça JÁ capturada no caminho, é bloqueio!
        if (isCaptured(currRow, currCol, capturedList)) {
          return {
            valid: false,
            reason: "Caminho bloqueado (peça capturada).",
          };
        }

        if (pieceOnPath.toLowerCase() === opponentColor) {
          capturedPiecesInMove.push(pieceOnPath);
          capturedPos = { row: currRow, col: currCol };
        } else {
          return {
            valid: false,
            reason: "Não pode saltar peças da mesma cor.",
          };
        }
      }
    }

    if (capturedPiecesInMove.length > 1)
      return {
        valid: false,
        reason:
          "Dama não pode capturar mais de uma peça na mesma diagonal (em um único salto).",
      };

    if (capturedPiecesInMove.length === 1) {
      // A lógica de "não remover peça" garante que se houver bloqueio, já parou antes.
      // Mas precisamos garantir que não há nada logo após a peça.
      // O loop acima já garante que entre origem e destino só há 1 peça.
      // E se destino está vazio (validado no início), então ok.
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
    const capturedFromStart = game.turnCapturedPieces || [];
    const piece = board[row][col];
    if (!piece || piece === 0) return [];
    const isDama = piece === piece.toUpperCase();
    return findCaptureSequencesForPiece(
      row,
      col,
      board,
      isDama,
      boardSize,
      capturedFromStart
    );
  }

  // Verifica se a peça na posição (row,col) ainda pode capturar mais,
  // ignorando posições já listadas em `alreadyCaptured` (peças "fantasma").
  function canCaptureMore(board, row, col, player, alreadyCaptured = []) {
    const boardSize = board.length || 8;
    const piece = board[row] && board[row][col];
    if (!piece || piece === 0) return false;
    const isDama = piece === piece.toUpperCase();
    const opponent = piece.toLowerCase() === "b" ? "p" : "b";

    const isAlready = (r, c) =>
      Array.isArray(alreadyCaptured) &&
      alreadyCaptured.some((s) => `${s.row},${s.col}` === `${r},${c}`);

    const directions = [
      { r: -1, c: -1 },
      { r: -1, c: 1 },
      { r: 1, c: -1 },
      { r: 1, c: 1 },
    ];

    for (const dir of directions) {
      if (isDama) {
        for (let i = 1; i < boardSize; i++) {
          const nr = row + dir.r * i;
          const nc = col + dir.c * i;
          const jumpR = nr + dir.r;
          const jumpC = nc + dir.c;
          if (!isWithinBounds(jumpR, jumpC, boardSize)) break;
          const target = board[nr] && board[nr][nc];
          const landing = board[jumpR] && board[jumpR][jumpC];
          if (
            typeof target !== "undefined" &&
            target !== 0 &&
            target.toLowerCase() !== player.toLowerCase() &&
            landing === 0 &&
            !isAlready(nr, nc)
          ) {
            return true;
          }
          if (target !== 0) break;
        }
      } else {
        const nr = row + dir.r;
        const nc = col + dir.c;
        const jumpR = row + dir.r * 2;
        const jumpC = col + dir.c * 2;
        if (!isWithinBounds(jumpR, jumpC, boardSize)) continue;
        const target = board[nr] && board[nr][nc];
        const landing = board[jumpR] && board[jumpR][jumpC];
        if (
          typeof target !== "undefined" &&
          target !== 0 &&
          target.toLowerCase() !== player.toLowerCase() &&
          landing === 0 &&
          !isAlready(nr, nc)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // Retorna o máximo de capturas possíveis para `player` no tabuleiro `game`.
  // Reaproveita `findBestCaptureMoves` e extrai o comprimento máximo das sequências.
  function getBestCaptureCount(boardOrGame, player) {
    let best = 0;
    // aceitar tanto o objeto `game` quanto apenas o `board`+`boardSize`
    try {
      if (boardOrGame && boardOrGame.boardState) {
        const seqs = findBestCaptureMoves(player, boardOrGame);
        seqs.forEach((s) => {
          const caps = Math.max(0, s.length - 1);
          if (caps > best) best = caps;
        });
      } else if (Array.isArray(boardOrGame)) {
        // forma fallback: criar um objeto game mínimo
        const game = { boardState: boardOrGame, boardSize: boardOrGame.length };
        const seqs = findBestCaptureMoves(player, game);
        seqs.forEach((s) => {
          const caps = Math.max(0, s.length - 1);
          if (caps > best) best = caps;
        });
      }
    } catch (e) {}
    return best;
  }

  // Helper para checar limites (usado por canCaptureMore)
  function isWithinBounds(r, c, size) {
    return r >= 0 && r < size && c >= 0 && c < size;
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

  function getUniqueCaptureMove(row, col, game) {
    const captures = getAllPossibleCapturesForPiece(row, col, game);
    if (captures.length === 0) return null;
    const nextSteps = new Set();
    captures.forEach((seq) => {
      if (seq.length > 1) {
        const key = `${seq[1].row},${seq[1].col}`;
        nextSteps.add(key);
      }
    });
    if (nextSteps.size === 1) {
      return { to: captures[0][1] };
    }
    return null;
  }

  function isProgressMove(board, from, to, capturedPieces) {
    // 1. Check Capture
    if (capturedPieces && capturedPieces.length > 0) return true;
    if (Math.abs(to.row - from.row) > 1) return true;
    // 2. Check Simple Piece Move
    const piece = board[from.row][from.col];
    if (!piece) return false;
    const isKing = piece === "B" || piece === "P";
    return !isKing;
  }

  exports.findBestCaptureMoves = findBestCaptureMoves;
  exports.isMoveValid = isMoveValid;
  exports.checkWinCondition = checkWinCondition;
  exports.getAllPossibleCapturesForPiece = getAllPossibleCapturesForPiece;
  exports.hasValidMoves = hasValidMoves;
  exports.getUniqueCaptureMove = getUniqueCaptureMove;
  exports.canCaptureMore = canCaptureMore;
  exports.getBestCaptureCount = getBestCaptureCount;
  exports.isProgressMove = isProgressMove;
})(typeof exports === "undefined" ? (this.gameLogic = {}) : exports);
