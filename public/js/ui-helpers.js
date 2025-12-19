// ui-helpers.js (COM RENDERIZAÇÃO DEFENSIVA ANTI-BUG)

window.UI = {
  elements: {},
  boardCache: [], // Cache para armazenar referências diretas aos quadrados (DOM)

  init: function () {
    this.elements = {
      board: document.getElementById("board"),
      lobbyContainer: document.getElementById("lobby-container"),
      gameContainer: document.getElementById("game-container"),
      waitingArea: document.getElementById("waiting-area"),
      openRoomsList: document.getElementById("open-rooms-list"),
      activeRoomsList: document.getElementById("active-rooms-list"),
      timerSelect: document.getElementById("timer-select"),
      timerDisplay: document.getElementById("timer"),
      turnDisplay: document.getElementById("turn"),
      gameStatus: document.getElementById("game-status"),
      overlay: document.getElementById("game-over-overlay"),
      winnerScreen: document.getElementById("winner-screen"),
      loserScreen: document.getElementById("loser-screen"),
      drawScreen: document.getElementById("draw-screen"),
      spectatorEndScreen: document.getElementById("spectator-end-screen"),
      nextGameOverlay: document.getElementById("next-game-overlay"),
      drawRequestOverlay: document.getElementById("draw-request-overlay"),
      connectionLostOverlay: document.getElementById("connection-lost-overlay"),
      spectatorIndicator: document.getElementById("spectator-indicator"),
      spectatorLeaveBtn: document.getElementById("spectator-leave-btn"),
      resignBtn: document.getElementById("resign-btn"),
      drawBtn: document.getElementById("draw-btn"),
      playersHud: document.getElementById("players-hud"),
      whitePlayerName: document.getElementById("white-player-name"),
      blackPlayerName: document.getElementById("black-player-name"),
      whitePlayerAvatar: document.getElementById("white-player-avatar"),
      blackPlayerAvatar: document.getElementById("black-player-avatar"),
      createRoomBtn: document.getElementById("create-room-btn"),
      betAmountInput: document.getElementById("bet-amount-input"),
      gameModeSelect: document.getElementById("game-mode-select"),
      timeControlSelect: document.getElementById("time-control-select"),
      timerSelectionContainer: document.getElementById(
        "timer-selection-container"
      ),
      lobbyErrorMessage: document.getElementById("lobby-error-message"),
      moveSound: document.getElementById("move-sound"),
      captureSound: document.getElementById("capture-sound"),
      joinSound: document.getElementById("join-sound"),
    };
  },

  // --- FEEDBACK TÁTIL (VIBRAÇÃO) ---
  triggerHaptic: function () {
    if ("vibrate" in navigator) {
      setTimeout(() => {
        try {
          navigator.vibrate(15);
        } catch (e) {}
      }, 0);
    }
  },

  // --- ANIMAÇÃO DE MOVIMENTO ---
  animatePieceMove: function (from, to, boardSize) {
    return new Promise((resolve) => {
      // Tenta pegar do cache, se falhar pega do DOM (Defensivo)
      let square =
        (this.boardCache[from.row] && this.boardCache[from.row][from.col]) ||
        document.querySelector(
          `.square[data-row="${from.row}"][data-col="${from.col}"]`
        );

      if (!square) {
        resolve();
        return;
      }

      const piece = square.querySelector(".piece");
      if (!piece) {
        resolve();
        return;
      }

      const fromRect = square.getBoundingClientRect();

      let toSquare =
        (this.boardCache[to.row] && this.boardCache[to.row][to.col]) ||
        document.querySelector(
          `.square[data-row="${to.row}"][data-col="${to.col}"]`
        );

      if (!toSquare) {
        resolve();
        return;
      }
      const toRect = toSquare.getBoundingClientRect();

      let deltaX = toRect.left - fromRect.left;
      let deltaY = toRect.top - fromRect.top;

      const isFlipped = this.elements.board.classList.contains("board-flipped");
      if (!piece) return resolve();

      piece.style.willChange = "transform";
      piece.style.zIndex = 100;

      // Evento de fim de transição para limpeza garantida
      const onTransitionEnd = (e) => {
        if (e && e.propertyName !== "transform") return;
        piece.removeEventListener("transitionend", onTransitionEnd);
        piece.style.willChange = "auto";
        piece.style.zIndex = "";
        piece.style.transition = "";
        piece.style.transform = "";
        resolve();
      };

      requestAnimationFrame(() => {
        piece.style.transition = "transform 0.15s linear";
        piece.addEventListener("transitionend", onTransitionEnd);

        // Fallback de segurança
        setTimeout(() => {
          onTransitionEnd({ propertyName: "transform" });
        }, 200);

        if (isFlipped) {
          piece.style.transform = `rotate(180deg) translate(${deltaX}px, ${deltaY}px)`;
        } else {
          piece.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        }
      });
    });
  },

  // --- RENDERIZAÇÃO ROBUSTA (CORREÇÃO DE PEÇAS INVISÍVEIS) ---
  renderPieces: function (boardState, boardSize) {
    if (!boardState) return;

    requestAnimationFrame(() => {
      for (let row = 0; row < boardSize; row++) {
        for (let col = 0; col < boardSize; col++) {
          // TENTA PEGAR DO CACHE
          let square = this.boardCache[row] && this.boardCache[row][col];

          // FALLBACK: SE O CACHE FALHAR, BUSCA NO DOM (Isso corrige o bug)
          if (!square) {
            square = document.querySelector(
              `.square[data-row="${row}"][data-col="${col}"]`
            );
            // Se achou no DOM, conserta o cache para a próxima
            if (square) {
              if (!this.boardCache[row]) this.boardCache[row] = [];
              this.boardCache[row][col] = square;
            }
          }

          if (!square) continue; // Se realmente não existir, pula

          const pieceType = boardState[row][col];
          const existingPiece =
            square.firstElementChild &&
            square.firstElementChild.classList.contains("piece")
              ? square.firstElementChild
              : null;

          if (pieceType !== 0) {
            const isBlack = pieceType.toString().toLowerCase() === "p";
            const isKing = pieceType === "P" || pieceType === "B";
            const classColor = isBlack ? "black-piece" : "white-piece";

            if (existingPiece) {
              // Atualiza peça existente
              const currentClass = isBlack ? "black-piece" : "white-piece";
              if (!existingPiece.classList.contains(currentClass)) {
                existingPiece.className = `piece ${classColor}`;
              }

              if (isKing) {
                if (!existingPiece.classList.contains("king"))
                  existingPiece.classList.add("king");
              } else {
                if (existingPiece.classList.contains("king"))
                  existingPiece.classList.remove("king");
              }

              // Garante que a peça esteja visível e resetada
              existingPiece.style.transform = "";
              existingPiece.style.transition = "";
              existingPiece.style.opacity = "1";
            } else {
              // Cria nova peça
              const piece = document.createElement("div");
              piece.className = `piece ${classColor}`;
              if (isKing) piece.classList.add("king");
              square.appendChild(piece);
            }
          } else {
            if (existingPiece) {
              existingPiece.remove();
            }
          }
        }
      }
    });
  },

  createBoard: function (boardSize, clickHandler) {
    const board = this.elements.board;
    if (!board) return; // Segurança se estiver no Lobby
    board.innerHTML = "";

    this.boardCache = []; // Reseta o cache

    let squareSizeCSS;
    const isMobile = window.innerWidth <= 768;

    if (boardSize === 10) {
      squareSizeCSS = isMobile ? "min(36px, 9vw)" : "min(65px, 7.5vmin)";
    } else {
      squareSizeCSS = isMobile ? "min(45px, 11vw)" : "min(80px, 10vmin)";
    }

    board.style.gridTemplateColumns = `repeat(${boardSize}, ${squareSizeCSS})`;
    board.style.gridTemplateRows = `repeat(${boardSize}, ${squareSizeCSS})`;

    const fragment = document.createDocumentFragment();

    for (let row = 0; row < boardSize; row++) {
      this.boardCache[row] = [];
      for (let col = 0; col < boardSize; col++) {
        const square = document.createElement("div");
        square.classList.add(
          "square",
          (row + col) % 2 === 1 ? "dark" : "light"
        );
        square.dataset.row = row;
        square.dataset.col = col;

        fragment.appendChild(square);
        this.boardCache[row][col] = square; // Popula o cache
      }
    }

    board.appendChild(fragment);

    // Aplica preferências do usuário (se houver) imediatamente após criar o tabuleiro
    try {
      if (window.userPreferences && this.applyPreferences) {
        this.applyPreferences(window.userPreferences);
      }
    } catch (e) {}

    board.removeEventListener("click", clickHandler);
    board.addEventListener("click", clickHandler);
  },

  // Renderiza um tabuleiro dentro de um elemento arbitrário usando a mesma lógica
  // sem sobrescrever permanentemente o tabuleiro principal.
  renderBoardInto: function (element, boardState, boardSize) {
    if (!element) return;
    // Salva referências originais
    const origBoard = this.elements.board;
    const origCache = this.boardCache;

    try {
      // Temporariamente aponta o UI para o elemento de preview
      this.elements.board = element;
      this.boardCache = [];
      // cria e renderiza usando as funções já existentes
      this.createBoard(boardSize, function () {});
      this.renderPieces(boardState, boardSize);
    } catch (e) {
      console.error("renderBoardInto error:", e);
    } finally {
      // Restaura referencias originais
      this.elements.board = origBoard;
      this.boardCache = origCache;
    }
  },

  resetLobbyUI: function () {
    const el = this.elements;
    if (el.waitingArea) el.waitingArea.classList.add("hidden");
    if (el.createRoomBtn) el.createRoomBtn.disabled = false;
    if (el.betAmountInput) el.betAmountInput.disabled = false;
    if (el.gameModeSelect) el.gameModeSelect.disabled = false;
    if (el.timeControlSelect) el.timeControlSelect.disabled = false;
    if (el.timerSelectionContainer)
      el.timerSelectionContainer.style.display = "flex";
    if (el.lobbyErrorMessage) el.lobbyErrorMessage.textContent = "";
  },

  applyPreferences: function (prefs) {
    try {
      const board = this.elements.board;
      if (!board) return;
      if (!prefs) prefs = {};
      if (prefs.boardLight)
        board.style.setProperty("--light-square", prefs.boardLight);
      if (prefs.boardDark)
        board.style.setProperty("--dark-square", prefs.boardDark);
      if (prefs.pieceWhite) {
        board.style.setProperty("--white-piece-color-1", prefs.pieceWhite);
        // derivado levemente mais escuro para segundo stop
        board.style.setProperty("--white-piece-color-2", prefs.pieceWhite);
      }
      if (prefs.pieceBlack) {
        board.style.setProperty("--black-piece-color-1", prefs.pieceBlack);
        board.style.setProperty("--black-piece-color-2", prefs.pieceBlack);
      }
      // Remove textura (background-image) das casas para que a cor personalizada seja visível
      try {
        const squares = board.querySelectorAll(".light, .dark");
        squares.forEach((sq) => {
          sq.style.backgroundImage = "none";
        });
      } catch (e) {}
    } catch (e) {
      // silencioso
    }
  },

  renderOpenRooms: function (rooms) {
    const listEl = this.elements.openRoomsList;
    if (!listEl) return; // Segurança se estiver no Jogo
    listEl.innerHTML = "";
    if (!rooms || rooms.length === 0) {
      listEl.innerHTML = "<p>Nenhuma sala aberta no momento. Crie uma!</p>";
      return;
    }

    const list = document.createElement("ul");
    list.className = "room-card-list";

    rooms.forEach((room) => {
      const card = document.createElement("li");
      card.className = "room-card";

      const gameModeNames = {
        classic: "Clássico 8x8",
        tablita: "Tablita 8x8",
        international: "Internacional 10x10",
      };
      const gameModeText = gameModeNames[room.gameMode] || "Clássico 8x8";

      let timeText = `${room.timerDuration}s`;
      if (room.timeControl === "match") {
        const mins = Math.floor(room.timerDuration / 60);
        const secs = room.timerDuration % 60;
        timeText =
          mins > 0 ? `${mins}m${secs > 0 ? " " + secs + "s" : ""}` : `${secs}s`;
        timeText += " (Total)";
      } else {
        timeText += " (Jogada)";
      }

      const creatorName = room.creatorEmail.split("@")[0];

      card.innerHTML = `
            <div class="room-card-info">
                <p><strong>Criador:</strong> ${creatorName}</p>
                <p><strong>Aposta:</strong> R$ ${room.bet.toFixed(2)}</p>
                <p><strong>Modo:</strong> ${gameModeText}</p>
                <p><strong>Tempo:</strong> ${timeText}</p>
            </div>
            <div class="room-card-action">
                <button class="join-room-btn" data-room-code="${
                  room.roomCode
                }">Entrar</button>
            </div>
        `;
      list.appendChild(card);
    });
    listEl.appendChild(list);
  },

  renderActiveRooms: function (rooms) {
    const listEl = this.elements.activeRoomsList;
    if (!listEl) return; // Segurança se estiver no Jogo
    listEl.innerHTML = "";
    if (!rooms || rooms.length === 0) {
      listEl.innerHTML = "<p>Nenhum jogo em andamento.</p>";
      return;
    }

    const list = document.createElement("ul");
    list.className = "room-card-list";

    rooms.forEach((room) => {
      const card = document.createElement("li");
      card.className = "room-card";
      card.style.borderLeft = "4px solid #f39c12";

      const gameModeNames = {
        classic: "Clássico 8x8",
        tablita: "Tablita 8x8",
        international: "Internacional 10x10",
      };
      const gameModeText = gameModeNames[room.gameMode] || "Clássico 8x8";

      const p1Name = room.player1Email.split("@")[0];
      const p2Name = room.player2Email.split("@")[0];

      card.innerHTML = `
            <div class="room-card-info">
                <p><strong>Jogadores:</strong> ${p1Name} vs ${p2Name}</p>
                <p><strong>Aposta:</strong> R$ ${room.bet.toFixed(2)}</p>
                <p><strong>Modo:</strong> ${gameModeText}</p>
            </div>
            <div class="room-card-action">
                <button class="watch-game-btn" data-room-code="${
                  room.roomCode
                }" style="background-color: #f39c12;">Assistir</button>
            </div>
        `;
      list.appendChild(card);
    });
    listEl.appendChild(list);
  },

  updateTimerOptions: function (controlType) {
    const select = this.elements.timerSelect;
    if (!select) return;
    select.innerHTML = "";
    let options = [];

    if (controlType === "move") {
      options = [
        { val: 5, label: "5 segundos" },
        { val: 7, label: "7 segundos" },
        { val: 10, label: "10 segundos" },
        { val: 30, label: "30 segundos" },
      ];
    } else {
      options = [
        { val: 60, label: "1 minuto" },
        { val: 120, label: "2 minutos" },
        { val: 300, label: "5 minutos" },
      ];
    }

    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.val;
      option.textContent = opt.label;
      select.appendChild(option);
    });
  },

  markLastMove: function (lastMove) {
    document
      .querySelectorAll(".last-move")
      .forEach((el) => el.classList.remove("last-move"));
    if (!lastMove) return;

    const fromSq =
      (this.boardCache[lastMove.from.row] &&
        this.boardCache[lastMove.from.row][lastMove.from.col]) ||
      document.querySelector(
        `.square[data-row="${lastMove.from.row}"][data-col="${lastMove.from.col}"]`
      );

    const toSq =
      (this.boardCache[lastMove.to.row] &&
        this.boardCache[lastMove.to.row][lastMove.to.col]) ||
      document.querySelector(
        `.square[data-row="${lastMove.to.row}"][data-col="${lastMove.to.col}"]`
      );

    if (fromSq) fromSq.classList.add("last-move");
    if (toSq) toSq.classList.add("last-move");
  },

  // Compatibilidade: alias para função esperada por gameCore
  highlightLastMove: function (lastMove) {
    try {
      return this.markLastMove(lastMove);
    } catch (e) {
      console.warn("highlightLastMove fallback failed", e);
    }
  },

  highlightMandatoryPieces: function (piecesToHighlight) {
    // Remove marcas anteriores
    document
      .querySelectorAll(".mandatory-capture")
      .forEach((p) => p.classList.remove("mandatory-capture"));

    if (!piecesToHighlight || piecesToHighlight.length === 0) return;

    // Aguarda o próximo frame para dar tempo ao renderPieces criar os elementos
    requestAnimationFrame(() => {
      piecesToHighlight.forEach((pos) => {
        const square =
          (this.boardCache[pos.row] && this.boardCache[pos.row][pos.col]) ||
          document.querySelector(
            `.square[data-row="${pos.row}"][data-col="${pos.col}"]`
          );

        if (!square) return;

        // Se a peça já existe, aplica a classe imediatamente
        const existing = square.querySelector(".piece");
        if (existing) {
          existing.classList.add("mandatory-capture");
          return;
        }

        // Retry curto caso a peça ainda não tenha sido adicionada ao DOM
        let attempts = 0;
        const tryAttach = () => {
          attempts++;
          const p = square.querySelector(".piece");
          if (p) {
            p.classList.add("mandatory-capture");
          } else if (attempts < 4) {
            setTimeout(tryAttach, 40);
          }
        };
        tryAttach();
      });
    });
  },

  highlightValidMoves: function (moves) {
    requestAnimationFrame(() => {
      moves.forEach((move) => {
        const square =
          (this.boardCache[move.row] && this.boardCache[move.row][move.col]) ||
          document.querySelector(
            `.square[data-row="${move.row}"][data-col="${move.col}"]`
          );

        if (square) {
          square.classList.add("valid-move-highlight");
        }
      });
    });
  },

  clearHighlights: function () {
    document.querySelectorAll(".valid-move-highlight").forEach((square) => {
      square.classList.remove("valid-move-highlight");
    });
    document.querySelectorAll(".piece.selected").forEach((p) => {
      p.classList.remove("selected");
    });
  },

  updateTurnIndicator: function (isMyTurn) {
    if (isMyTurn) {
      if (this.elements.board)
        this.elements.board.classList.add("your-turn-active");
    } else {
      if (this.elements.board)
        this.elements.board.classList.remove("your-turn-active");
    }
  },

  playAudio: function (type) {
    let sound;
    if (type === "capture") sound = this.elements.captureSound;
    else if (type === "join") sound = this.elements.joinSound;
    else sound = this.elements.moveSound;

    if (sound) {
      sound.currentTime = 0;
      sound.play().catch(() => {});
      this.triggerHaptic();
    }
  },

  updatePlayerNames: function (users) {
    if (!users) return;
    const whiteName =
      users.whiteName || (users.white ? users.white.split("@")[0] : "Brancas");
    const blackName =
      users.blackName || (users.black ? users.black.split("@")[0] : "Pretas");

    if (this.elements.whitePlayerName)
      this.elements.whitePlayerName.textContent = whiteName;
    if (this.elements.blackPlayerName)
      this.elements.blackPlayerName.textContent = blackName;

    if (this.elements.whitePlayerAvatar) {
      this.elements.whitePlayerAvatar.classList.add("hidden");
    }
    if (this.elements.blackPlayerAvatar) {
      this.elements.blackPlayerAvatar.classList.add("hidden");
    }

    if (this.elements.playersHud)
      this.elements.playersHud.classList.remove("hidden");
  },

  updateTimer: function (data) {
    if (data.timeLeft !== undefined) {
      this.elements.timerDisplay.textContent = data.timeLeft + "s";
    } else if (data.whiteTime !== undefined && data.blackTime !== undefined) {
      const turnColor = this.elements.turnDisplay.textContent;
      let timeToShow = 0;
      if (turnColor === "Brancas") timeToShow = data.whiteTime;
      else timeToShow = data.blackTime;
      this.elements.timerDisplay.textContent = this.formatTime(timeToShow);
    }
  },

  formatTime: function (seconds) {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  },

  showGameScreen: function (isSpectator) {
    if (this.elements.lobbyContainer)
      this.elements.lobbyContainer.classList.add("hidden");
    if (this.elements.gameContainer)
      this.elements.gameContainer.classList.remove("hidden");

    if (this.elements.overlay) this.elements.overlay.classList.add("hidden");
    if (this.elements.winnerScreen)
      this.elements.winnerScreen.classList.add("hidden");
    if (this.elements.loserScreen)
      this.elements.loserScreen.classList.add("hidden");
    if (this.elements.drawScreen)
      this.elements.drawScreen.classList.add("hidden");
    if (this.elements.spectatorEndScreen)
      this.elements.spectatorEndScreen.classList.add("hidden");
    if (this.elements.nextGameOverlay)
      this.elements.nextGameOverlay.classList.add("hidden");
    if (this.elements.drawRequestOverlay)
      this.elements.drawRequestOverlay.classList.add("hidden");
    if (this.elements.connectionLostOverlay)
      this.elements.connectionLostOverlay.classList.add("hidden");

    if (isSpectator) {
      if (this.elements.spectatorIndicator)
        this.elements.spectatorIndicator.classList.remove("hidden");
      if (this.elements.spectatorLeaveBtn)
        this.elements.spectatorLeaveBtn.classList.remove("hidden");
      if (this.elements.resignBtn)
        this.elements.resignBtn.classList.add("hidden");
      if (this.elements.drawBtn) this.elements.drawBtn.classList.add("hidden");
    } else {
      if (this.elements.spectatorIndicator)
        this.elements.spectatorIndicator.classList.add("hidden");
      if (this.elements.spectatorLeaveBtn)
        this.elements.spectatorLeaveBtn.classList.add("hidden");
      if (this.elements.resignBtn)
        this.elements.resignBtn.classList.remove("hidden");
      if (this.elements.drawBtn) {
        this.elements.drawBtn.classList.remove("hidden");
        this.elements.drawBtn.disabled = false;
        this.elements.drawBtn.textContent = "Empate";
      }
    }
    // Aplica preferências visuais do usuário (se existirem)
    try {
      if (window.userPreferences && this.applyPreferences)
        this.applyPreferences(window.userPreferences);
    } catch (e) {}
  },

  returnToLobbyScreen: function () {
    // Se estiver na página de jogo, redireciona para a index
    if (window.location.pathname.includes("jogo.html")) {
      window.location.href = "/";
      return;
    }

    if (this.elements.gameContainer)
      this.elements.gameContainer.classList.add("hidden");
    if (this.elements.overlay) this.elements.overlay.classList.add("hidden");
    if (this.elements.winnerScreen)
      this.elements.winnerScreen.classList.add("hidden");
    if (this.elements.loserScreen)
      this.elements.loserScreen.classList.add("hidden");
    if (this.elements.drawScreen)
      this.elements.drawScreen.classList.add("hidden");
    if (this.elements.spectatorEndScreen)
      this.elements.spectatorEndScreen.classList.add("hidden");
    if (this.elements.nextGameOverlay)
      this.elements.nextGameOverlay.classList.add("hidden");
    if (this.elements.drawRequestOverlay)
      this.elements.drawRequestOverlay.classList.add("hidden");
    if (this.elements.connectionLostOverlay)
      this.elements.connectionLostOverlay.classList.add("hidden");

    if (this.elements.lobbyContainer)
      this.elements.lobbyContainer.classList.remove("hidden");
    if (this.elements.board) {
      this.elements.board.classList.remove("board-flipped");
      this.elements.board.innerHTML = "";
    }
    if (this.elements.playersHud)
      this.elements.playersHud.classList.add("hidden");

    this.resetLobbyUI();
  },

  resetEndGameUI: function () {
    document.querySelectorAll(".revanche-status").forEach((el) => {
      el.textContent = "";
      el.style.color = "white";
    });
    document
      .querySelectorAll(".revanche-btn, .exit-lobby-btn")
      .forEach((btn) => {
        btn.disabled = false;
      });
  },
};
