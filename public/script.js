document.addEventListener("DOMContentLoaded", () => {
  UI.init();

  const socket = io({ autoConnect: false });
  let currentUser = null;
  let myColor = null;
  let currentRoom = null;
  let boardState = [];
  let selectedPiece = null;
  let currentBoardSize = 8;
  let tempRoomCode = null;
  let nextGameInterval = null;
  let isGameOver = false;
  let drawCooldownInterval = null;
  let isSpectator = false;

  let lastPacketTime = Date.now();
  let watchdogInterval = null;

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

  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get("ref");
  const referralInput = document.getElementById("referral-code-input");
  if (refCode && referralInput) {
    referralInput.value = refCode;
    referralInput.style.display = "none";
    document.getElementById("login-form").style.display = "none";
    document.getElementById("register-form").style.display = "block";
  }

  document.getElementById("show-register").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("login-form").style.display = "none";
    document.getElementById("register-form").style.display = "block";
    document.getElementById("auth-message").textContent = "";
  });

  document.getElementById("show-login").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("register-form").style.display = "none";
    document.getElementById("login-form").style.display = "block";
    document.getElementById("auth-message").textContent = "";
  });

  document
    .getElementById("register-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("register-email").value;
      const password = document.getElementById("register-password").value;
      const referralCode = document.getElementById("referral-code-input").value;

      try {
        const response = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, referralCode }),
        });
        const data = await response.json();
        const msg = document.getElementById("auth-message");
        msg.textContent = data.message;
        if (response.ok) {
          msg.style.color = "green";
          setTimeout(() => document.getElementById("show-login").click(), 2000);
        } else {
          msg.style.color = "red";
        }
      } catch (error) {
        document.getElementById("auth-message").textContent =
          "Erro de conexão.";
      }
    });

  document
    .getElementById("login-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("login-email").value;
      const password = document.getElementById("login-password").value;
      try {
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (response.ok) {
          currentUser = data.user;
          localStorage.setItem("checkersUserEmail", currentUser.email);

          document.getElementById("main-container").classList.add("hidden");
          document.getElementById("lobby-container").classList.remove("hidden");
          document.getElementById(
            "lobby-welcome-message"
          ).textContent = `Bem-vindo, ${
            currentUser.email
          }! Saldo: R$ ${currentUser.saldo.toFixed(2)}`;
          socket.connect();
        } else {
          const msg = document.getElementById("auth-message");
          msg.textContent = data.message;
          msg.style.color = "red";
        }
      } catch (error) {
        document.getElementById("auth-message").textContent =
          "Erro de conexão.";
      }
    });

  document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem("checkersUserEmail");
    localStorage.removeItem("checkersCurrentRoom");
    window.location.reload();
  });

  UI.elements.timeControlSelect.addEventListener("change", () => {
    UI.updateTimerOptions(UI.elements.timeControlSelect.value);
  });
  UI.updateTimerOptions("move");

  document.getElementById("create-room-btn").addEventListener("click", () => {
    const bet = parseInt(UI.elements.betAmountInput.value, 10);
    const gameMode = UI.elements.gameModeSelect.value;
    const timerDuration = UI.elements.timerSelect.value;
    const timeControl = UI.elements.timeControlSelect.value;

    if (bet > 0 && currentUser) {
      socket.emit("createRoom", {
        bet,
        user: currentUser,
        gameMode,
        timerDuration,
        timeControl,
      });
      if (UI.elements.lobbyErrorMessage)
        UI.elements.lobbyErrorMessage.textContent = "";
      UI.elements.createRoomBtn.disabled = true;
      UI.elements.betAmountInput.disabled = true;
      UI.elements.timerSelectionContainer.style.display = "none";
    } else if (!currentUser) {
      if (UI.elements.lobbyErrorMessage)
        UI.elements.lobbyErrorMessage.textContent = "Erro de autenticação.";
    } else {
      if (UI.elements.lobbyErrorMessage)
        UI.elements.lobbyErrorMessage.textContent =
          "Aposta deve ser maior que zero.";
    }
  });

  document.getElementById("cancel-room-btn").addEventListener("click", () => {
    const roomCode = document.getElementById("room-code-display").textContent;
    if (roomCode) socket.emit("cancelRoom", { roomCode });
  });

  document.getElementById("lobby-container").addEventListener("click", (e) => {
    if (e.target.classList.contains("join-room-btn")) {
      const roomCode = e.target.dataset.roomCode;
      if (roomCode && currentUser) {
        socket.emit("joinRoomRequest", { roomCode, user: currentUser });
      }
    }
    if (e.target.classList.contains("watch-game-btn")) {
      const roomCode = e.target.dataset.roomCode;
      if (roomCode) socket.emit("joinAsSpectator", { roomCode });
    }
  });

  const refreshLobbyBtn = document.getElementById("refresh-lobby-btn");
  if (refreshLobbyBtn) {
    refreshLobbyBtn.addEventListener("click", () => {
      if (currentUser) {
        socket.emit("enterLobby");
        const originalText = refreshLobbyBtn.textContent;
        refreshLobbyBtn.textContent = "Carregando...";
        refreshLobbyBtn.disabled = true;
        setTimeout(() => {
          refreshLobbyBtn.textContent = originalText;
          refreshLobbyBtn.disabled = false;
        }, 1000);
      }
    });
  }

  const setupModalLogic = () => {
    // ... (Mantendo código anterior inalterado onde não há mudanças)
    const viewHistoryBtn = document.getElementById("view-history-btn");
    if (viewHistoryBtn) {
      viewHistoryBtn.addEventListener("click", async () => {
        if (!currentUser) return;
        document.getElementById("history-overlay").classList.remove("hidden");
        const list = document.getElementById("history-list");
        list.innerHTML = "<p>Carregando...</p>";
        try {
          const res = await fetch("/api/user/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: currentUser.email }),
          });
          const data = await res.json();
          list.innerHTML = "";
          if (data.length === 0) {
            list.innerHTML = "<p>Sem partidas.</p>";
            return;
          }
          const table = document.createElement("table");
          table.className = "history-table";
          table.innerHTML = `<thead><tr><th>Resultado</th><th>Aposta</th><th>Oponente</th><th>Data</th></tr></thead><tbody></tbody>`;
          const tbody = table.querySelector("tbody");
          data.forEach((m) => {
            const tr = document.createElement("tr");
            let resText = !m.winner
              ? "Empate"
              : m.winner === currentUser.email
              ? "Vitória"
              : "Derrota";
            let resClass = !m.winner
              ? "history-draw"
              : m.winner === currentUser.email
              ? "history-win"
              : "history-loss";
            const opp = m.player1 === currentUser.email ? m.player2 : m.player1;
            tr.innerHTML = `<td class="${resClass}"><b>${resText}</b></td><td>R$ ${m.bet.toFixed(
              2
            )}</td><td>${opp.split("@")[0]}</td><td>${new Date(
              m.createdAt
            ).toLocaleDateString()}</td>`;
            tbody.appendChild(tr);
          });
          list.appendChild(table);
        } catch (e) {
          list.innerHTML = "Erro ao carregar.";
        }
      });
    }

    document
      .getElementById("close-history-overlay-btn")
      .addEventListener("click", () => {
        document.getElementById("history-overlay").classList.add("hidden");
      });

    const addBalanceBtn = document.getElementById("add-balance-btn");
    if (addBalanceBtn) {
      addBalanceBtn.addEventListener("click", () => {
        document.getElementById("pix-overlay").classList.remove("hidden");
        // ...
      });
    }
    document
      .getElementById("close-pix-overlay-btn")
      .addEventListener("click", () => {
        document.getElementById("pix-overlay").classList.add("hidden");
      });

    // LÓGICA DO PAGAMENTO MERCADO PAGO
    const payBtn = document.getElementById("pay-mercadopago-btn");
    const loadingDiv = document.getElementById("mp-loading");

    if (payBtn) {
      payBtn.addEventListener("click", async () => {
        if (!currentUser) return;
        const amountInput = document.getElementById("deposit-amount");
        const amount = parseFloat(amountInput.value);

        if (!amount || amount < 1) {
          alert("Valor mínimo de R$ 1,00");
          return;
        }

        payBtn.disabled = true;
        loadingDiv.classList.remove("hidden");

        try {
          const response = await fetch("/api/payment/create_preference", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount: amount, email: currentUser.email }),
          });

          const data = await response.json();

          if (data.init_point) {
            window.location.href = data.init_point;
          } else {
            alert(
              "Erro ao criar pagamento: " + (data.message || "Tente novamente.")
            );
            payBtn.disabled = false;
            loadingDiv.classList.add("hidden");
          }
        } catch (error) {
          console.error(error);
          alert("Erro de conexão.");
          payBtn.disabled = false;
          loadingDiv.classList.add("hidden");
        }
      });
    }

    const withdrawBtn = document.getElementById("withdraw-btn");
    if (withdrawBtn) {
      withdrawBtn.addEventListener("click", () => {
        document.getElementById("withdraw-overlay").classList.remove("hidden");
        document.getElementById("withdraw-message").textContent = "";
      });
    }
    document
      .getElementById("close-withdraw-overlay-btn")
      .addEventListener("click", () => {
        document.getElementById("withdraw-overlay").classList.add("hidden");
      });

    // ... (Outros botões)
    const copyReferralBtn = document.getElementById("copy-referral-btn");
    if (copyReferralBtn) {
      copyReferralBtn.addEventListener("click", () => {
        if (!currentUser) return;
        const link = `${window.location.origin}/?ref=${currentUser.email}`;
        const tempInput = document.createElement("input");
        document.body.appendChild(tempInput);
        tempInput.value = link;
        tempInput.select();
        try {
          document.execCommand("copy");
          const originalText = copyReferralBtn.textContent;
          copyReferralBtn.textContent = "Copiado!";
          setTimeout(() => {
            copyReferralBtn.textContent = originalText;
          }, 2000);
        } catch (err) {
          alert("Erro ao copiar: " + link);
        }
        document.body.removeChild(tempInput);
      });
    }

    const viewReferralsBtn = document.getElementById("view-referrals-btn");
    if (viewReferralsBtn) {
      viewReferralsBtn.addEventListener("click", async () => {
        // ... (Lógica de referrals mantida)
        if (!currentUser) return;
        document.getElementById("referrals-overlay").classList.remove("hidden");
        const list = document.getElementById("referrals-list");
        list.innerHTML = "<p>Carregando...</p>";
        try {
          const response = await fetch("/api/user/referrals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: currentUser.email }),
          });
          const referrals = await response.json();
          list.innerHTML = "";
          if (referrals.length === 0) {
            list.innerHTML = "<p>Você ainda não tem indicações.</p>";
          } else {
            const table = document.createElement("table");
            table.style.width = "100%";
            table.style.fontSize = "0.9em";
            table.style.borderCollapse = "collapse";
            table.innerHTML = `<tr style="border-bottom: 1px solid #aaa;"><th style="text-align: left; padding: 5px;">Usuário</th><th style="text-align: center; padding: 5px;">Status</th></tr>`;
            referrals.forEach((ref) => {
              const tr = document.createElement("tr");
              let statusHtml = "";
              if (ref.hasDeposited) {
                const val = ref.firstDepositValue || 0;
                if (val >= 5)
                  statusHtml = `<span style="color: #2ecc71;">Dep. R$ ${val.toFixed(
                    2
                  )} (Ganhou)</span>`;
                else
                  statusHtml = `<span style="color: #f39c12;">Dep. R$ ${val.toFixed(
                    2
                  )} (Sem bônus)</span>`;
              } else {
                statusHtml = '<span style="color: #95a5a6;">Pendente ⏳</span>';
              }
              tr.innerHTML = `<td style="padding: 5px;">${ref.email}</td><td style="text-align: center; padding: 5px;">${statusHtml}</td>`;
              table.appendChild(tr);
            });
            list.appendChild(table);
          }
        } catch (error) {
          list.innerHTML = "<p style='color: red;'>Erro ao carregar dados.</p>";
        }
      });
    }
    document
      .getElementById("close-referrals-overlay-btn")
      .addEventListener("click", () => {
        document.getElementById("referrals-overlay").classList.add("hidden");
      });
  };
  setupModalLogic();

  // ... (Listeners de jogo mantidos)

  // ### LÓGICA DE UPDATE DE SALDO (CORRIGIDA) ###
  socket.on("updateSaldo", (d) => {
    if (currentUser) {
      currentUser.saldo = d.newSaldo;
      // Atualiza o texto visualmente
      const welcomeMsg = document.getElementById("lobby-welcome-message");
      if (welcomeMsg) {
        welcomeMsg.textContent = `Bem-vindo, ${
          currentUser.email
        }! Saldo: R$ ${currentUser.saldo.toFixed(2)}`;
      }
    }
  });

  // ### NOVO: LÓGICA DE AVISO DE PAGAMENTO (WEBHOOK) ###
  socket.on("balanceUpdate", (data) => {
    if (currentUser && data.email === currentUser.email) {
      currentUser.saldo = data.newSaldo;

      const welcomeMsg = document.getElementById("lobby-welcome-message");
      if (welcomeMsg) {
        welcomeMsg.textContent = `Bem-vindo, ${
          currentUser.email
        }! Saldo: R$ ${currentUser.saldo.toFixed(2)}`;
      }

      alert("Pagamento confirmado! Seu saldo foi atualizado.");
      document.getElementById("pix-overlay").classList.add("hidden");
    }
  });

  // ... (Restante do código mantido: createRoom, joinRoom, etc)

  // Apenas garantindo que o resto das funções (handleBoardClick, etc) continuam aqui.
  // Vou abreviar as funções que não mudaram para focar na resposta.
  // No arquivo real, todo o resto do código deve ser mantido.

  // (Bloco de código de eventos socket: roomCreated, etc...)
  socket.on("roomCreated", (data) => {
    document.getElementById("room-code-display").textContent = data.roomCode;
    document.getElementById("waiting-area").classList.remove("hidden");
  });

  socket.on("roomCancelled", () => UI.resetLobbyUI());

  socket.on("updateLobby", (data) => {
    UI.renderOpenRooms(data.waiting);
    UI.renderActiveRooms(data.active);
  });

  socket.on("joinError", (data) => {
    if (UI.elements.lobbyErrorMessage)
      UI.elements.lobbyErrorMessage.textContent = data.message;
    UI.resetLobbyUI();
  });

  socket.on("confirmBet", (data) => {
    document.getElementById("confirm-bet-amount").textContent = data.bet;
    tempRoomCode = data.roomCode;
    let modeText =
      data.gameMode === "tablita"
        ? "Tablita"
        : data.gameMode === "international"
        ? "Internacional 10x10"
        : "Clássico 8x8";
    document.getElementById("confirm-game-mode").textContent = modeText;
    document.getElementById("confirm-bet-overlay").classList.remove("hidden");
  });

  // ... (Outros eventos socket mantidos) ...
  // Certifique-se de copiar as funções auxiliares handleBoardClick, selectPieceLogic, etc. do código original.

  // Vou incluir as funções essenciais para garantir que o arquivo esteja completo:
  document.body.addEventListener("click", (e) => {
    if (e.target.classList.contains("revanche-btn")) {
      if (currentRoom && !isSpectator) {
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

  function handleBoardClick(e) {
    if (isSpectator) return;
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
    isSpectator = false;
    stopWatchdog();
    if (drawCooldownInterval) clearInterval(drawCooldownInterval);
    if (nextGameInterval) clearInterval(nextGameInterval);

    currentRoom = null;
    myColor = null;
    currentBoardSize = 8;
    localStorage.removeItem("checkersCurrentRoom");

    UI.returnToLobbyScreen();
    if (currentUser) socket.emit("enterLobby");
  }

  socket.on("spectatorJoined", (data) => {
    isSpectator = true;
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
      currentUser &&
      gameState.users &&
      (gameState.users.white === currentUser.email ||
        gameState.users.black === currentUser.email)
    ) {
      isSpectator = false;
    }
    if (isSpectator) return;

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
    } catch (e) {
      console.error(e);
      alert("Erro ao iniciar.");
      returnToLobbyLogic();
    }
  });

  socket.on("timerUpdate", (data) => {
    if (data.roomCode && currentRoom && data.roomCode !== currentRoom) return;
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
    if (!isSpectator) UI.highlightValidMoves(moves);
  });

  socket.on("gameResumed", (data) => {
    lastPacketTime = Date.now();
    if (isSpectator) return;

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

    if (isSpectator) {
      document
        .getElementById("spectator-end-screen")
        .classList.remove("hidden");
      const wText = data.winner === "b" ? "Brancas" : "Pretas";
      document.getElementById(
        "spectator-end-message"
      ).textContent = `${wText} venceram! ${data.reason}`;
    } else {
      if (data.winner === myColor)
        document.getElementById("winner-screen").classList.remove("hidden");
      else document.getElementById("loser-screen").classList.remove("hidden");
    }
  });

  socket.on("gameDraw", (data) => {
    if (isGameOver) return;
    isGameOver = true;
    stopWatchdog();
    document.getElementById("connection-lost-overlay").classList.add("hidden");
    UI.resetEndGameUI();
    document.getElementById("game-over-overlay").classList.remove("hidden");

    if (isSpectator) {
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
    let cd = 10;
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
    if (!isSpectator)
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
    if (!isSpectator) {
      const ov = document.getElementById("connection-lost-overlay");
      ov.classList.remove("hidden");
      document.getElementById(
        "connection-lost-message"
      ).textContent = `Oponente caiu. Aguarde ${d.waitTime}s...`;
    }
  });
  socket.on("opponentDisconnected", () => {
    if (!isSpectator) returnToLobbyLogic();
  });

  async function checkSession() {
    const savedEmail = localStorage.getItem("checkersUserEmail");
    if (savedEmail) {
      try {
        const response = await fetch("/api/user/re-authenticate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: savedEmail }),
        });
        const data = await response.json();
        if (response.ok) {
          currentUser = data.user;
          document.getElementById("main-container").classList.add("hidden");
          document.getElementById("lobby-container").classList.remove("hidden");
          document.getElementById(
            "lobby-welcome-message"
          ).textContent = `Bem-vindo, ${
            currentUser.email
          }! Saldo: R$ ${currentUser.saldo.toFixed(2)}`;
          socket.connect();
        } else {
          localStorage.removeItem("checkersUserEmail");
          localStorage.removeItem("checkersCurrentRoom");
          socket.connect();
        }
      } catch (error) {
        socket.connect();
      }
    } else {
      socket.connect();
    }
  }

  checkSession();
});
