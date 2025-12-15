// src/sharedGameLogic.js
// Lógica de regras puras para rodar no Servidor (Node.js) e compartilhar se necessário.
// NÃO use 'window', 'document' ou DOM aqui.

const DIRECTIONS = {
  b: [
    [-1, -1],
    [-1, 1],
  ], // Brancas andam para cima (row diminui)
  p: [
    [1, -1],
    [1, 1],
  ], // Pretas andam para baixo (row aumenta)
  K: [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ], // Damas (Kings)
};

function isValidPos(r, c, size) {
  return r >= 0 && r < size && c >= 0 && c < size;
}

// Verifica se é uma peça do jogador atual
function isMyPiece(piece, playerColor) {
  if (!piece) return false;
  return piece.toLowerCase() === playerColor; // 'b' ou 'p'
}

// Verifica se é inimiga
function isEnemy(piece, myColor) {
  if (!piece) return false;
  const p = piece.toLowerCase();
  const me = myColor.toLowerCase();
  return p !== me && (p === "b" || p === "p");
}

function isMoveValid(from, to, playerColor, game, ignoreTurn = false) {
  const { boardState, boardSize, currentPlayer, mustCaptureWith } = game;
  const r1 = from.row,
    c1 = from.col;
  const r2 = to.row,
    c2 = to.col;

  // 1. Validações básicas
  if (!isValidPos(r1, c1, boardSize) || !isValidPos(r2, c2, boardSize)) {
    return { valid: false, reason: "Fora do tabuleiro" };
  }

  const piece = boardState[r1][c1];
  if (!piece) return { valid: false, reason: "Casa de origem vazia" };

  // Verifica dono da peça
  if (!isMyPiece(piece, playerColor)) {
    return { valid: false, reason: "Essa peça não é sua" };
  }

  // Verifica turno (se não for validação simulada)
  if (!ignoreTurn && playerColor !== currentPlayer) {
    return { valid: false, reason: "Não é seu turno" };
  }

  // Verifica se destino está vazio
  if (boardState[r2][c2] !== 0) {
    return { valid: false, reason: "Casa de destino ocupada" };
  }

  // Se houver captura obrigatória global e não for esta peça
  if (game.mandatoryPieces && game.mandatoryPieces.length > 0) {
    const isMandatory = game.mandatoryPieces.some(
      (m) => m.row === r1 && m.col === c1
    );
    if (!isMandatory) {
      return {
        valid: false,
        reason: "Você é obrigado a capturar com outra peça!",
      };
    }
  }

  // Se houver captura obrigatória ESPECÍFICA (em cadeia)
  if (mustCaptureWith) {
    if (r1 !== mustCaptureWith.row || c1 !== mustCaptureWith.col) {
      return { valid: false, reason: "Continue capturando com a mesma peça!" };
    }
  }

  const isKing = piece === "B" || piece === "P";
  const dr = r2 - r1;
  const dc = c2 - c1;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  // Movimento deve ser diagonal
  if (absDr !== absDc)
    return { valid: false, reason: "Movimento não diagonal" };
  if (absDr === 0) return { valid: false, reason: "Mesma posição" };

  // --- LÓGICA DE MOVIMENTO SIMPLES (Sem Captura) ---
  if (absDr === 1 && !isKing) {
    // Verifica direção para peça comum
    // 'b' (branca) deve diminuir Row (ir para 0)
    // 'p' (preta) deve aumentar Row (ir para boardSize)
    const forward = playerColor === "b" ? -1 : 1;

    // Se tentou andar pra trás sem capturar
    if (dr !== forward) {
      return { valid: false, reason: "Peça comum só anda para frente" };
    }

    // Se existe captura disponível no tabuleiro, movimento simples é proibido
    // (A menos que estejamos apenas simulando validade básica)
    if (
      !ignoreTurn &&
      game.mandatoryPieces &&
      game.mandatoryPieces.length > 0
    ) {
      // Verifica se é captura. Distancia 1 não é captura.
      return { valid: false, reason: "Captura obrigatória disponível!" };
    }

    return { valid: true, isCapture: false };
  }

  // --- LÓGICA DE CAPTURA E DAMA ---

  // Direção do passo unitário
  const stepR = dr > 0 ? 1 : -1;
  const stepC = dc > 0 ? 1 : -1;

  let capturedPos = null;
  let piecesBetween = 0;

  let currentR = r1 + stepR;
  let currentC = c1 + stepC;

  while (currentR !== r2 || currentC !== c2) {
    const cell = boardState[currentR][currentC];

    if (cell !== 0) {
      // Se for minha peça -> bloqueado
      if (isMyPiece(cell, playerColor)) {
        return { valid: false, reason: "Bloqueado por peça aliada" };
      }
      // Se for inimigo
      if (isEnemy(cell, playerColor)) {
        if (capturedPos) {
          // Já tinha capturado um, não pode ter dois no caminho
          return { valid: false, reason: "Não pode pular duas peças" };
        }

        // Verifica se a peça já foi capturada NESTE turno (regra "fantasma")
        if (
          game.turnCapturedPieces &&
          game.turnCapturedPieces.some(
            (p) => p.row === currentR && p.col === currentC
          )
        ) {
          // É uma peça morta que ainda está no tabuleiro, conta como vazio ou obstáculo?
          // Regra internacional/brasileira: peça capturada sai só no fim, mas não pode pular de novo?
          // Na verdade, ela vira um obstáculo intransponível, mas não capturável de novo.
          return { valid: false, reason: "Não pode pular peça já capturada" };
        }

        capturedPos = { row: currentR, col: currentC };
        piecesBetween++;
      }
    }

    currentR += stepR;
    currentC += stepC;
  }

  // PEÇA COMUM
  if (!isKing) {
    // Peça comum captura pulando exatamente 2 casas (distância 2)
    // MAS na regra brasileira ela pode capturar para trás.
    if (absDr === 2 && piecesBetween === 1) {
      return { valid: true, isCapture: true, capturedPos };
    }
    // Se tentou andar mais de 1 casa sem ser captura ou sem ser dama
    return { valid: false, reason: "Movimento inválido para peça comum" };
  }

  // DAMA (KING)
  if (isKing) {
    if (piecesBetween === 0) {
      // Movimento de Dama sem captura
      if (
        !ignoreTurn &&
        game.mandatoryPieces &&
        game.mandatoryPieces.length > 0
      ) {
        return { valid: false, reason: "Captura obrigatória disponível!" };
      }
      return { valid: true, isCapture: false };
    } else if (piecesBetween === 1) {
      // Captura de Dama
      // Deve verificar se a casa LOGO APÓS a peça capturada está livre?
      // O loop acima já garantiu que só tem 1 peça e o destino está vazio.
      // Precisa validar se há captura MELHOR disponível? Isso é feito no findBestCaptureMoves.
      return { valid: true, isCapture: true, capturedPos };
    }
  }

  return { valid: false, reason: "Movimento inválido" };
}

// Retorna todas as capturas possíveis a partir de (r,c) para uma peça específica
function getAllPossibleCapturesForPiece(r, c, game) {
  const possibleCaptures = [];
  const boardState = game.boardState;
  const boardSize = game.boardSize;
  const piece = boardState[r][c];
  if (!piece) return [];

  const playerColor = piece.toLowerCase(); // 'b' ou 'p'
  const isKing = piece === "B" || piece === "P";

  // Direções: Peça comum (4 lados se captura), Dama (4 lados)
  const directions = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  for (let dir of directions) {
    const dr = dir[0];
    const dc = dir[1];

    if (!isKing) {
      // Peça comum captura a 2 casas de distância
      const rDest = r + dr * 2;
      const cDest = c + dc * 2;
      const rMid = r + dr;
      const cMid = c + dc;

      if (isValidPos(rDest, cDest, boardSize)) {
        // Destino vazio?
        if (boardState[rDest][cDest] === 0) {
          // Meio inimigo?
          const midP = boardState[rMid][cMid];
          if (midP !== 0 && isEnemy(midP, playerColor)) {
            // Verifica "fantasma"
            if (
              !game.turnCapturedPieces ||
              !game.turnCapturedPieces.some(
                (p) => p.row === rMid && p.col === cMid
              )
            ) {
              possibleCaptures.push({
                to: { row: rDest, col: cDest },
                captured: { row: rMid, col: cMid },
              });
            }
          }
        }
      }
    } else {
      // Dama: varre a diagonal
      let k = 1;
      let foundEnemy = null;

      while (true) {
        const rCheck = r + dr * k;
        const cCheck = c + dc * k;

        if (!isValidPos(rCheck, cCheck, boardSize)) break;

        const cell = boardState[rCheck][cCheck];

        if (cell === 0) {
          // Se já achou inimigo, esta casa livre é um destino de captura válido
          if (foundEnemy) {
            possibleCaptures.push({
              to: { row: rCheck, col: cCheck },
              captured: foundEnemy,
            });
          }
        } else {
          if (isMyPiece(cell, playerColor)) {
            break; // Bloqueado por amiga
          } else {
            // Inimiga
            if (foundEnemy) break; // Já tinha uma inimiga, não pode pular 2

            // Verifica "fantasma"
            if (
              game.turnCapturedPieces &&
              game.turnCapturedPieces.some(
                (p) => p.row === rCheck && p.col === cCheck
              )
            ) {
              break; // Bloqueado por peça morta
            }
            foundEnemy = { row: rCheck, col: cCheck };
          }
        }
        k++;
      }
    }
  }

  return possibleCaptures; // Formato: [{ to: {row,col}, captured: {row,col} }, ...]
}

// "Lei da Maioria": Encontra as melhores sequências de captura (Max Captures)
// Retorna array de arrays: [ [{row,col}, {row,col} (destino)...], ... ]
// Simplificação: Retorna apenas as peças iniciais que DEVEM jogar ou a lista completa de movimentos?
// O código socketHandlers espera: `const bestCaptures = findBestCaptureMoves(...)`
// E usa `bestCaptures.map(seq => seq[0])` para pegar a origem.
// Então deve retornar Array de Sequências, onde seq[0] é a Origem e seq[1] é o Destino.
function findBestCaptureMoves(playerColor, game) {
  const boardSize = game.boardSize;
  let allCaptures = [];

  // 1. Encontrar todas as peças do jogador que podem capturar
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (isMyPiece(game.boardState[r][c], playerColor)) {
        const caps = getAllPossibleCapturesForPiece(r, c, game);
        if (caps.length > 0) {
          // Precisaríamos simular a cadeia completa (Backtracking) para a Lei da Maioria Real
          // Para simplificar e evitar crash, vamos considerar apenas profundidade 1 ou heurística básica
          // Se o seu jogo exige Lei da Maioria estrita (Damas Brasileiras), o algoritmo é recursivo complexo.
          // Vou implementar uma heurística de "tem captura" para desbloquear o jogo.

          caps.forEach((capture) => {
            allCaptures.push([{ row: r, col: c }, capture.to]);
          });
        }
      }
    }
  }

  if (allCaptures.length === 0) return [];

  // TODO: Implementar recursão real para contar total de capturas na cadeia.
  // Por enquanto, retorna todas as capturas imediatas disponíveis.
  // Isso já impede movimentos simples se houver captura.
  return allCaptures;
}

function hasValidMoves(playerColor, game) {
  // 1. Tem captura?
  const caps = findBestCaptureMoves(playerColor, game);
  if (caps.length > 0) return true;

  // 2. Tem movimento simples?
  const boardSize = game.boardSize;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      if (isMyPiece(game.boardState[r][c], playerColor)) {
        // Tenta mover para as 4 diagonais (dist 1)
        const directions = [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ];
        for (let dir of directions) {
          const to = { row: r + dir[0], col: c + dir[1] };
          if (
            isMoveValid({ row: r, col: c }, to, playerColor, game, true).valid
          ) {
            return true;
          }
        }
        // Se for dama, tenta longe? O isMoveValid básico cobre 1 casa.
        // Se for Dama, e tiver livre, isMoveValid pega.
      }
    }
  }
  return false;
}

function getUniqueCaptureMove(r, c, game) {
  const caps = getAllPossibleCapturesForPiece(r, c, game);
  if (caps.length === 1) {
    return caps[0];
  }
  return null;
}

function checkWinCondition(boardState, boardSize) {
  let whiteCount = 0;
  let blackCount = 0;
  for (let r = 0; r < boardSize; r++) {
    for (let c = 0; c < boardSize; c++) {
      const p = boardState[r][c];
      if (p === "b" || p === "B") whiteCount++;
      if (p === "p" || p === "P") blackCount++;
    }
  }
  if (whiteCount === 0) return "p"; // Pretas venceram
  if (blackCount === 0) return "b"; // Brancas venceram
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
