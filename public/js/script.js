// public/js/script.js - Inicialização e Wiring de Eventos
// Este arquivo conecta o Socket.IO e os eventos do DOM à lógica do jogo (GameCore)

document.addEventListener("DOMContentLoaded", () => {
  UI.init();

  const socket = io({ autoConnect: false });
  // --- DEBUG: registrar eventos importantes para envio ao suporte ---
  window.__CLIENT_DEBUG = true; // defina false se quiser silenciar
  window.setClientDebug = function (v) {
    window.__CLIENT_DEBUG = !!v;
    console.info("Client debug:", window.__CLIENT_DEBUG);
  };
  const __debugEvents = [
    "connect",
    "disconnect",
    "updateLobby",
    "tournamentUpdate",
    "tournamentStarted",
    "tournamentMatchReady",
    "tournamentRoundUpdate",
    "tournamentMatchEnded",
    "tournamentTieBreak",
    "gameStart",
    "gameStateUpdate",
    "turnPassedDueToInactivity",
    "gameOver",
    "gameDraw",
    "forceReturnToLobby",
    "revancheAccepted",
    "revancheDeclined",
    "invalidMove",
  ];
  __debugEvents.forEach((ev) => {
    socket.on(ev, (payload) => {
      try {
        if (window.__CLIENT_DEBUG) console.log(`[DEBUG socket:${ev}]`, payload);
      } catch (e) {}
    });
  });
  const isGamePage = window.location.pathname.includes("jogo.html");

  // --- Ping indicator (RTT) ---
  function createPingIndicator() {
    if (document.getElementById("ping-indicator")) return;
    const d = document.createElement("div");
    d.id = "ping-indicator";
    d.style.cssText =
      "position:fixed;right:16px;bottom:16px;padding:10px 14px;background:rgba(10,24,40,0.85);color:#fff;border-radius:10px;font-size:14px;font-weight:600;min-width:96px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.6);backdrop-filter:blur(6px);border:2px solid rgba(255,255,255,0.06);z-index:2147483647;cursor:default;";
    d.textContent = "Ping: —";
    document.body.appendChild(d);
  }

  function updatePingIndicator(rtt) {
    createPingIndicator();
    const el = document.getElementById("ping-indicator");
    if (!el) return;
    if (typeof rtt !== "number") {
      el.textContent = "Ping: —";
      el.style.background = "rgba(80,80,80,0.85)";
      el.title = "Aguardando medição...";
      return;
    }
    const v = Math.max(0, Math.round(rtt));
    el.textContent = `Ping: ${v} ms`;
    if (v < 80) {
      el.style.background = "linear-gradient(90deg,#2ecc71,#27ae60)";
      el.title = "Conexão ótima";
    } else if (v < 250) {
      el.style.background = "linear-gradient(90deg,#f1c40f,#e67e22)";
      el.title = "Conexão razoável";
    } else if (v < 600) {
      el.style.background = "linear-gradient(90deg,#e67e22,#e74c3c)";
      el.title = "Latência alta";
    } else {
      el.style.background = "linear-gradient(90deg,#c0392b,#8e44ad)";
      el.title = "Conexão crítica";
    }
  }

  let __pingInterval = null;
  function startPingChecks() {
    if (__pingInterval) return;
    createPingIndicator();
    __pingInterval = setInterval(() => {
      try {
        const t = Date.now();
        socket.emit("pingCheck", t);
        const timeoutId = setTimeout(() => updatePingIndicator("—"), 2500);
        socket.once("pongCheck", (ts) => {
          try {
            if (ts !== t) {
              // ignore mismatched timestamps
              return;
            }
            const rtt = Date.now() - ts;
            clearTimeout(timeoutId);
            updatePingIndicator(rtt);
          } catch (e) {}
        });
      } catch (e) {}
    }, 5000);
  }

  // Start ping checks once connected (or when already connected)
  if (socket.connected) startPingChecks();
  else socket.once("connect", startPingChecks);

  // Inicializa Módulos Globais (Lobby e Auth)
  if (window.initLobby) window.initLobby(socket, UI);
  if (window.initAuth) window.initAuth(socket, UI);

  // Inicializa o Core do Jogo
  window.GameCore.init(socket, UI);

  // --- VARIÁVEIS GLOBAIS DE USUÁRIO (Sincronizadas com o Auth) ---
  window.currentUser = null;
  window.isSpectator = false;

  // Toast removido em limpeza de produção

  // --- RESTAURAÇÃO DE SESSÃO (Apenas na página de jogo) ---
  if (isGamePage) {
    const savedEmail = localStorage.getItem("checkersUserEmail");
    if (savedEmail) {
      fetch("/api/user/re-authenticate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: savedEmail }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            window.currentUser = data.user;
            socket.connect(); // Conecta apenas após recuperar o usuário
          } else {
            window.location.href = "/"; // Falha na auth
          }
        })
        .catch(() => (window.location.href = "/"));
    } else {
      window.location.href = "/"; // Sem usuário salvo
    }
  }

  // =================================================================
  // EVENTOS DO DOM (BOTEIRA E CLICKS)
  // =================================================================

  const safeAddListener = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  };

  safeAddListener("resign-btn", "click", () => {
    if (
      GameCore.state.currentRoom &&
      !window.isSpectator &&
      confirm("Deseja desistir?")
    )
      socket.emit("playerResign");
  });

  safeAddListener("draw-btn", "click", () => {
    if (GameCore.state.currentRoom && !window.isSpectator) {
      document.getElementById("draw-btn").disabled = true;
      socket.emit("requestDraw", { roomCode: GameCore.state.currentRoom });
    }
  });

  safeAddListener("spectator-leave-btn", "click", () => {
    if (GameCore.state.isReplaying) {
      GameCore.state.isReplaying = false;
      document.getElementById("game-over-overlay").classList.remove("hidden");
      UI.elements.spectatorIndicator.classList.add("hidden");
      UI.elements.spectatorLeaveBtn.classList.add("hidden");
      return;
    }
    socket.emit("leaveEndGameScreen", {
      roomCode: GameCore.state.currentRoom,
    });
    GameCore.returnToLobbyLogic();
  });

  safeAddListener("accept-draw-btn", "click", () => {
    if (GameCore.state.currentRoom) {
      socket.emit("acceptDraw", { roomCode: GameCore.state.currentRoom });
      document.getElementById("draw-request-overlay").classList.add("hidden");
    }
  });

  safeAddListener("decline-draw-btn", "click", () => {
    if (GameCore.state.currentRoom) {
      socket.emit("declineDraw", { roomCode: GameCore.state.currentRoom });
      document.getElementById("draw-request-overlay").classList.add("hidden");
    }
  });

  document.body.addEventListener("click", (e) => {
    // Revanche
    if (e.target.classList.contains("revanche-btn")) {
      GameCore.handleRevancheRequest();
    }
    // Sair para Lobby
    if (e.target.classList.contains("exit-lobby-btn")) {
      if (GameCore.state.currentRoom)
        socket.emit("leaveEndGameScreen", {
          roomCode: GameCore.state.currentRoom,
        });
      GameCore.returnToLobbyLogic();
    }
    // Replay
    if (e.target.classList.contains("replay-btn")) {
      GameCore.startReplay();
    }
  });

  // =================================================================
  // EVENTOS DO SOCKET (RECEBIDOS DO SERVIDOR)
  // =================================================================

  socket.on("connect", () => {
    if (window.currentUser) socket.emit("enterLobby", window.currentUser);
    // Prioritize pending spectate requests to avoid rejoining as player
    try {
      const spectateRoom = localStorage.getItem("spectateRoom");
      const spectatePending = localStorage.getItem("spectatePending");
      if (spectateRoom && spectatePending === "1") {
        socket.emit("joinAsSpectator", { roomCode: spectateRoom });
        localStorage.removeItem("spectatePending");
        // Do not attempt to rejoin as player when spectating
        return;
      }
    } catch (e) {}

    const savedRoom = localStorage.getItem("checkersCurrentRoom");
    if (window.currentUser && savedRoom) {
      GameCore.state.currentRoom = savedRoom;
      socket.emit("rejoinActiveGame", {
        roomCode: GameCore.state.currentRoom,
        user: window.currentUser,
      });

      // Se estiver no lobby e reconectar em um jogo, redireciona
      if (!isGamePage) {
        window.location.href = "/jogo.html";
      } else {
        UI.elements.gameContainer.classList.remove("hidden");
      }
    }
    // Fallback: reemitir pedido de espectador caso haja um pedido pendente salvo
    try {
      const spectateRoom = localStorage.getItem("spectateRoom");
      const spectatePending = localStorage.getItem("spectatePending");
      if (spectateRoom && spectatePending === "1") {
        socket.emit("joinAsSpectator", { roomCode: spectateRoom });
        // limpa flag para não repetir
        localStorage.removeItem("spectatePending");
      }
    } catch (e) {}
  });

  socket.on("gameStart", (gameState) => {
    if (!isGamePage) {
      localStorage.setItem("checkersCurrentRoom", gameState.roomCode);
      window.location.href = "/jogo.html";
      return;
    }

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

      // CORREÇÃO CRÍTICA: Garante que qualquer replay pare imediatamente
      GameCore.state.isReplaying = false;
      GameCore.state.isGameOver = false;

      GameCore.cancelRevancheTimeout();
      GameCore.stopWatchdog();
      GameCore.state.updateQueue = [];
      GameCore.state.isProcessingQueue = false;
      GameCore.state.currentTurnCapturedPieces = [];
      GameCore.state.lastOptimisticMove = null;
      GameCore.state.drawMovesCounter = 0;

      document.getElementById("game-over-overlay").classList.add("hidden");
      document.getElementById("next-game-overlay").classList.add("hidden");

      UI.showGameScreen(window.isSpectator);

      GameCore.state.currentBoardSize = gameState.boardSize;
      GameCore.state.boardState = gameState.boardState;

      // Passa a função do Core como callback para o clique no tabuleiro
      UI.createBoard(
        GameCore.state.currentBoardSize,
        GameCore.handleBoardClick
      );
      UI.renderPieces(
        GameCore.state.boardState,
        GameCore.state.currentBoardSize
      );

      GameCore.state.currentRoom = gameState.roomCode;

      if (!window.isSpectator) {
        localStorage.setItem("checkersCurrentRoom", GameCore.state.currentRoom);
        GameCore.state.myColor =
          socket.id === gameState.players.white ? "b" : "p";

        let statusText = `Você joga com as ${
          GameCore.state.myColor === "b" ? "Brancas" : "Pretas"
        }.`;
        if (gameState.openingName)
          statusText += `<br><small>Sorteio: ${gameState.openingName}</small>`;

        UI.elements.gameStatus.innerHTML = statusText;
        UI.elements.board.classList.remove("board-flipped");
        if (GameCore.state.myColor === "p")
          UI.elements.board.classList.add("board-flipped");
      } else {
        GameCore.state.myColor = null;
        UI.elements.gameStatus.innerHTML = "Espectador: Nova partida iniciada";
        UI.elements.board.classList.remove("board-flipped");
      }

      GameCore.processGameUpdate(gameState, true);
      UI.highlightMandatoryPieces(gameState.mandatoryPieces);
      UI.updatePlayerNames(gameState.users);
      UI.playAudio("join");
      // Garantia extra: atualiza indicador de turno imediatamente
      try {
        const normalize = (v) => {
          if (!v) return null;
          if (v === "b" || v === "p") return v;
          const s = String(v).toLowerCase();
          if (s.includes("branc") || s.includes("white")) return "b";
          if (s.includes("pret") || s.includes("black") || s.includes("preta"))
            return "p";
          return null;
        };
        const cur = normalize(gameState.currentPlayer);
        const mine = GameCore.state.myColor === "b" ? "b" : "p";
        UI.updateTurnIndicator(!!(cur && mine && cur === mine));
      } catch (e) {}
    } catch (e) {
      console.error(e);
      if (!window.isSpectator) {
        alert("Erro ao iniciar.");
        GameCore.returnToLobbyLogic();
      }
    }
  });

  socket.on("gameStateUpdate", (gs) => {
    GameCore.state.updateQueue.push(gs);
    GameCore.processUpdateQueue();
  });

  socket.on("invalidMove", (data) => {
    if (GameCore.state.pendingBoardSnapshot) {
      console.warn("Movimento inválido detectado. Revertendo...");
      GameCore.state.boardState = GameCore.state.pendingBoardSnapshot;
      UI.renderPieces(
        GameCore.state.boardState,
        GameCore.state.currentBoardSize
      );
      GameCore.state.pendingBoardSnapshot = null;
      GameCore.state.lastOptimisticMove = null;
    }
    if (navigator.vibrate)
      try {
        navigator.vibrate([100, 50, 100]);
      } catch (e) {}

    const gs = UI.elements.gameStatus;
    const originalText = gs.innerHTML;
    gs.innerHTML = `<span style="color: #e74c3c; font-weight: bold; background: rgba(0,0,0,0.7); padding: 2px 5px; border-radius: 4px;">❌ ${data.message}</span>`;
    setTimeout(() => {
      if (gs.innerHTML.includes("❌")) gs.innerHTML = originalText;
    }, 4000);
  });

  socket.on("spectatorJoined", (payload) => {
    // payload: { gameState, whiteTime?, blackTime?, timeLeft?, timeControl?, isSpectator: true }
    // spectator payload recebido

    if (!isGamePage) {
      if (payload && payload.gameState && payload.gameState.roomCode)
        localStorage.setItem("checkersCurrentRoom", payload.gameState.roomCode);
      window.location.href = "/jogo.html";
      return;
    }

    if (!payload || !payload.gameState) {
      console.warn("spectatorJoined missing gameState");
      return;
    }

    // Garantir que overlays que poderiam bloquear a view estejam ocultos
    [
      "game-over-overlay",
      "next-game-overlay",
      "connection-lost-overlay",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden")) el.classList.add("hidden");
    });

    // Inicializa UI/board como espectador
    GameCore.initializeSpectatorMode(
      payload.gameState.roomCode,
      payload.gameState
    );
    UI.updatePlayerNames(payload.gameState.users);
    UI.highlightMandatoryPieces(payload.gameState.mandatoryPieces || []);

    // Passa estado de tempo (se houver)
    GameCore.handleTimerState({
      timerActive: !!(payload.gameState && payload.gameState.timerActive),
      whiteTime: payload.whiteTime,
      blackTime: payload.blackTime,
      timeLeft: payload.timeLeft,
      currentPlayer: payload.gameState && payload.gameState.currentPlayer,
    });

    // notificação de espectador removida

    // Força exibição do tabuleiro e ocultação de elementos de espera que ainda possam aparecer
    try {
      const boardWrapper = document.getElementById("board-wrapper");
      const boardEl = document.getElementById("board");
      const statusEl = document.getElementById("game-status");
      const playersHud = document.getElementById("players-hud");
      if (boardWrapper) boardWrapper.style.display = "block";
      if (boardEl) boardEl.style.display = "grid";
      if (statusEl) statusEl.style.display = "none";
      if (playersHud) playersHud.style.display = "flex";

      // Esconde botões de jogador por segurança
      const resign = document.getElementById("resign-btn");
      const draw = document.getElementById("draw-btn");
      const specLeave = document.getElementById("spectator-leave-btn");
      if (resign) resign.style.display = "none";
      if (draw) draw.style.display = "none";
      if (specLeave) specLeave.classList.remove("hidden");
    } catch (e) {
      console.warn("Could not force UI adjustments for spectator", e);
    }
    // Atualiza contador de espectadores se fornecido
    try {
      if (payload && payload.spectatorCount !== undefined) {
        const sc = document.getElementById("spectator-count");
        const scn = document.getElementById("spectator-count-number");
        if (sc && scn) {
          scn.textContent = String(payload.spectatorCount || 0);
          sc.classList.remove("hidden");
          sc.style.display = "flex";
        }
      }
    } catch (e) {}
  });

  socket.on("spectatorCount", (data) => {
    try {
      const sc = document.getElementById("spectator-count");
      const scn = document.getElementById("spectator-count-number");
      if (!sc || !scn) return;
      scn.textContent = String(data.count || 0);
      if (data.count && data.count > 0) {
        sc.classList.remove("hidden");
        sc.style.display = "flex";
      } else {
        sc.classList.add("hidden");
        sc.style.display = "none";
      }
    } catch (e) {}
  });

  socket.on("timerUpdate", (data) => {
    GameCore.state.lastPacketTime = Date.now();
    GameCore.startWatchdog();
    // Suporta duas formas de payload: { timerActive, whiteTime, ... } (servidor)
    // ou { gameState: { timerActive, currentPlayer } , whiteTime, ... } (outras partes)
    const timerActive =
      data.timerActive !== undefined
        ? data.timerActive
        : data.gameState && data.gameState.timerActive;
    const currentPlayer =
      data.currentPlayer !== undefined
        ? data.currentPlayer
        : data.gameState && data.gameState.currentPlayer;

    GameCore.handleTimerState({
      timerActive,
      whiteTime: data.whiteTime,
      blackTime: data.blackTime,
      timeLeft: data.timeLeft,
      currentPlayer,
    });
  });

  socket.on("timerPaused", () => {
    GameCore.state.lastPacketTime = Date.now();
    // Atualiza estado do timer no GameCore para garantir que o timer local pare
    try {
      GameCore.handleTimerState({ timerActive: false });
    } catch (e) {}
    if (UI.elements.timerDisplay)
      UI.elements.timerDisplay.textContent = "Pausado";
  });

  socket.on("showValidMoves", (moves) => {
    if (!window.isSpectator) UI.highlightValidMoves(moves);
  });

  socket.on("gameResumed", (data) => {
    if (!isGamePage) {
      window.location.href = "/jogo.html";
      return;
    }

    GameCore.state.lastPacketTime = Date.now();
    if (window.isSpectator) return;
    document.getElementById("connection-lost-overlay").classList.add("hidden");
    GameCore.state.updateQueue = [];
    GameCore.state.isProcessingQueue = false;

    GameCore.state.currentBoardSize = data.gameState.boardSize;
    GameCore.state.boardState = data.gameState.boardState;
    UI.createBoard(GameCore.state.currentBoardSize, GameCore.handleBoardClick);
    UI.renderPieces(GameCore.state.boardState, GameCore.state.currentBoardSize);

    GameCore.processGameUpdate(data.gameState, true);
    UI.updatePlayerNames(data.gameState.users);
    GameCore.handleTimerState(data);

    GameCore.state.myColor =
      socket.id === data.gameState.players.white ? "b" : "p";
    UI.elements.board.classList.remove("board-flipped");
    if (GameCore.state.myColor === "p")
      UI.elements.board.classList.add("board-flipped");
    // Garantia extra: atualiza indicador de turno após rejoin/resume
    try {
      const normalize = (v) => {
        if (!v) return null;
        if (v === "b" || v === "p") return v;
        const s = String(v).toLowerCase();
        if (s.includes("branc") || s.includes("white")) return "b";
        if (s.includes("pret") || s.includes("black") || s.includes("preta"))
          return "p";
        return null;
      };
      const cur = normalize(data.gameState.currentPlayer);
      const mine = GameCore.state.myColor === "b" ? "b" : "p";
      UI.updateTurnIndicator(!!(cur && mine && cur === mine));
    } catch (e) {}
  });

  socket.on("gameOver", (data) => {
    if (GameCore.state.isGameOver) return;
    GameCore.state.isGameOver = true;
    GameCore.stopWatchdog();
    GameCore.state.updateQueue = [];
    GameCore.state.isProcessingQueue = false;

    GameCore.state.savedReplayData = {
      history: data.moveHistory,
      initialBoard: data.initialBoardState,
      boardSize: GameCore.state.currentBoardSize,
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
        if (data.winner === GameCore.state.myColor) {
          document.getElementById("winner-screen").classList.remove("hidden");
          document.querySelector("#winner-screen .revanche-btn").style.display =
            "none";
          let msg = document.getElementById("trn-winner-wait-msg");
          if (!msg) {
            msg = document.createElement("p");
            msg.id = "trn-winner-wait-msg";
            msg.style.cssText =
              "color: #f1c40f; margin-top: 10px; font-weight: bold;";
            document
              .querySelector("#winner-screen .modal-content")
              .appendChild(msg);
          }
          msg.textContent =
            "Vitória! Aguarde o fim da rodada para o próximo oponente.";
          msg.classList.remove("hidden");
        } else {
          GameCore.returnToLobbyLogic();
        }
      } else {
        if (data.winner === GameCore.state.myColor)
          document.getElementById("winner-screen").classList.remove("hidden");
        else document.getElementById("loser-screen").classList.remove("hidden");
      }
    }
  });

  socket.on("gameDraw", (data) => {
    if (GameCore.state.isGameOver) return;
    GameCore.state.isGameOver = true;
    GameCore.stopWatchdog();
    GameCore.state.updateQueue = [];
    GameCore.state.isProcessingQueue = false;

    GameCore.state.savedReplayData = {
      history: data.moveHistory,
      initialBoard: data.initialBoardState,
      boardSize: GameCore.state.currentBoardSize,
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
    document.getElementById("next-game-overlay").classList.remove("hidden");
    document.getElementById("game-over-overlay").classList.add("hidden");
    document.getElementById(
      "match-score-display"
    ).textContent = `Placar: ${data.score[0]} - ${data.score[1]}`;
    let cd = 5;
    const tEl = document.getElementById("next-game-timer");
    tEl.textContent = cd;
    if (GameCore.state.nextGameInterval)
      clearInterval(GameCore.state.nextGameInterval);
    GameCore.state.nextGameInterval = setInterval(() => {
      cd--;
      tEl.textContent = cd;
      if (cd <= 0) clearInterval(GameCore.state.nextGameInterval);
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
    if (GameCore.state.drawCooldownInterval)
      clearInterval(GameCore.state.drawCooldownInterval);
    GameCore.state.drawCooldownInterval = setInterval(() => {
      cd--;
      if (cd > 0) btn.textContent = `Empate (${cd}s)`;
      else {
        clearInterval(GameCore.state.drawCooldownInterval);
        if (!GameCore.state.isGameOver) {
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
    GameCore.cancelRevancheTimeout();
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
        GameCore.returnToLobbyLogic();
    }, 3000);
  });

  // Aggressive handler: ensure user is ejected to lobby immediately
  socket.on("forceReturnToLobby", () => {
    try {
      // Stop GameCore timers/watchdogs if available
      try {
        if (window.GameCore && window.GameCore.stopWatchdog)
          window.GameCore.stopWatchdog();
        if (window.GameCore && window.GameCore.state) {
          const s = window.GameCore.state;
          if (s.clientTimerInterval) clearInterval(s.clientTimerInterval);
          if (s.nextGameInterval) clearInterval(s.nextGameInterval);
          if (s.drawCooldownInterval) clearInterval(s.drawCooldownInterval);
          s.isReplaying = false;
          s.isGameOver = true;
          s.currentRoom = null;
        }
      } catch (e) {}

      // Clear relevant overlays and UI elements
      try {
        [
          "game-over-overlay",
          "next-game-overlay",
          "connection-lost-overlay",
          "draw-request-overlay",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el && !el.classList.contains("hidden"))
            el.classList.add("hidden");
        });
        // reset endgame UI if available
        if (window.UI && window.UI.resetEndGameUI) window.UI.resetEndGameUI();
      } catch (e) {}

      // Remove any saved room and force navigate to lobby
      try {
        localStorage.removeItem("checkersCurrentRoom");
      } catch (e) {}

      // final redirect
      window.location.href = "/";
    } catch (e) {
      try {
        window.location.href = "/";
      } catch (ee) {}
    }
  });
  socket.on("gameNotFound", () => {
    alert("Jogo não encontrado.");
    GameCore.returnToLobbyLogic();
  });
  socket.on("refundAndReturn", (data) => {
    try {
      // Mostrar mensagem curta e retornar ao lobby
      if (data && data.message) alert(data.message);
    } catch (e) {}
    GameCore.returnToLobbyLogic();
  });
  // 'opponentConnectionLost' was removed server-side; overlay behavior disabled.
  socket.on("opponentConnectionLost", (d) => {
    if (!window.isSpectator) {
      const ov = document.getElementById("connection-lost-overlay");
      if (ov) ov.classList.remove("hidden");
      const msg = document.getElementById("connection-lost-message");
      if (msg) msg.textContent = `Oponente caiu. Aguarde ${d.waitTime}s...`;
    }
  });
  socket.on("opponentDisconnected", () => {
    if (!window.isSpectator) GameCore.returnToLobbyLogic();
  });

  // --- EVENTOS DO TORNEIO (Mantidos aqui pois são de alto nível) ---

  socket.on(
    "tournamentStarted",
    (data) =>
      window.showTournamentBracket &&
      window.showTournamentBracket(data.bracket, 1)
  );
  socket.on(
    "tournamentRoundUpdate",
    (data) =>
      window.showTournamentBracket &&
      window.showTournamentBracket(data.bracket, data.round)
  );

  socket.on("tournamentEnded", (data) => {
    const today = new Date().toLocaleDateString();
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

  socket.on("tournamentCancelled", () => {
    const today = new Date().toLocaleDateString();
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
      localStorage.setItem("checkersCurrentRoom", data.roomCode);
      if (!isGamePage) {
        window.location.href = "/jogo.html";
        return;
      }

      socket.emit("rejoinActiveGame", {
        roomCode: data.roomCode,
        user: window.currentUser,
      });
      document
        .getElementById("tournament-bracket-overlay")
        .classList.add("hidden");
      UI.elements.gameContainer.classList.remove("hidden");
      document
        .getElementById("tournament-indicator")
        .classList.remove("hidden");
      document.getElementById("winner-screen").classList.add("hidden");
      document.getElementById("loser-screen").classList.add("hidden");
      document.getElementById("game-over-overlay").classList.add("hidden");
      document.getElementById("draw-screen").classList.add("hidden");
    }
  });

  socket.on("tournamentSpectateOpponent", (data) => {
    if (!isGamePage) {
      localStorage.setItem("checkersCurrentRoom", data.roomCode);
      window.location.href = "/jogo.html";
      return;
    }
    document.getElementById("winner-screen").classList.add("hidden");
    document.getElementById("game-over-overlay").classList.add("hidden");
    socket.emit("joinAsSpectator", { roomCode: data.roomCode });
    UI.elements.gameStatus.innerHTML =
      "<span style='color:#f1c40f'>Assistindo provável oponente...</span>";
  });

  socket.on("forceReturnToLobby", () => {
    try {
      GameCore.returnToLobbyLogic();
    } catch (e) {
      window.location.href = "/";
    }
  });

  // Helper local para mostrar bracket (se necessário)
  window.showTournamentBracket = function (matches, round) {
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
  };
});
