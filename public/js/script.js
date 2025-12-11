// public/script.js - Gerencia Lógica do Jogo e Inicialização
document.addEventListener("DOMContentLoaded", () => {
  UI.init();

  // Inicializa Socket Globalmente
  const socket = io({ autoConnect: false });

  // Variáveis Globais de Jogo
  window.currentUser = null; // Gerenciado pelo lobby.js
  window.isSpectator = false; // Gerenciado pelo lobby.js e aqui

  // Variáveis Locais de Jogo
  let myColor = null;
  let currentRoom = null;
  let boardState = [];
  let selectedPiece = null;
  let currentBoardSize = 8;
  let nextGameInterval = null;
  let isGameOver = false;
  let drawCooldownInterval = null;
  let lastPacketTime = Date.now();
  let watchdogInterval = null;

  // INICIALIZA O MÓDULO DE LOBBY
  if (window.initLobby) {
    window.initLobby(socket, UI);
  }

  // --- LÓGICA DO JOGO ---

  function startWatchdog() {
    if (watchdogInterval) return;
    lastPacketTime = Date.now();
    watchdogInterval = setInterval(() => {
      if (currentRoom && !isGameOver && Date.now() - lastPacketTime > 5000) {
        socket.emit("requestGameSync", { roomCode: currentRoom });
        lastPacketTime = Date.now();
      }
    }, 1000);
  }

  function stopWatchdog() {
    if (watchdogInterval) {
      clearInterval(watchdogInterval);
      watchdogInterval = null;
    }
  }

  // Botões de Jogo
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
  });

  // Interação com o Tabuleiro
  function handleBoardClick(e) {
    if (window.isSpectator) return;
    if (!myColor) return;

    const square = e.target.closest(".square");
    if (!square) return;

    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    const clickedPieceElement = e.target.closest(".piece");

    if (selectedPiece) {
      if (square.classList.contains("valid-move-highlight")) {
        socket.emit("playerMove", {
          from: { row: selectedPiece.row, col: selectedPiece.col },
          to: { row, col },
          room: currentRoom,
        });
        UI.clearHighlights();
        selectedPiece = null;
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

    // Verificação de movimento único para agilizar
    if (window.gameLogic && window.gameLogic.getUniqueCaptureMove) {
      const tempGame = {
        boardState: boardState,
        boardSize: currentBoardSize,
        currentPlayer: myColor,
        mustCaptureWith: null,
      };
      const uniqueMove = window.gameLogic.getUniqueCaptureMove(
        row,
        col,
        tempGame
      );
      if (uniqueMove) {
        socket.emit("playerMove", {
          from: { row, col },
          to: uniqueMove.to,
          room: currentRoom,
        });
        UI.clearHighlights();
        selectedPiece = null;
        return;
      }
    }
    socket.emit("getValidMoves", { row, col, roomCode: currentRoom });
  }

  function returnToLobbyLogic() {
    isGameOver = false;
    window.isSpectator = false;
    stopWatchdog();
    if (drawCooldownInterval) clearInterval(drawCooldownInterval);
    if (nextGameInterval) clearInterval(nextGameInterval);

    currentRoom = null;
    myColor = null;
    currentBoardSize = 8;
    localStorage.removeItem("checkersCurrentRoom");

    UI.returnToLobbyScreen();
    document.getElementById("tournament-indicator").classList.add("hidden");
    if (window.currentUser) socket.emit("enterLobby", window.currentUser);
  }

  async function processGameUpdate(gameState, suppressSound = false) {
    if (!gameState || !gameState.boardState) return;
    lastPacketTime = Date.now();

    if (gameState.lastMove && !suppressSound) {
      await UI.animatePieceMove(
        gameState.lastMove.from,
        gameState.lastMove.to,
        gameState.boardSize
      );
    }

    let oldPieceCount = 0;
    boardState.forEach((r) =>
      r.forEach((p) => {
        if (p !== 0) oldPieceCount++;
      })
    );

    let newPieceCount = 0;
    gameState.boardState.forEach((r) =>
      r.forEach((p) => {
        if (p !== 0) newPieceCount++;
      })
    );

    if (!suppressSound && newPieceCount > 0 && oldPieceCount > 0) {
      if (newPieceCount < oldPieceCount) UI.playAudio("capture");
      else UI.playAudio("move");
    }

    boardState = gameState.boardState;
    UI.renderPieces(boardState, gameState.boardSize);

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

  // --- LISTENERS DE SOCKET DO JOGO ---

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
    UI.createBoard(currentBoardSize, handleBoardClick);

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
    if (window.isSpectator) return;

    try {
      if (!gameState || !gameState.boardState)
        throw new Error("Dados inválidos");

      isGameOver = false;
      stopWatchdog();

      UI.showGameScreen(false);
      currentBoardSize = gameState.boardSize;
      UI.createBoard(currentBoardSize, handleBoardClick);

      currentRoom = gameState.roomCode;
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

      processGameUpdate(gameState, true);
      UI.highlightMandatoryPieces(gameState.mandatoryPieces);
      UI.updatePlayerNames(gameState.users);

      // Toca som de entrada
      if (!window.isSpectator) UI.playAudio("join");
    } catch (e) {
      console.error(e);
      alert("Erro ao iniciar.");
      returnToLobbyLogic();
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

  socket.on("gameStateUpdate", async (gs) => {
    await processGameUpdate(gs);
    UI.highlightMandatoryPieces(gs.mandatoryPieces);
  });

  socket.on("showValidMoves", (moves) => {
    if (!window.isSpectator) UI.highlightValidMoves(moves);
  });

  socket.on("gameResumed", (data) => {
    lastPacketTime = Date.now();
    if (window.isSpectator) return;

    document.getElementById("connection-lost-overlay").classList.add("hidden");
    currentBoardSize = data.gameState.boardSize;
    UI.createBoard(currentBoardSize, handleBoardClick);

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

    document.getElementById("connection-lost-overlay").classList.add("hidden");
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
        } else {
          document.getElementById("loser-screen").classList.remove("hidden");
          document.querySelector("#loser-screen .revanche-btn").style.display =
            "none";
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
    document.getElementById("connection-lost-overlay").classList.add("hidden");
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

  // --- Listeners de Torneio (Brackets e Match Ready) ---
  socket.on("tournamentStarted", (data) =>
    showTournamentBracket(data.bracket, 1)
  );
  socket.on("tournamentRoundUpdate", (data) =>
    showTournamentBracket(data.bracket, data.round)
  );
  socket.on("tournamentEnded", (data) => {
    alert(
      `Torneio Finalizado!\nCampeão: ${
        data.winner
      } (+R$ ${data.championPrize.toFixed(2)})\nVice: ${
        data.runnerUp
      } (+R$ ${data.runnerUpPrize.toFixed(2)})`
    );
    if (window.updateTournamentStatus) window.updateTournamentStatus();
    if (window.currentUser) window.location.reload(); // Recarrega para atualizar saldo/status limpo
  });
  socket.on("tournamentCancelled", (data) => {
    alert(data.message);
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
