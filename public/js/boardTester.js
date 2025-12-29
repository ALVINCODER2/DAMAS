// boardTester.js - Test board adapted from admin's test board logic
(function () {
  // simplified test board for main game page; includes auto-capture behavior
  const standardOpening = [
    [0, "p", 0, "p", 0, "p", 0, "p"],
    ["p", 0, "p", 0, "p", 0, "p", 0],
    [0, "p", 0, "p", 0, "p", 0, "p"],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    ["b", 0, "b", 0, "b", 0, "b", 0],
    [0, "b", 0, "b", 0, "b", 0, "b"],
    ["b", 0, "b", 0, "b", 0, "b", 0],
  ];

  let testGame = null;
  let selectedPiece = null;
  let testGameHistory = [];
  let removeMode = false;
  let promoteMode = false;
  let editMoveMode = false;
  let editMoveSelected = null;

  function $(id) {
    return document.getElementById(id);
  }

  function createBoard() {
    const boardElement = $("board");
    if (!boardElement) return;
    boardElement.innerHTML = "";
    boardElement.style.display = "grid";
    boardElement.style.gridTemplateColumns = "repeat(8, min(60px, 10vw))";
    boardElement.style.gridTemplateRows = "repeat(8, min(60px, 10vw))";
    boardElement.style.border = "12px solid #382d21";
    boardElement.style.borderRadius = "5px";
    boardElement.style.boxShadow =
      "0 15px 30px rgba(0, 0, 0, 0.4), inset 0 0 15px rgba(0, 0, 0, 0.6)";
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = document.createElement("div");
        square.classList.add(
          "square",
          (row + col) % 2 === 1 ? "dark" : "light"
        );
        square.dataset.row = row;
        square.dataset.col = col;
        boardElement.appendChild(square);
      }
    }
    boardElement.addEventListener("click", handleBoardClick);
  }
  function handleBoardClick(e) {
    const square = e.target.closest(".square");
    if (!square || !testGame) return;
    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    const clickedPieceElement = e.target.closest(".piece");

    // Modo Editar/Mover: selecione peça e clique destino (movimento livre)
    if (editMoveMode) {
      // Se clicou em uma peça, seleciona-a para mover
      if (clickedPieceElement && testGame.boardState[row][col] !== 0) {
        editMoveSelected = { row, col, piece: testGame.boardState[row][col] };
        testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
        const status = $("test-panel-status");
        if (status)
          status.textContent = `Peça selecionada em (${row}, ${col}). Agora clique no destino.`;
        return;
      }

      // Se clicou em um quadrado vazio (ou sobre outra peça) e há seleção, move
      if (editMoveSelected) {
        // evita mover para a mesma casa
        if (editMoveSelected.row === row && editMoveSelected.col === col) {
          const status = $("test-panel-status");
          if (status)
            status.textContent = "Destino igual à origem; seleção mantida.";
          return;
        }

        // realiza o movimento (substitui o destino)
        testGame.boardState[editMoveSelected.row][editMoveSelected.col] = 0;
        testGame.boardState[row][col] = editMoveSelected.piece;
        renderPieces();
        updateTestGameUI();
        const status = $("test-panel-status");
        if (status) status.textContent = `Peça movida para (${row}, ${col}).`;
        editMoveSelected = null;
        return;
      }

      const status = $("test-panel-status");
      if (status)
        status.textContent =
          "Clique em uma peça para selecionar antes de mover.";
      return;
    }

    // Modo Remover: ao clicar em qualquer peça, remove-a
    if (removeMode) {
      if (testGame.boardState[row][col] !== 0) {
        testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
        testGame.boardState[row][col] = 0;
        renderPieces();
        updateTestGameUI();
        const status = $("test-panel-status");
        if (status) status.textContent = `Peça removida em (${row}, ${col}).`;
      } else {
        const status = $("test-panel-status");
        if (status) status.textContent = "Não há peça nessa casa.";
      }
      return;
    }

    // Modo Promover: ao clicar em peça, promove para dama
    if (promoteMode) {
      const pieceType = testGame.boardState[row][col];
      if (pieceType !== 0) {
        testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
        const lower = pieceType.toLowerCase();
        if (lower === "b") testGame.boardState[row][col] = "B";
        else if (lower === "p") testGame.boardState[row][col] = "P";
        renderPieces();
        updateTestGameUI();
        const status = $("test-panel-status");
        if (status) status.textContent = `Peça promovida em (${row}, ${col}).`;
      } else {
        const status = $("test-panel-status");
        if (status)
          status.textContent = "Não há peça nessa casa para promover.";
      }
      return;
    }

    if (selectedPiece) {
      if (square.classList.contains("valid-move-highlight")) {
        const move = {
          from: { row: selectedPiece.row, col: selectedPiece.col },
          to: { row, col },
        };

        const isValid = window.gameLogic.isMoveValid(
          move.from,
          move.to,
          testGame.currentPlayer,
          testGame,
          false
        );

        if (isValid.valid) {
          testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
          const piece = testGame.boardState[move.from.row][move.from.col];
          testGame.boardState[move.to.row][move.to.col] = piece;
          testGame.boardState[move.from.row][move.from.col] = 0;

          let canCaptureAgain = false;

          if (isValid.isCapture) {
            // accumulate captured positions into turnCapturedPieces (do not remove yet)
            if (!Array.isArray(isValid.capturedPos)) {
              testGame.turnCapturedPieces.push(isValid.capturedPos);
            } else {
              isValid.capturedPos.forEach((p) =>
                testGame.turnCapturedPieces.push(p)
              );
            }

            const nextCaptures =
              window.gameLogic.getAllPossibleCapturesForPiece(
                move.to.row,
                move.to.col,
                testGame
              );
            canCaptureAgain = nextCaptures.length > 0;

            if (!canCaptureAgain) {
              // finalize captures: remove captured pieces now
              testGame.turnCapturedPieces.forEach((p) => {
                if (
                  testGame.boardState[p.row] &&
                  typeof testGame.boardState[p.row][p.col] !== "undefined"
                ) {
                  testGame.boardState[p.row][p.col] = 0;
                }
              });
              testGame.turnCapturedPieces = [];
            }
          }

          if (!canCaptureAgain) {
            if (piece === "b" && move.to.row === 0) {
              testGame.boardState[move.to.row][move.to.col] = "B";
            } else if (
              piece === "p" &&
              move.to.row === testGame.boardSize - 1
            ) {
              testGame.boardState[move.to.row][move.to.col] = "P";
            }
          }

          if (!canCaptureAgain) {
            testGame.currentPlayer = testGame.currentPlayer === "b" ? "p" : "b";
          }

          renderPieces();
          updateTestGameUI();
        } else {
          const status = $("test-panel-status");
          if (status)
            status.textContent = isValid.reason || "Movimento inválido";
          unselectPiece();
        }
        return;
      }
    }

    unselectPiece();
    if (clickedPieceElement) {
      const pieceColor = clickedPieceElement.classList.contains("white-piece")
        ? "b"
        : "p";
      if (pieceColor === testGame.currentPlayer)
        selectPiece(clickedPieceElement, row, col);
    }
  }

  function selectPiece(pieceElement, row, col) {
    unselectPiece();
    pieceElement.classList.add("selected");
    selectedPiece = { element: pieceElement, row, col };

    try {
      const bestCaptures = window.gameLogic.findBestCaptureMoves(
        testGame.currentPlayer,
        testGame
      );
      const capturesForPiece = bestCaptures.filter(
        (seq) => seq[0] && seq[0].row === row && seq[0].col === col
      );
      if (capturesForPiece.length > 0) {
        capturesForPiece.sort((a, b) => b.length - a.length);
        const chosenSeq = capturesForPiece[0];
        (async () => {
          let curFrom = { row: chosenSeq[0].row, col: chosenSeq[0].col };
          for (let i = 1; i < chosenSeq.length; i++) {
            const dest = chosenSeq[i];
            const mv = {
              from: { row: curFrom.row, col: curFrom.col },
              to: dest,
            };
            const ok = await applyMoveObj(mv, true);
            if (!ok) return;
            curFrom = { row: dest.row, col: dest.col };
            await new Promise((r) => setTimeout(r, 150));
            if (
              window.gameLogic &&
              typeof window.gameLogic.getAllPossibleCapturesForPiece ===
                "function"
            ) {
              const nextCaptures =
                window.gameLogic.getAllPossibleCapturesForPiece(
                  curFrom.row,
                  curFrom.col,
                  testGame
                );
              if (nextCaptures.length > 1) {
                const nextIdx = i + 1;
                if (chosenSeq && nextIdx < chosenSeq.length) {
                  const planned = chosenSeq[nextIdx];
                  const matchesPlanned = nextCaptures.some(
                    (seq) =>
                      seq[1] &&
                      seq[1].row === planned.row &&
                      seq[1].col === planned.col
                  );
                  if (!matchesPlanned) return;
                } else return;
              }
            }
          }
        })().catch(() => {});
        return;
      }
    } catch (e) {}

    showValidMoves(row, col);
  }

  function unselectPiece() {
    document
      .querySelectorAll("#board .valid-move-highlight")
      .forEach((s) => s.classList.remove("valid-move-highlight"));
    if (selectedPiece) {
      selectedPiece.element.classList.remove("selected");
      selectedPiece = null;
    }
  }

  function highlightMandatoryPieces(piecesToHighlight) {
    document
      .querySelectorAll("#board .mandatory-capture")
      .forEach((p) => p.classList.remove("mandatory-capture"));
    if (piecesToHighlight && piecesToHighlight.length > 0) {
      piecesToHighlight.forEach((pos) => {
        const square = document.querySelector(
          `#board .square[data-row='${pos.row}'][data-col='${pos.col}']`
        );
        if (square && square.firstChild)
          square.firstChild.classList.add("mandatory-capture");
      });
    }
  }

  function showValidMoves(row, col) {
    const piece = testGame.boardState[row][col];
    if (piece === 0) return;
    const playerColor = piece.toLowerCase();
    let validMoves = [];
    const bestCaptures = window.gameLogic.findBestCaptureMoves(
      playerColor,
      testGame
    );
    if (bestCaptures.length > 0) {
      const capturesForThisPiece = bestCaptures.filter(
        (seq) => seq[0].row === row && seq[0].col === col
      );
      const dests = [];
      capturesForThisPiece.forEach((seq) => {
        for (let i = 1; i < seq.length; i++) dests.push(seq[i]);
      });
      const seen = new Set();
      validMoves = dests.filter((d) => {
        const k = `${d.row},${d.col}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } else {
      for (let toRow = 0; toRow < 8; toRow++) {
        for (let toCol = 0; toCol < 8; toCol++) {
          try {
            const result = window.gameLogic.isMoveValid(
              { row, col },
              { row: toRow, col: toCol },
              playerColor,
              testGame,
              true
            );
            if (result.valid && !result.isCapture)
              validMoves.push({ row: toRow, col: toCol });
          } catch (e) {}
        }
      }
    }
    validMoves.forEach((move) => {
      const square = document.querySelector(
        `#board .square[data-row='${move.row}'][data-col='${move.col}']`
      );
      if (square) square.classList.add("valid-move-highlight");
    });
  }

  // applyMoveObj adapted from admin.js
  async function applyMoveObj(mv, ignoreMajority = false) {
    const player = testGame.currentPlayer;
    const res = window.gameLogic.isMoveValid(
      mv.from,
      mv.to,
      player,
      testGame,
      ignoreMajority
    );
    if (!res.valid) {
      const status = $("test-panel-status");
      if (status) status.textContent = res.reason || "Movimento inválido.";
      return false;
    }
    testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
    const piece = testGame.boardState[mv.from.row][mv.from.col];
    testGame.boardState[mv.to.row][mv.to.col] = piece;
    testGame.boardState[mv.from.row][mv.from.col] = 0;
    if (res.isCapture && res.capturedPos) {
      if (!Array.isArray(res.capturedPos))
        testGame.turnCapturedPieces.push(res.capturedPos);
      else res.capturedPos.forEach((p) => testGame.turnCapturedPieces.push(p));
      const nextCaptures = window.gameLogic.getAllPossibleCapturesForPiece(
        mv.to.row,
        mv.to.col,
        testGame
      );
      const canCaptureAgain = nextCaptures.length > 0;
      if (!canCaptureAgain) {
        testGame.turnCapturedPieces.forEach((p) => {
          if (
            testGame.boardState[p.row] &&
            typeof testGame.boardState[p.row][p.col] !== "undefined"
          )
            testGame.boardState[p.row][p.col] = 0;
        });
        testGame.turnCapturedPieces = [];
        if (piece === "b" && mv.to.row === 0)
          testGame.boardState[mv.to.row][mv.to.col] = "B";
        if (piece === "p" && mv.to.row === testGame.boardSize - 1)
          testGame.boardState[mv.to.row][mv.to.col] = "P";
        testGame.currentPlayer = testGame.currentPlayer === "b" ? "p" : "b";
      }
    } else {
      if (piece === "b" && mv.to.row === 0)
        testGame.boardState[mv.to.row][mv.to.col] = "B";
      if (piece === "p" && mv.to.row === testGame.boardSize - 1)
        testGame.boardState[mv.to.row][mv.to.col] = "P";
      testGame.currentPlayer = testGame.currentPlayer === "b" ? "p" : "b";
    }
    try {
      if (window.GameCore && window.GameCore.state) {
        const s = window.GameCore.state;
        s.boardState = JSON.parse(JSON.stringify(testGame.boardState));
        s.currentBoardSize = testGame.boardSize;
        s.currentTurnCapturedPieces = Array.isArray(testGame.turnCapturedPieces)
          ? JSON.parse(JSON.stringify(testGame.turnCapturedPieces))
          : [];
        s.lastServerCurrentPlayer = testGame.currentPlayer;
        s.serverProcessingCapture = false;
      }
    } catch (e) {}

    renderPieces();
    updateTestGameUI();
    return true;
  }

  // expose for debugging
  window.applyMoveObj = applyMoveObj;

  // wire up UI controls present in jogo.html test panel
  function setupControls() {
    const toggleBtn = $("toggle-test-panel");
    const loadBtn = $("load-board-btn-main");
    const exportBtn = $("export-board-btn-main");
    const clearBtn = $("clear-board-btn-main");
    const textarea = $("board-json-input-main");
    const resetBtn = null; // not present in main
    const undoBtn = null;
    const switchTurnBtn = null;

    if (toggleBtn)
      toggleBtn.addEventListener("click", () => {
        const body = $("test-panel-body");
        if (body) body.classList.toggle("hidden");
      });

    if (loadBtn && textarea)
      loadBtn.addEventListener("click", () => {
        const raw = textarea.value && textarea.value.trim();
        if (!raw)
          return ($("test-panel-status").textContent =
            "Cole o JSON do tabuleiro antes.");
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          return ($("test-panel-status").textContent =
            "JSON inválido: " + e.message);
        }
        let boardArr = null;
        let player = null;
        if (Array.isArray(parsed)) boardArr = parsed;
        else if (parsed && Array.isArray(parsed.board)) {
          boardArr = parsed.board;
          if (parsed.currentPlayer) player = parsed.currentPlayer;
        }
        if (
          !boardArr ||
          boardArr.length !== 8 ||
          !boardArr.every((r) => Array.isArray(r) && r.length === 8)
        )
          return ($("test-panel-status").textContent =
            "Formato inválido: envie um array 8x8.");
        testGame = {
          boardState: JSON.parse(JSON.stringify(boardArr)),
          boardSize: boardArr.length,
          currentPlayer: player === "b" || player === "p" ? player : "b",
          turnCapturedPieces: [],
        };
        testGameHistory = [];
        renderPieces();
        updateTestGameUI();
        $("test-panel-status").textContent = "Tabuleiro carregado localmente.";
      });

    if (exportBtn)
      exportBtn.addEventListener("click", async () => {
        try {
          let json = JSON.stringify(
            testGame && testGame.boardState ? testGame.boardState : []
          );
          if (textarea) textarea.value = json;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(json);
            $("test-panel-status").textContent =
              "JSON copiado para área de transferência.";
          } else
            $("test-panel-status").textContent = "JSON preenchido no campo.";
        } catch (e) {
          $("test-panel-status").textContent =
            "Erro ao exportar JSON: " + e.message;
        }
      });

    if (clearBtn)
      clearBtn.addEventListener("click", () => {
        if (textarea) textarea.value = "";
        $("test-panel-status").textContent = "Campo limpo.";
      });
  }

  // initialize
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => {
      createBoard();
      testGame = {
        boardState: JSON.parse(JSON.stringify(standardOpening)),
        boardSize: 8,
        currentPlayer: "b",
        turnCapturedPieces: [],
      };
      renderPieces();
      updateTestGameUI();
      setupControls();
    });
  else {
    createBoard();
    testGame = {
      boardState: JSON.parse(JSON.stringify(standardOpening)),
      boardSize: 8,
      currentPlayer: "b",
      turnCapturedPieces: [],
    };
    renderPieces();
    updateTestGameUI();
    setupControls();
  }
})();
