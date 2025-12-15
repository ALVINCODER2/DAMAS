// public/script.js - Gerencia Lógica do Jogo (Versão Final: Sem Alertas + Persistência de Torneio)
document.addEventListener("DOMContentLoaded", () => {
  UI.init();

  const socket = io({ autoConnect: false });

  // Variáveis Globais de Jogo
  window.currentUser = null;
  window.isSpectator = false;

  // Variáveis Locais de Jogo
  let myColor = null;
  let currentRoom = null;
  let boardState = []; // Estado local
  let selectedPiece = null;
  let currentBoardSize = 8;
  let nextGameInterval = null;
  let isGameOver = false;
  let drawCooldownInterval = null;
  let lastPacketTime = Date.now();
  let watchdogInterval = null;

  let currentTurnCapturedPieces = [];

  // --- VARIÁVEIS PARA OTIMIZAÇÃO (Lag Zero) ---
  let lastOptimisticMove = null;
  let pendingBoardSnapshot = null;

  // --- VARIÁVEIS PARA REPLAY ---
  let savedReplayData = null;
  let isReplaying = false;

  // --- FILA DE ATUALIZAÇÕES ---
  let updateQueue = [];
  let isProcessingQueue = false;

  async function processUpdateQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (updateQueue.length > 0) {
      const updateData = updateQueue.shift();
      try {
        await processGameUpdate(updateData);
        UI.highlightMandatoryPieces(updateData.mandatoryPieces);
      } catch (e) {
        console.error("Erro ao processar atualização da fila:", e);
      }
    }

    isProcessingQueue = false;
  }

  if (window.initLobby) {
    window.initLobby(socket, UI);
  }

  // --- LÓGICA DO JOGO ---

  function startWatchdog() {
    if (watchdogInterval) return;
    lastPacketTime = Date.now();
    watchdogInterval = setInterval(() => {
      if (currentRoom && !isGameOver && Date.now() - lastPacketTime > 10000) {
        socket.emit("requestGameSync", { roomCode: currentRoom });
        lastPacketTime = Date.now();
      }
    }, 2000);
  }

  function stopWatchdog() {
    if (watchdogInterval) {
      clearInterval(watchdogInterval);
      watchdogInterval = null;
    }
  }

  document.getElementById("resign-btn").addEventListener("click", () => {
    if (currentRoom && !window.isSpectator && confirm("Deseja desistir?"))
      socket.emit("playerResign");
  });

  document.getElementById("draw-btn").addEventListener("click", () => {
    if (currentRoom && !window.isSpectator) {
      document.getElementById("draw-btn").disabled = true;
      socket.emit("requestDraw", { roomCode: currentRoom });
    }
  });

  document
    .getElementById("spectator-leave-btn")
    .addEventListener("click", () => {
      if (isReplaying) {
        isReplaying = false;
        document.getElementById("game-over-overlay").classList.remove("hidden");
        UI.elements.spectatorIndicator.classList.add("hidden");
        UI.elements.spectatorLeaveBtn.classList.add("hidden");
        return;
      }
      socket.emit("leaveEndGameScreen", { roomCode: currentRoom });
      returnToLobbyLogic();
    });

  document.getElementById("accept-draw-btn").addEventListener("click", () => {
    if (currentRoom) {
      socket.emit("acceptDraw", { roomCode: currentRoom });
      document.getElementById("draw-request-overlay").classList.add("hidden");
    }
  });

  document.getElementById("decline-draw-btn").addEventListener("click", () => {
    if (currentRoom) {
      socket.emit("declineDraw", { roomCode: currentRoom });
      document.getElementById("draw-request-overlay").classList.add("hidden");
    }
  });

  document.body.addEventListener("click", (e) => {
    if (e.target.classList.contains("revanche-btn")) {
      if (currentRoom && !window.isSpectator) {
        socket.emit("requestRevanche", { roomCode: currentRoom });
        document
          .querySelectorAll(".revanche-status")
          .forEach((el) => (el.textContent = "Aguardando oponente..."));
        document
          .querySelectorAll(".revanche-btn, .exit-lobby-btn")
          .forEach((btn) => (btn.disabled = true));
      }
    }
    if (e.target.classList.contains("exit-lobby-btn")) {
      if (currentRoom)
        socket.emit("leaveEndGameScreen", { roomCode: currentRoom });
      returnToLobbyLogic();
    }
    if (e.target.classList.contains("replay-btn")) {
      startReplay();
    }
  });

  async function startReplay() {
    if (
      !savedReplayData ||
      !savedReplayData.history ||
      savedReplayData.history.length === 0
    ) {
      alert("Nenhum replay disponível.");
      return;
    }

    isReplaying = true;
    document.getElementById("game-over-overlay").classList.add("hidden");

    UI.elements.gameStatus.innerHTML =
      "<span style='color:#f1c40f'>REPLAY DA PARTIDA</span>";
    UI.elements.spectatorLeaveBtn.classList.remove("hidden");
    UI.elements.spectatorLeaveBtn.textContent = "Sair do Replay";
    UI.updateTurnIndicator(false);

    boardState = JSON.parse(JSON.stringify(savedReplayData.initialBoard));
    const replayBoardSize = savedReplayData.boardSize || currentBoardSize;
    UI.renderPieces(boardState, replayBoardSize);

    for (const move of savedReplayData.history) {
      if (!isReplaying) break;
      await new Promise((r) => setTimeout(r, 800));
      if (!isReplaying) break;

      await UI.animatePieceMove(move.from, move.to, replayBoardSize);
      UI.playAudio("move");

      boardState = move.boardState;
      UI.renderPieces(boardState, replayBoardSize);
    }

    if (isReplaying) {
      isReplaying = false;
      alert("Replay finalizado.");
      document.getElementById("game-over-overlay").classList.remove("hidden");
      UI.elements.spectatorLeaveBtn.classList.add("hidden");
    }
  }

  // --- OTIMIZAÇÃO: Executa movimento e calcula próxima captura localmente ---
  async function performOptimisticMove(from, to, moveId) {
    pendingBoardSnapshot = JSON.parse(JSON.stringify(boardState));

    lastOptimisticMove = {
      from: { row: from.row, col: from.col },
      to: { row: to.row, col: to.col },
      moveId: moveId,
    };

    const movingPiece = boardState[from.row][from.col];
    const isKing = movingPiece === "B" || movingPiece === "P";
    boardState[to.row][to.col] = movingPiece;
    boardState[from.row][from.col] = 0;

    let capturedPos = null;
    const dist = Math.abs(to.row - from.row);

    if (dist > 1) {
      const dr = Math.sign(to.row - from.row);
      const dc = Math.sign(to.col - from.col);
      let r = from.row + dr;
      let c = from.col + dc;
      while (r !== to.row && c !== to.col) {
        if (boardState[r][c] !== 0) {
          capturedPos = { row: r, col: c };
          break;
        }
        r += dr;
        c += dc;
      }
    }

    if (capturedPos) {
      currentTurnCapturedPieces.push(capturedPos);
      const capturedSquare = document.querySelector(
        `.square[data-row="${capturedPos.row}"][data-col="${capturedPos.col}"]`
      );
      if (capturedSquare) {
        const capturedPieceEl = capturedSquare.querySelector(".piece");
        if (capturedPieceEl) capturedPieceEl.style.opacity = "0.5";
      }
      UI.playAudio("capture");
    } else {
      UI.playAudio("move");
    }

    let promoted = false;
    if (!isKing) {
      if (movingPiece === "b" && to.row === 0) {
        boardState[to.row][to.col] = "B";
        promoted = true;
      } else if (movingPiece === "p" && to.row === currentBoardSize - 1) {
        boardState[to.row][to.col] = "P";
        promoted = true;
      }
    }

    await UI.animatePieceMove(from, to, currentBoardSize);

    UI.renderPieces(boardState, currentBoardSize);
    UI.clearHighlights();

    if (currentTurnCapturedPieces.length > 0) {
      currentTurnCapturedPieces.forEach((pos) => {
        const sq = document.querySelector(
          `.square[data-row="${pos.row}"][data-col="${pos.col}"]`
        );
        if (sq && sq.querySelector(".piece"))
          sq.querySelector(".piece").style.opacity = "0.5";
      });
    }

    if (capturedPos && !promoted && window.gameLogic) {
      const tempGame = {
        boardState: boardState,
        boardSize: currentBoardSize,
        currentPlayer: myColor,
        turnCapturedPieces: currentTurnCapturedPieces,
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
          selectedPiece = { element: newPiece, row: to.row, col: to.col };
          const validDestinations = nextCaptures.map((seq) => seq[1]);
          UI.highlightValidMoves(validDestinations);
          return;
        }
      }
    }
    selectedPiece = null;
  }

  function handleBoardClick(e) {
    if (window.isSpectator || isReplaying) return;
    if (!myColor) return;
    if (isProcessingQueue) return;

    const square = e.target.closest(".square");
    if (!square) return;

    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    const clickedPieceElement = e.target.closest(".piece");

    if (selectedPiece) {
      if (square.classList.contains("valid-move-highlight")) {
        const moveFrom = { row: selectedPiece.row, col: selectedPiece.col };
        const moveTo = { row, col };
        const moveId =
          Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

        performOptimisticMove(moveFrom, moveTo, moveId).catch(console.error);

        socket.emit("playerMove", {
          from: moveFrom,
          to: moveTo,
          room: currentRoom,
          moveId: moveId,
        });
        return;
      }
      if (selectedPiece.row === row && selectedPiece.col === col) {
        UI.clearHighlights();
        selectedPiece = null;
        return;
      }
      if (clickedPieceElement) {
        const pieceColor = clickedPieceElement.classList.contains("white-piece")
          ? "b"
          : "p";
        if (pieceColor === myColor) {
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
      if (pieceColor === myColor) {
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
    UI.clearHighlights();
    pieceElement.classList.add("selected");
    selectedPiece = { element: pieceElement, row, col };

    if (window.gameLogic && window.gameLogic.getUniqueCaptureMove) {
      const tempGame = {
        boardState: boardState,
        boardSize: currentBoardSize,
        currentPlayer: myColor,
        mustCaptureWith: null,
        turnCapturedPieces: currentTurnCapturedPieces || [],
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

        socket.emit("playerMove", {
          from: { row, col },
          to: uniqueMove.to,
          room: currentRoom,
          moveId: moveId,
        });
        return;
      }
    }
    socket.emit("getValidMoves", { row, col, roomCode: currentRoom });
  }

  function returnToLobbyLogic() {
    isGameOver = false;
    window.isSpectator = false;
    isReplaying = false;
    savedReplayData = null;
    stopWatchdog();
    if (drawCooldownInterval) clearInterval(drawCooldownInterval);
    if (nextGameInterval) clearInterval(nextGameInterval);

    currentRoom = null;
    myColor = null;
    currentBoardSize = 8;
    updateQueue = [];
    currentTurnCapturedPieces = [];
    isProcessingQueue = false;
    lastOptimisticMove = null;
    pendingBoardSnapshot = null;
    boardState = [];

    localStorage.removeItem("checkersCurrentRoom");

    UI.returnToLobbyScreen();
    document.getElementById("tournament-indicator").classList.add("hidden");
    if (window.currentUser) socket.emit("enterLobby", window.currentUser);
  }

  async function processGameUpdate(gameState, suppressSound = false) {
    if (!gameState || !gameState.boardState) return;
    lastPacketTime = Date.now();

    currentTurnCapturedPieces = gameState.turnCapturedPieces || [];

    let skipAnimation = false;
    let isMyMove = false;

    if (gameState.lastMove) {
      if (
        lastOptimisticMove &&
        gameState.lastMove.moveId === lastOptimisticMove.moveId
      ) {
        skipAnimation = true;
        isMyMove = true;
        lastOptimisticMove = null;
        pendingBoardSnapshot = null;
      } else if (
        lastOptimisticMove &&
        gameState.lastMove.from.row === lastOptimisticMove.from.row &&
        gameState.lastMove.from.col === lastOptimisticMove.from.col &&
        gameState.lastMove.to.row === lastOptimisticMove.to.row &&
        gameState.lastMove.to.col === lastOptimisticMove.to.col
      ) {
        skipAnimation = true;
        isMyMove = true;
        lastOptimisticMove = null;
        pendingBoardSnapshot = null;
      }
    }

    if (gameState.lastMove && !suppressSound && !skipAnimation) {
      await UI.animatePieceMove(
        gameState.lastMove.from,
        gameState.lastMove.to,
        gameState.boardSize
      );
    }

    if (!suppressSound && !isMyMove) {
      if (gameState.lastMove) {
        const dist = Math.abs(
          gameState.lastMove.from.row - gameState.lastMove.to.row
        );
        if (dist > 1) UI.playAudio("capture");
        else UI.playAudio("move");
      }
    }

    const localStateJson = JSON.stringify(boardState);
    const serverStateJson = JSON.stringify(gameState.boardState);

    if (localStateJson !== serverStateJson) {
      boardState = gameState.boardState;
      UI.renderPieces(boardState, gameState.boardSize);
    } else {
      boardState = gameState.boardState;
    }

    if (currentTurnCapturedPieces.length > 0) {
      currentTurnCapturedPieces.forEach((pos) => {
        const cell = document.querySelector(
          `.square[data-row="${pos.row}"][data-col="${pos.col}"]`
        );
        if (cell) {
          const piece = cell.querySelector(".piece");
          if (piece) piece.style.opacity = "0.5";
        }
      });
    }

    if (UI.elements.turnDisplay)
      UI.elements.turnDisplay.textContent =
        gameState.currentPlayer === "b" ? "Brancas" : "Pretas";

    UI.highlightLastMove(gameState.lastMove);

    if (!window.isSpectator) {
      const isMyTurn =
        gameState.currentPlayer === (myColor === "b" ? "b" : "p");
      UI.updateTurnIndicator(isMyTurn);
      if (isMyTurn && !suppressSound && navigator.vibrate) {
        try {
          navigator.vibrate(200);
        } catch (e) {}
      }
    }
  }

  socket.on("invalidMove", (data) => {
    if (pendingBoardSnapshot) {
      console.warn("Movimento inválido detectado. Revertendo...");
      boardState = pendingBoardSnapshot;
      UI.renderPieces(boardState, currentBoardSize);
      pendingBoardSnapshot = null;
      lastOptimisticMove = null;
    }

    if (navigator.vibrate) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch (e) {}
    }
    const gs = UI.elements.gameStatus;
    const originalText = gs.innerHTML;
    gs.innerHTML = `<span style="color: #e74c3c; font-weight: bold; background: rgba(0,0,0,0.7); padding: 2px 5px; border-radius: 4px;">❌ ${data.message}</span>`;
    setTimeout(() => {
      if (gs.innerHTML.includes("❌")) gs.innerHTML = originalText;
    }, 4000);
  });

  socket.on("connect", () => {
    if (window.currentUser) socket.emit("enterLobby", window.currentUser);
    const savedRoom = localStorage.getItem("checkersCurrentRoom");
    if (window.currentUser && savedRoom) {
      currentRoom = savedRoom;
      socket.emit("rejoinActiveGame", {
        roomCode: currentRoom,
        user: window.currentUser,
      });
      UI.elements.lobbyContainer.classList.add("hidden");
      UI.elements.gameContainer.classList.remove("hidden");
    }
  });

  socket.on("spectatorJoined", (data) => {
    window.isSpectator = true;
    currentRoom = data.gameState.roomCode;
    currentBoardSize = data.gameState.boardSize;
    UI.showGameScreen(true);

    boardState = data.gameState.boardState;
    UI.createBoard(currentBoardSize, handleBoardClick);
    UI.renderPieces(boardState, currentBoardSize);

    processGameUpdate(data.gameState, true);
    UI.highlightMandatoryPieces(data.gameState.mandatoryPieces);
    UI.updatePlayerNames(data.gameState.users);
    UI.updateTimer(data);
  });

  socket.on("gameStart", (gameState) => {
    if (
      window.currentUser &&
      gameState.users &&
      (gameState.users.white === window.currentUser.email ||
        gameState.users.black === window.currentUser.email)
    ) {
      window.isSpectator = false;
    }
    try {
      if (!gameState || !gameState.boardState)
        throw new Error("Dados inválidos");

      isGameOver = false;
      stopWatchdog();
      updateQueue = [];
      isProcessingQueue = false;
      currentTurnCapturedPieces = [];
      lastOptimisticMove = null;

      document.getElementById("game-over-overlay").classList.add("hidden");
      document.getElementById("next-game-overlay").classList.add("hidden");

      UI.showGameScreen(window.isSpectator);

      currentBoardSize = gameState.boardSize;
      boardState = gameState.boardState;

      UI.createBoard(currentBoardSize, handleBoardClick);
      UI.renderPieces(boardState, currentBoardSize);

      currentRoom = gameState.roomCode;

      if (!window.isSpectator) {
        localStorage.setItem("checkersCurrentRoom", currentRoom);
        myColor = socket.id === gameState.players.white ? "b" : "p";
        let statusText = `Você joga com as ${
          myColor === "b" ? "Brancas" : "Pretas"
        }.`;
        if (gameState.openingName)
          statusText += `<br><small>Sorteio: ${gameState.openingName}</small>`;
        UI.elements.gameStatus.innerHTML = statusText;
        UI.elements.board.classList.remove("board-flipped");
        if (myColor === "p") UI.elements.board.classList.add("board-flipped");
      } else {
        myColor = null;
        UI.elements.gameStatus.innerHTML = "Espectador: Nova partida iniciada";
        UI.elements.board.classList.remove("board-flipped");
      }

      processGameUpdate(gameState, true);
      UI.highlightMandatoryPieces(gameState.mandatoryPieces);
      UI.updatePlayerNames(gameState.users);
      UI.playAudio("join");
    } catch (e) {
      console.error(e);
      if (!window.isSpectator) {
        alert("Erro ao iniciar.");
        returnToLobbyLogic();
      }
    }
  });

  socket.on("timerUpdate", (data) => {
    lastPacketTime = Date.now();
    startWatchdog();
    UI.updateTimer(data);
  });

  socket.on("timerPaused", (data) => {
    lastPacketTime = Date.now();
    if (UI.elements.timerDisplay)
      UI.elements.timerDisplay.textContent = "Pausado";
  });

  socket.on("gameStateUpdate", (gs) => {
    updateQueue.push(gs);
    processUpdateQueue();
  });

  socket.on("showValidMoves", (moves) => {
    if (!window.isSpectator) UI.highlightValidMoves(moves);
  });

  socket.on("gameResumed", (data) => {
    lastPacketTime = Date.now();
    if (window.isSpectator) return;
    document.getElementById("connection-lost-overlay").classList.add("hidden");
    updateQueue = [];
    isProcessingQueue = false;

    currentBoardSize = data.gameState.boardSize;
    boardState = data.gameState.boardState;
    UI.createBoard(currentBoardSize, handleBoardClick);
    UI.renderPieces(boardState, currentBoardSize);

    processGameUpdate(data.gameState, true);

    UI.updatePlayerNames(data.gameState.users);
    UI.updateTimer(data);
    myColor = socket.id === data.gameState.players.white ? "b" : "p";
    UI.elements.board.classList.remove("board-flipped");
    if (myColor === "p") UI.elements.board.classList.add("board-flipped");
  });

  socket.on("gameOver", (data) => {
    if (isGameOver) return;
    isGameOver = true;
    stopWatchdog();
    updateQueue = [];
    isProcessingQueue = false;

    savedReplayData = {
      history: data.moveHistory,
      initialBoard: data.initialBoardState,
      boardSize: currentBoardSize,
    };

    document.getElementById("connection-lost-overlay").classList.add("hidden");
    document.getElementById("next-game-overlay").classList.add("hidden");

    UI.resetEndGameUI();
    document.getElementById("game-over-overlay").classList.remove("hidden");

    if (window.isSpectator) {
      document
        .getElementById("spectator-end-screen")
        .classList.remove("hidden");
      const wText = data.winner === "b" ? "Brancas" : "Pretas";
      document.getElementById(
        "spectator-end-message"
      ).textContent = `${wText} venceram! ${data.reason}`;
    } else {
      if (data.isTournament) {
        if (data.winner === myColor) {
          document.getElementById("winner-screen").classList.remove("hidden");
          document.querySelector("#winner-screen .revanche-btn").style.display =
            "none";

          let msg = document.getElementById("trn-winner-wait-msg");
          if (!msg) {
            msg = document.createElement("p");
            msg.id = "trn-winner-wait-msg";
            msg.style.cssText =
              "color: #f1c40f; margin-top: 10px; font-weight: bold;";
            const content = document.querySelector(
              "#winner-screen .modal-content"
            );
            if (content) content.appendChild(msg);
          }
          msg.textContent =
            "Vitória! Aguarde o fim da rodada para o próximo oponente.";
          msg.classList.remove("hidden");
        } else {
          document.getElementById("loser-screen").classList.remove("hidden");
          document.querySelector("#loser-screen .revanche-btn").style.display =
            "none";

          setTimeout(() => {
            if (
              !document
                .getElementById("loser-screen")
                .classList.contains("hidden")
            ) {
              returnToLobbyLogic();
            }
          }, 5000);
        }
      } else {
        if (data.winner === myColor)
          document.getElementById("winner-screen").classList.remove("hidden");
        else document.getElementById("loser-screen").classList.remove("hidden");
      }
    }
  });

  socket.on("gameDraw", (data) => {
    if (isGameOver) return;
    isGameOver = true;
    stopWatchdog();
    updateQueue = [];
    isProcessingQueue = false;

    savedReplayData = {
      history: data.moveHistory,
      initialBoard: data.initialBoardState,
      boardSize: currentBoardSize,
    };

    document.getElementById("connection-lost-overlay").classList.add("hidden");
    document.getElementById("next-game-overlay").classList.add("hidden");

    UI.resetEndGameUI();
    document.getElementById("game-over-overlay").classList.remove("hidden");

    if (window.isSpectator) {
      document
        .getElementById("spectator-end-screen")
        .classList.remove("hidden");
      document.getElementById(
        "spectator-end-message"
      ).textContent = `Empate. ${data.reason}`;
    } else {
      document.getElementById("draw-screen").classList.remove("hidden");
      document.getElementById("draw-reason").textContent = data.reason;
    }
  });

  socket.on("nextGameStarting", (data) => {
    const nextOv = document.getElementById("next-game-overlay");
    nextOv.classList.remove("hidden");
    document.getElementById("game-over-overlay").classList.add("hidden");
    document.getElementById(
      "match-score-display"
    ).textContent = `Placar: ${data.score[0]} - ${data.score[1]}`;
    let cd = 5;
    const tEl = document.getElementById("next-game-timer");
    tEl.textContent = cd;
    if (nextGameInterval) clearInterval(nextGameInterval);
    nextGameInterval = setInterval(() => {
      cd--;
      tEl.textContent = cd;
      if (cd <= 0) clearInterval(nextGameInterval);
    }, 1000);
  });

  socket.on("drawRequestSent", () => {
    document.getElementById("draw-btn").disabled = true;
    document.getElementById("draw-btn").textContent = "Enviado";
  });
  socket.on("drawRequested", () => {
    if (!window.isSpectator)
      document
        .getElementById("draw-request-overlay")
        .classList.remove("hidden");
  });
  socket.on("drawDeclined", () => {
    const gs = UI.elements.gameStatus;
    const old = gs.innerHTML;
    gs.textContent = "Pedido recusado.";
    setTimeout(() => (gs.innerHTML = old), 3000);
    const btn = document.getElementById("draw-btn");
    btn.disabled = true;
    let cd = 30;
    btn.textContent = `Empate (${cd}s)`;
    if (drawCooldownInterval) clearInterval(drawCooldownInterval);
    drawCooldownInterval = setInterval(() => {
      cd--;
      if (cd > 0) btn.textContent = `Empate (${cd}s)`;
      else {
        clearInterval(drawCooldownInterval);
        if (!isGameOver) {
          btn.disabled = false;
          btn.textContent = "Empate";
        }
      }
    }, 1000);
  });
  socket.on("drawOfferCancelled", () =>
    document.getElementById("draw-request-overlay").classList.add("hidden")
  );
  socket.on("revancheDeclined", (d) => {
    document.querySelectorAll(".revanche-status").forEach((el) => {
      el.textContent = d.message;
      el.style.color = "#e74c3c";
    });
    setTimeout(() => {
      if (
        !document
          .getElementById("game-over-overlay")
          .classList.contains("hidden")
      )
        returnToLobbyLogic();
    }, 3000);
  });
  socket.on("gameNotFound", () => {
    alert("Jogo não encontrado.");
    returnToLobbyLogic();
  });
  socket.on("opponentConnectionLost", (d) => {
    if (!window.isSpectator) {
      const ov = document.getElementById("connection-lost-overlay");
      ov.classList.remove("hidden");
      document.getElementById(
        "connection-lost-message"
      ).textContent = `Oponente caiu. Aguarde ${d.waitTime}s...`;
    }
  });
  socket.on("opponentDisconnected", () => {
    if (!window.isSpectator) returnToLobbyLogic();
  });

  socket.on("tournamentStarted", (data) =>
    showTournamentBracket(data.bracket, 1)
  );
  socket.on("tournamentRoundUpdate", (data) =>
    showTournamentBracket(data.bracket, data.round)
  );

  // --- ALTERAÇÃO: Fim do Torneio com Pódio Persistente ---
  socket.on("tournamentEnded", (data) => {
    const today = new Date().toLocaleDateString();
    // Salva o resultado no navegador para exibir o pódio
    localStorage.setItem(
      `tournament_result_${today}`,
      JSON.stringify({
        winner: data.winner,
        championPrize: data.championPrize,
        runnerUp: data.runnerUp,
        runnerUpPrize: data.runnerUpPrize,
      })
    );

    if (window.updateTournamentStatus) window.updateTournamentStatus();
    if (window.currentUser) window.location.reload();
  });

  // --- ALTERAÇÃO: Cancelamento com Status Persistente ---
  socket.on("tournamentCancelled", (data) => {
    const today = new Date().toLocaleDateString();
    // Marca como cancelado para o dia todo
    localStorage.setItem(`tournament_cancelled_${today}`, "true");

    if (window.updateTournamentStatus) window.updateTournamentStatus();
    if (window.currentUser) window.location.reload();
  });

  socket.on("tournamentMatchReady", (data) => {
    if (!window.currentUser) return;
    if (
      data.player1 === window.currentUser.email ||
      data.player2 === window.currentUser.email
    ) {
      socket.emit("rejoinActiveGame", {
        roomCode: data.roomCode,
        user: window.currentUser,
      });
      document
        .getElementById("tournament-bracket-overlay")
        .classList.add("hidden");
      UI.elements.lobbyContainer.classList.add("hidden");
      UI.elements.gameContainer.classList.remove("hidden");
      document
        .getElementById("tournament-indicator")
        .classList.remove("hidden");
      document.getElementById("winner-screen").classList.add("hidden");
      document.getElementById("loser-screen").classList.add("hidden");
    }
  });

  function showTournamentBracket(matches, round) {
    const overlay = document.getElementById("tournament-bracket-overlay");
    const list = document.getElementById("tournament-matches-list");
    const roundTitle = document.getElementById("tournament-round-display");
    const closeBtn = document.getElementById("close-bracket-btn");
    overlay.classList.remove("hidden");
    if (matches.length === 4) roundTitle.textContent = "Quartas de Final";
    else if (matches.length === 2) roundTitle.textContent = "Semifinais";
    else if (matches.length === 1) roundTitle.textContent = "GRANDE FINAL";
    else roundTitle.textContent = `Rodada ${round}`;
    list.innerHTML = "";
    matches.forEach((m) => {
      const div = document.createElement("div");
      div.className = "tournament-match-card";
      const p1 = m.player1 ? m.player1.split("@")[0] : "Aguardando";
      const p2 = m.player2 ? m.player2.split("@")[0] : "Bye";
      let p1Class = "t-player";
      let p2Class = "t-player";
      if (m.winner === m.player1) p1Class += " t-winner";
      if (m.winner === m.player2) p2Class += " t-winner";
      div.innerHTML = `<span class="${p1Class}">${p1}</span><span class="t-vs">VS</span><span class="${p2Class}">${p2}</span>`;
      list.appendChild(div);
    });
    closeBtn.onclick = () => overlay.classList.add("hidden");
  }
});
