// public/js/gameCore.js - Lógica Central do Jogo e Estado

window.GameCore = (function () {
  // --- ESTADO DO JOGO ---
  const state = {
    socket: null,
    UI: null,

    // Variáveis de Sessão
    myColor: null,
    currentRoom: null,
    boardState: [],
    selectedPiece: null,
    currentBoardSize: 8,
    isGameOver: false,

    // Timers e Controle
    nextGameInterval: null,
    drawCooldownInterval: null,
    lastPacketTime: Date.now(),
    watchdogInterval: null,
    // Timer cliente (sincronização com servidor)
    clientTimerInterval: null,
    serverTimerActive: false,
    displayedWhiteTime: null,
    displayedBlackTime: null,
    displayedTimeLeft: null,
    lastServerCurrentPlayer: null,

    // Capturas e Turno
    currentTurnCapturedPieces: [],

    // Otimização e Replay
    lastOptimisticMove: null,
    pendingBoardSnapshot: null,
    savedReplayData: null,
    isReplaying: false,

    // Fila
    updateQueue: [],
    isProcessingQueue: false,
    drawMovesCounter: 0,
    lastMoveWasProgress: false,
    revancheInterval: null,
  };

  // --- TIMER LOCAL (BÁSICO) ---
  function startTimer() {
    if (state.clientTimerInterval) return;
    state.clientTimerInterval = setInterval(() => {
      if (!state.serverTimerActive) return stopTimer();
      // Modo match (white/black)
      if (
        state.displayedWhiteTime !== null &&
        state.displayedBlackTime !== null
      ) {
        if (state.lastServerCurrentPlayer === "b") {
          state.displayedWhiteTime = Math.max(0, state.displayedWhiteTime - 1);
        } else {
          state.displayedBlackTime = Math.max(0, state.displayedBlackTime - 1);
        }
        UI.updateTimer({
          whiteTime: state.displayedWhiteTime,
          blackTime: state.displayedBlackTime,
        });
      } else if (state.displayedTimeLeft !== null) {
        state.displayedTimeLeft = Math.max(0, state.displayedTimeLeft - 1);
        UI.updateTimer({ timeLeft: state.displayedTimeLeft });
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.clientTimerInterval) {
      clearInterval(state.clientTimerInterval);
      state.clientTimerInterval = null;
    }
  }

  function handleTimerState(data) {
    // data: { timerActive, whiteTime, blackTime, timeLeft, currentPlayer }
    if (!data) return;
    if (data.timerActive !== undefined)
      state.serverTimerActive = !!data.timerActive;
    if (data.whiteTime !== undefined) state.displayedWhiteTime = data.whiteTime;
    if (data.blackTime !== undefined) state.displayedBlackTime = data.blackTime;
    if (data.timeLeft !== undefined) state.displayedTimeLeft = data.timeLeft;
    if (data.currentPlayer !== undefined)
      state.lastServerCurrentPlayer = data.currentPlayer;

    // Atualiza imediatamente a UI
    UI.updateTimer(data);

    // Controla o timer local
    if (state.serverTimerActive) startTimer();
    else stopTimer();
  }

  // --- INICIALIZAÇÃO ---
  function init(socketInstance, uiInstance) {
    state.socket = socketInstance;
    state.UI = uiInstance;
  }

  // --- WATCHDOG (Sincronização) ---
  function startWatchdog() {
    if (state.watchdogInterval) return;
    state.lastPacketTime = Date.now();
    state.watchdogInterval = setInterval(() => {
      if (
        state.currentRoom &&
        !state.isGameOver &&
        Date.now() - state.lastPacketTime > 10000
      ) {
        state.socket.emit("requestGameSync", { roomCode: state.currentRoom });
        state.lastPacketTime = Date.now();
      }
    }, 2000);
  }

  function stopWatchdog() {
    if (state.watchdogInterval) {
      clearInterval(state.watchdogInterval);
      state.watchdogInterval = null;
    }
  }

  // --- REPLAY ---
  async function startReplay() {
    if (
      !state.savedReplayData ||
      !state.savedReplayData.history ||
      state.savedReplayData.history.length === 0
    ) {
      alert("Nenhum replay disponível.");
      return;
    }

    state.isReplaying = true;
    document.getElementById("game-over-overlay").classList.add("hidden");

    state.UI.elements.gameStatus.innerHTML =
      "<span style='color:#f1c40f'>REPLAY DA PARTIDA</span>";
    state.UI.elements.spectatorLeaveBtn.classList.remove("hidden");
    state.UI.elements.spectatorLeaveBtn.textContent = "Sair do Replay";
    state.UI.updateTurnIndicator(false);

    state.boardState = JSON.parse(
      JSON.stringify(state.savedReplayData.initialBoard)
    );
    const replayBoardSize =
      state.savedReplayData.boardSize || state.currentBoardSize;
    state.UI.renderPieces(state.boardState, replayBoardSize);

    for (const move of state.savedReplayData.history) {
      if (!state.isReplaying) break;
      await new Promise((r) => setTimeout(r, 800));
      if (!state.isReplaying) break;

      await state.UI.animatePieceMove(move.from, move.to, replayBoardSize);
      state.UI.playAudio("move");

      state.boardState = move.boardState;
      state.UI.renderPieces(state.boardState, replayBoardSize);
    }

    if (state.isReplaying) {
      state.isReplaying = false;
      alert("Replay finalizado.");
      document.getElementById("game-over-overlay").classList.remove("hidden");
      state.UI.elements.spectatorLeaveBtn.classList.add("hidden");
    }
  }

  // --- ESPECTADOR ---
  function initializeSpectatorMode(roomCode, gameState) {
    state.currentRoom = roomCode;
    state.myColor = null;
    window.isSpectator = true;
    state.isReplaying = false;
    state.isGameOver = false;

    state.boardState = gameState.boardState;
    state.currentBoardSize = gameState.boardSize || 8;
    state.currentTurnCapturedPieces = gameState.turnCapturedPieces || [];

    // UI: Mostra o jogo e esconde loading
    const loadingEl =
      document.getElementById("loading-overlay") ||
      document.getElementById("loading-screen");
    if (loadingEl) loadingEl.classList.add("hidden");

    // Use API de UI consistente para mostrar a tela de jogo
    if (state.UI && state.UI.showGameScreen) state.UI.showGameScreen(true);

    // Garante orientação padrão (brancas embaixo) para espectadores
    if (state.UI && state.UI.elements && state.UI.elements.board)
      state.UI.elements.board.classList.remove("board-flipped");

    state.UI.elements.gameStatus.innerHTML =
      "<span style='color:#3498db'>MODO ESPECTADOR</span>";
    state.UI.elements.spectatorLeaveBtn.classList.remove("hidden");
    state.UI.elements.spectatorLeaveBtn.textContent = "Sair";

    state.UI.updateTurnIndicator(false);

    // Cria o tabuleiro antes de desenhar as peças (evita falha quando o DOM não existe)
    if (state.UI && state.UI.createBoard) {
      // Garantia extra: se não houver boardState no payload, inicializa um vazio
      if (!Array.isArray(state.boardState) || state.boardState.length === 0) {
        const size = state.currentBoardSize || 8;
        const empty = Array.from({ length: size }, () =>
          Array.from({ length: size }, () => 0)
        );
        state.boardState = empty;
      }

      // Força visibilidade do container de jogo
      try {
        const gc = document.getElementById("game-container");
        if (gc && gc.classList.contains("hidden"))
          gc.classList.remove("hidden");
      } catch (e) {}

      state.UI.createBoard(state.currentBoardSize, handleBoardClick);
      state.UI.renderPieces(state.boardState, state.currentBoardSize);
    }

    // Garantir que botões de jogador não apareçam para espectadores
    try {
      if (state.UI && state.UI.elements) {
        if (state.UI.elements.resignBtn)
          state.UI.elements.resignBtn.classList.add("hidden");
        if (state.UI.elements.drawBtn)
          state.UI.elements.drawBtn.classList.add("hidden");
      }
      // Também marca globalmente
      window.isSpectator = true;
    } catch (e) {
      // silencioso
    }
    // Garantir que botões de jogador não apareçam para espectadores (forçado)
    try {
      if (state.UI && state.UI.elements) {
        if (state.UI.elements.resignBtn) {
          state.UI.elements.resignBtn.classList.add("hidden");
          state.UI.elements.resignBtn.style.display = "none";
        }
        if (state.UI.elements.drawBtn) {
          state.UI.elements.drawBtn.classList.add("hidden");
          state.UI.elements.drawBtn.style.display = "none";
        }
        if (state.UI.elements.spectatorIndicator)
          state.UI.elements.spectatorIndicator.classList.remove("hidden");
      }
      // Também marca globalmente
      window.isSpectator = true;
    } catch (e) {
      // silencioso
    }

    startWatchdog();
  }

  // --- MOVIMENTO OTIMISTA (CLIENT-SIDE) ---
  async function performOptimisticMove(from, to, moveId) {
    state.pendingBoardSnapshot = JSON.parse(JSON.stringify(state.boardState));

    state.lastOptimisticMove = {
      from: { row: from.row, col: from.col },
      to: { row: to.row, col: to.col },
      moveId: moveId,
    };

    const movingPiece = state.boardState[from.row][from.col];
    const isKing = movingPiece === "B" || movingPiece === "P";
    state.boardState[to.row][to.col] = movingPiece;
    state.boardState[from.row][from.col] = 0;

    let capturedPos = null;
    const dist = Math.abs(to.row - from.row);

    if (dist > 1) {
      const dr = Math.sign(to.row - from.row);
      const dc = Math.sign(to.col - from.col);
      let r = from.row + dr;
      let c = from.col + dc;
      while (r !== to.row && c !== to.col) {
        if (state.boardState[r][c] !== 0) {
          capturedPos = { row: r, col: c };
          break;
        }
        r += dr;
        c += dc;
      }
    }

    if (capturedPos) {
      state.currentTurnCapturedPieces.push(capturedPos);
      const capturedSquare = document.querySelector(
        `.square[data-row="${capturedPos.row}"][data-col="${capturedPos.col}"]`
      );
      if (capturedSquare) {
        const capturedPieceEl = capturedSquare.querySelector(".piece");
        if (capturedPieceEl) capturedPieceEl.style.opacity = "0.5";
      }
      state.UI.playAudio("capture");
    } else {
      state.UI.playAudio("move");
    }

    // RASTREAMENTO DE PROGRESSO (Regra das 20 Jogadas)
    state.lastMoveWasProgress = !isKing || capturedPos !== null;

    let promoted = false;
    if (!isKing) {
      if (movingPiece === "b" && to.row === 0) {
        state.boardState[to.row][to.col] = "B";
        promoted = true;
      } else if (movingPiece === "p" && to.row === state.currentBoardSize - 1) {
        state.boardState[to.row][to.col] = "P";
        promoted = true;
      }
    }

    await state.UI.animatePieceMove(from, to, state.currentBoardSize);

    state.UI.renderPieces(state.boardState, state.currentBoardSize);
    state.UI.clearHighlights();

    // Re-aplica efeito fantasma após render
    if (state.currentTurnCapturedPieces.length > 0) {
      state.currentTurnCapturedPieces.forEach((pos) => {
        const sq = document.querySelector(
          `.square[data-row="${pos.row}"][data-col="${pos.col}"]`
        );
        if (sq && sq.querySelector(".piece"))
          sq.querySelector(".piece").style.opacity = "0.5";
      });
    }

    // Verifica capturas consecutivas
    if (capturedPos && !promoted && window.gameLogic) {
      const tempGame = {
        boardState: state.boardState,
        boardSize: state.currentBoardSize,
        currentPlayer: state.myColor,
        turnCapturedPieces: state.currentTurnCapturedPieces,
      };

      const nextCaptures = window.gameLogic.getAllPossibleCapturesForPiece(
        to.row,
        to.col,
        tempGame
      );

      if (nextCaptures && nextCaptures.length > 0) {
        const newSquare = document.querySelector(
          `.square[data-row="${to.row}"][data-col="${to.col}"]`
        );
        const newPiece = newSquare ? newSquare.querySelector(".piece") : null;

        if (newPiece) {
          newPiece.classList.add("selected");
          state.selectedPiece = { element: newPiece, row: to.row, col: to.col };
          const validDestinations = nextCaptures.map((seq) => seq[1]);
          state.UI.highlightValidMoves(validDestinations);
          return;
        }
      }
    }
    state.selectedPiece = null;
  }

  // --- INTERAÇÃO COM TABULEIRO ---
  function handleBoardClick(e) {
    if (window.isSpectator || state.isReplaying) return;
    if (!state.myColor) return;
    if (state.isProcessingQueue) return;

    const square = e.target.closest(".square");
    if (!square) return;

    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    const clickedPieceElement = e.target.closest(".piece");

    if (state.selectedPiece) {
      if (square.classList.contains("valid-move-highlight")) {
        const moveFrom = {
          row: state.selectedPiece.row,
          col: state.selectedPiece.col,
        };
        const moveTo = { row, col };
        const moveId =
          Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

        performOptimisticMove(moveFrom, moveTo, moveId).catch(console.error);

        state.socket.emit("playerMove", {
          from: moveFrom,
          to: moveTo,
          room: state.currentRoom,
          moveId: moveId,
        });
        return;
      }
      if (state.selectedPiece.row === row && state.selectedPiece.col === col) {
        state.UI.clearHighlights();
        state.selectedPiece = null;
        return;
      }
      if (clickedPieceElement) {
        const pieceColor = clickedPieceElement.classList.contains("white-piece")
          ? "b"
          : "p";
        if (pieceColor === state.myColor) {
          selectPieceLogic(clickedPieceElement, row, col);
          return;
        }
      }
      return;
    }

    if (clickedPieceElement) {
      const pieceColor = clickedPieceElement.classList.contains("white-piece")
        ? "b"
        : "p";
      if (pieceColor === state.myColor) {
        const mandatoryPieces = document.querySelectorAll(".mandatory-capture");
        if (mandatoryPieces.length > 0) {
          if (clickedPieceElement.classList.contains("mandatory-capture")) {
            selectPieceLogic(clickedPieceElement, row, col);
          }
        } else {
          selectPieceLogic(clickedPieceElement, row, col);
        }
      }
    }
  }

  function selectPieceLogic(pieceElement, row, col) {
    state.UI.clearHighlights();
    pieceElement.classList.add("selected");
    state.selectedPiece = { element: pieceElement, row, col };

    if (window.gameLogic && window.gameLogic.getUniqueCaptureMove) {
      const tempGame = {
        boardState: state.boardState,
        boardSize: state.currentBoardSize,
        currentPlayer: state.myColor,
        mustCaptureWith: null,
        turnCapturedPieces: state.currentTurnCapturedPieces || [],
      };

      const uniqueMove = window.gameLogic.getUniqueCaptureMove(
        row,
        col,
        tempGame
      );
      if (uniqueMove) {
        const moveId =
          Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        performOptimisticMove({ row, col }, uniqueMove.to, moveId).catch(
          console.error
        );

        state.socket.emit("playerMove", {
          from: { row, col },
          to: uniqueMove.to,
          room: state.currentRoom,
          moveId: moveId,
        });
        return;
      }
    }
    state.socket.emit("getValidMoves", {
      row,
      col,
      roomCode: state.currentRoom,
    });
  }

  // --- REVANCHE ---
  function handleRevancheRequest() {
    if (!state.currentRoom || window.isSpectator) return;

    state.socket.emit("requestRevanche", {
      roomCode: state.currentRoom,
    });

    document
      .querySelectorAll(".revanche-btn, .exit-lobby-btn, .replay-btn")
      .forEach((btn) => (btn.disabled = true));

    let seconds = 5; // Mantido 5s conforme solicitado
    const updateStatus = () => {
      document.querySelectorAll(".revanche-status").forEach((el) => {
        el.textContent = `Aguardando... (${seconds}s)`;
      });
    };
    updateStatus();

    if (state.revancheInterval) clearInterval(state.revancheInterval);
    state.revancheInterval = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(state.revancheInterval);
        state.revancheInterval = null;
        // Garante que o servidor saiba que saímos, evitando início tardio
        state.socket.emit("leaveEndGameScreen", {
          roomCode: state.currentRoom,
        });
        returnToLobbyLogic();
      } else {
        updateStatus();
      }
    }, 1000);
  }

  function cancelRevancheTimeout() {
    if (state.revancheInterval) {
      clearInterval(state.revancheInterval);
      state.revancheInterval = null;
    }
  }

  // --- RETORNO AO LOBBY ---
  function returnToLobbyLogic() {
    state.isGameOver = false;
    window.isSpectator = false;
    state.isReplaying = false;
    state.savedReplayData = null;
    stopWatchdog();
    if (state.drawCooldownInterval) clearInterval(state.drawCooldownInterval);
    if (state.nextGameInterval) clearInterval(state.nextGameInterval);
    if (state.revancheInterval) clearInterval(state.revancheInterval);

    state.currentRoom = null;
    state.myColor = null;
    state.currentBoardSize = 8;
    state.updateQueue = [];
    state.currentTurnCapturedPieces = [];
    state.isProcessingQueue = false;
    state.lastOptimisticMove = null;
    state.pendingBoardSnapshot = null;
    state.boardState = [];
    state.drawMovesCounter = 0;

    localStorage.removeItem("checkersCurrentRoom");

    state.UI.returnToLobbyScreen();
    document.getElementById("tournament-indicator").classList.add("hidden");
    if (window.currentUser) state.socket.emit("enterLobby", window.currentUser);
  }

  // --- FILA DE PROCESSAMENTO ---
  async function processUpdateQueue() {
    if (state.isProcessingQueue) return;
    state.isProcessingQueue = true;

    while (state.updateQueue.length > 0) {
      const updateData = state.updateQueue.shift();
      try {
        await processGameUpdate(updateData);
        state.UI.highlightMandatoryPieces(updateData.mandatoryPieces);
      } catch (e) {
        console.error("Erro ao processar atualização da fila:", e);
      }
    }

    state.isProcessingQueue = false;
  }

  // --- PROCESSAMENTO DO JOGO (UPDATE) ---
  async function processGameUpdate(gameState, suppressSound = false) {
    if (!gameState || !gameState.boardState) return;
    state.lastPacketTime = Date.now();

    let skipAnimation = false;
    let isMyMove = false;
    let moveDist = 0;

    // FIX: Sincronização forçada com o servidor para evitar fantasmas
    if (Array.isArray(gameState.turnCapturedPieces)) {
      state.currentTurnCapturedPieces.forEach((pos) => {
        const sq = document.querySelector(
          `.square[data-row="${pos.row}"][data-col="${pos.col}"]`
        );
        if (sq) {
          const p = sq.querySelector(".piece");
          if (p) p.style.opacity = "1";
        }
      });
      state.currentTurnCapturedPieces = [...gameState.turnCapturedPieces];
    }

    // 1. CÁLCULO E GESTÃO DE PEÇAS CAPTURADAS (Fantasmas)
    if (gameState.lastMove) {
      moveDist = Math.abs(
        gameState.lastMove.to.row - gameState.lastMove.from.row
      );

      // Se houve salto, identifica as peças capturadas no caminho
      if (moveDist > 1 && !Array.isArray(gameState.turnCapturedPieces)) {
        const dr = Math.sign(
          gameState.lastMove.to.row - gameState.lastMove.from.row
        );
        const dc = Math.sign(
          gameState.lastMove.to.col - gameState.lastMove.from.col
        );
        let r = gameState.lastMove.from.row + dr;
        let c = gameState.lastMove.from.col + dc;

        while (
          r !== gameState.lastMove.to.row &&
          c !== gameState.lastMove.to.col
        ) {
          const alreadyExists = state.currentTurnCapturedPieces.some(
            (p) => p.row === r && p.col === c
          );
          if (!alreadyExists) {
            state.currentTurnCapturedPieces.push({ row: r, col: c });
          }
          r += dr;
          c += dc;
        }
      }

      // Verifica troca de turno
      if (!Array.isArray(gameState.turnCapturedPieces)) {
        const destPiece =
          gameState.boardState[gameState.lastMove.to.row][
            gameState.lastMove.to.col
          ];
        let movedColor = null;
        if (destPiece === "b" || destPiece === "B") movedColor = "b";
        else if (destPiece === "p" || destPiece === "P") movedColor = "p";

        if (movedColor && gameState.currentPlayer !== movedColor) {
          state.currentTurnCapturedPieces.forEach((pos) => {
            const sq = document.querySelector(
              `.square[data-row="${pos.row}"][data-col="${pos.col}"]`
            );
            if (sq) {
              const p = sq.querySelector(".piece");
              if (p) p.style.opacity = "1";
            }
          });
          state.currentTurnCapturedPieces = [];
        }
      }

      // Verifica Otimização
      if (
        state.lastOptimisticMove &&
        gameState.lastMove.moveId === state.lastOptimisticMove.moveId
      ) {
        skipAnimation = true;
        isMyMove = true;
        state.lastOptimisticMove = null;
        state.pendingBoardSnapshot = null;
      } else if (
        state.lastOptimisticMove &&
        gameState.lastMove.from.row === state.lastOptimisticMove.from.row &&
        gameState.lastMove.from.col === state.lastOptimisticMove.from.col &&
        gameState.lastMove.to.row === state.lastOptimisticMove.to.row &&
        gameState.lastMove.to.col === state.lastOptimisticMove.to.col
      ) {
        skipAnimation = true;
        isMyMove = true;
        state.lastOptimisticMove = null;
        state.pendingBoardSnapshot = null;
      }
    }

    // 2. APLICAÇÃO DO EFEITO FANTASMA (ANTES DA ANIMAÇÃO)
    if (state.currentTurnCapturedPieces.length > 0) {
      state.currentTurnCapturedPieces.forEach((pos) => {
        const sq = document.querySelector(
          `.square[data-row="${pos.row}"][data-col="${pos.col}"]`
        );
        if (sq) {
          const pieceEl = sq.querySelector(".piece");
          if (pieceEl) pieceEl.style.opacity = "0.5";
        }
      });
    }

    // 3. ANIMAÇÃO
    if (gameState.lastMove && !suppressSound && !skipAnimation) {
      await state.UI.animatePieceMove(
        gameState.lastMove.from,
        gameState.lastMove.to,
        gameState.boardSize
      );
    }

    if (!suppressSound && !isMyMove) {
      if (gameState.lastMove) {
        if (moveDist > 1) state.UI.playAudio("capture");
        else state.UI.playAudio("move");
      }
    }

    // --- REGRA DAS 20 JOGADAS ---
    if (gameState.lastMove) {
      let isProgress = false;
      if (skipAnimation) {
        isProgress = state.lastMoveWasProgress;
      } else {
        // Movimento do oponente ou sync: verifica estado anterior
        const from = gameState.lastMove.from;
        const piece = state.boardState[from.row][from.col];
        const isKing = piece === "B" || piece === "P";
        const dist = Math.abs(gameState.lastMove.to.row - from.row);
        const isCapture =
          (gameState.turnCapturedPieces &&
            gameState.turnCapturedPieces.length > 0) ||
          dist > 1;
        isProgress = !isKing || isCapture;
      }

      if (isProgress) state.drawMovesCounter = 0;
      else state.drawMovesCounter++;

      if (state.drawMovesCounter >= 20 && !state.isGameOver) {
        if (
          state.drawMovesCounter === 20 &&
          state.myColor &&
          !window.isSpectator
        ) {
          // Solicita empate automaticamente ao atingir o limite
          state.socket.emit("requestDraw", {
            roomCode: state.currentRoom,
            reason: "Regra das 20 Jogadas",
          });
        }
      }
    }

    // 4. ATUALIZAÇÃO DO ESTADO E RENDERIZAÇÃO
    const localStateJson = JSON.stringify(state.boardState);
    const serverStateJson = JSON.stringify(gameState.boardState);

    if (localStateJson !== serverStateJson) {
      state.boardState = gameState.boardState;
      state.UI.renderPieces(state.boardState, gameState.boardSize);
    } else {
      state.boardState = gameState.boardState;
    }

    // 5. RESTAURAÇÃO FANTASMA
    if (state.currentTurnCapturedPieces.length > 0) {
      const ghostClass =
        gameState.currentPlayer === "b" ? "black-piece" : "white-piece";
      state.currentTurnCapturedPieces.forEach((pos) => {
        const sq = document.querySelector(
          `.square[data-row="${pos.row}"][data-col="${pos.col}"]`
        );
        if (sq) {
          let pieceEl = sq.querySelector(".piece");
          if (!pieceEl) {
            pieceEl = document.createElement("div");
            pieceEl.classList.add("piece", ghostClass);
            sq.appendChild(pieceEl);
          }
          pieceEl.style.opacity = "0.5";
        }
      });
    }

    if (state.UI.elements.turnDisplay) {
      let turnText = gameState.currentPlayer === "b" ? "Brancas" : "Pretas";
      if (state.drawMovesCounter >= 10)
        turnText += ` (${state.drawMovesCounter}/20)`;
      state.UI.elements.turnDisplay.textContent = turnText;
    }

    state.UI.highlightLastMove(gameState.lastMove);

    if (!window.isSpectator) {
      const normalizePlayer = (val) => {
        if (!val) return null;
        if (val === "b" || val === "p") return val;
        const s = String(val).toLowerCase();
        if (s.includes("branc") || s.includes("white")) return "b";
        if (s.includes("pret") || s.includes("black") || s.includes("preta"))
          return "p";
        return null;
      };

      const normalizedCurrent = normalizePlayer(gameState.currentPlayer);
      const myCanonical = state.myColor === "b" ? "b" : "p";
      const isMyTurn =
        normalizedCurrent && myCanonical && normalizedCurrent === myCanonical;
      state.UI.updateTurnIndicator(!!isMyTurn);
      if (isMyTurn && !suppressSound && navigator.vibrate) {
        try {
          navigator.vibrate(200);
        } catch (e) {}
      }
    }

    // Atualiza estado do timer conforme enviado pelo servidor (se disponível)
    const timerData = {};
    if (gameState.timerActive !== undefined)
      timerData.timerActive = gameState.timerActive;
    if (gameState.whiteTime !== undefined)
      timerData.whiteTime = gameState.whiteTime;
    if (gameState.blackTime !== undefined)
      timerData.blackTime = gameState.blackTime;
    if (gameState.timeLeft !== undefined)
      timerData.timeLeft = gameState.timeLeft;
    if (gameState.currentPlayer !== undefined)
      timerData.currentPlayer = gameState.currentPlayer;
    if (Object.keys(timerData).length > 0) handleTimerState(timerData);
  }

  return {
    state,
    init,
    startWatchdog,
    stopWatchdog,
    startReplay,
    initializeSpectatorMode,
    performOptimisticMove,
    handleBoardClick,
    returnToLobbyLogic,
    processUpdateQueue,
    processGameUpdate,
    // Timer API
    handleTimerState,
    startTimer,
    stopTimer,
    handleRevancheRequest,
    cancelRevancheTimeout,
  };
})();
