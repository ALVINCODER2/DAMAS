// ui-helpers.js (OTIMIZADO EXTREMO PARA FLUIDEZ MOBILE + VIBRAÇÃO SEGURA)

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

  // --- FEEDBACK TÁTIL (VIBRAÇÃO) OTIMIZADO ---

  triggerHaptic: function () {
    // Verifica se o navegador suporta vibração
    if ("vibrate" in navigator) {
      // OTIMIZAÇÃO: setTimeout(..., 0) joga a vibração para o final da fila de eventos.
      // Isso garante que o navegador termine de calcular a animação visual (CSS/Reflow)
      // ANTES de tentar vibrar o celular, evitando travamentos na peça.
      setTimeout(() => {
        try {
          // Vibração curta (15ms) é suficiente para sentir o "click" e gasta menos bateria/CPU
          navigator.vibrate(15);
        } catch (e) {
          // Silencia erros se o hardware estiver ocupado
        }
      }, 0);
    }
  },

  // --- ANIMAÇÃO DE MOVIMENTO SINCRONIZADA (RequestAnimationFrame) ---

  animatePieceMove: function (from, to, boardSize) {
    return new Promise((resolve) => {
      // Usa o cache em vez de querySelector
      const square =
        this.boardCache[from.row] && this.boardCache[from.row][from.col];
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

      const toSquare =
        this.boardCache[to.row] && this.boardCache[to.row][to.col];
      if (!toSquare) {
        resolve();
        return;
      }
      const toRect = toSquare.getBoundingClientRect();

      let deltaX = toRect.left - fromRect.left;
      let deltaY = toRect.top - fromRect.top;

      const isFlipped = this.elements.board.classList.contains("board-flipped");

      // Otimização: Preparar a GPU antes do frame de animação
      piece.style.willChange = "transform";
      piece.style.zIndex = 100;

      // --- MELHORIA: Evento Real de Fim de Transição ---
      const onTransitionEnd = (e) => {
        // Garante que é a transição correta (transform) e o elemento certo
        if (e && e.propertyName !== "transform") return;

        piece.removeEventListener("transitionend", onTransitionEnd);
        piece.style.willChange = "auto";
        piece.style.zIndex = "";
        // Limpa styles inline para não afetar renders futuros
        piece.style.transition = "";
        piece.style.transform = "";
        resolve();
      };

      // Usa requestAnimationFrame para garantir que a animação comece no momento certo do refresh da tela
      requestAnimationFrame(() => {
        piece.style.transition = "transform 0.15s linear"; // Linear é mais fácil de calcular para CPUs fracas

        // Adiciona ouvinte de evento em vez de setTimeout fixo
        piece.addEventListener("transitionend", onTransitionEnd);

        // Fallback de segurança: Se o transitionend falhar (ex: aba em background), resolve após tempo seguro (200ms)
        // Isso impede travamentos se o navegador suspender animações CSS
        setTimeout(() => {
          // Se a promessa já foi resolvida pelo evento, isso não terá efeito negativo visual
          // Apenas garante limpeza.
          onTransitionEnd({ propertyName: "transform" });
        }, 250);

        if (isFlipped) {
          piece.style.transform = `rotate(180deg) translate(${deltaX}px, ${deltaY}px)`;
        } else {
          piece.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        }
      });
    });
  },

  // --- RENDERIZAÇÃO INTELIGENTE ---

  renderPieces: function (boardState, boardSize) {
    // requestAnimationFrame agrupa as operações DOM para o próximo paint
    requestAnimationFrame(() => {
      for (let row = 0; row < boardSize; row++) {
        for (let col = 0; col < boardSize; col++) {
          const square = this.boardCache[row] && this.boardCache[row][col];
          if (!square) continue;

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
              // Update leve
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

              // Reseta transformações da animação anterior (segurança extra)
              existingPiece.style.transform = "";
              existingPiece.style.transition = "";
            } else {
              // Criação nova (fragmento para evitar reflow? Não, aqui é um por um, mas o RAF ajuda)
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
    // Otimização: remove innerHTML pesado se possível, mas aqui é reset
    board.innerHTML = "";

    this.boardCache = [];

    let squareSizeCSS;
    const isMobile = window.innerWidth <= 768;

    if (boardSize === 10) {
      squareSizeCSS = isMobile ? "min(36px, 9vw)" : "min(65px, 7.5vmin)";
    } else {
      squareSizeCSS = isMobile ? "min(45px, 11vw)" : "min(80px, 10vmin)";
    }

    board.style.gridTemplateColumns = `repeat(${boardSize}, ${squareSizeCSS})`;
    board.style.gridTemplateRows = `repeat(${boardSize}, ${squareSizeCSS})`;

    // Usa DocumentFragment para inserir tudo de uma vez no DOM (apenas 1 Reflow)
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

        // Armazena no fragmento, não no board diretamente ainda
        fragment.appendChild(square);

        // Cache (referência válida mesmo no fragmento)
        this.boardCache[row][col] = square;
      }
    }

    board.appendChild(fragment); // Apenas 1 inserção no DOM real

    board.removeEventListener("click", clickHandler);
    board.addEventListener("click", clickHandler);
  },

  resetLobbyUI: function () {
    const el = this.elements;
    el.waitingArea.classList.add("hidden");
    el.createRoomBtn.disabled = false;
    el.betAmountInput.disabled = false;
    el.gameModeSelect.disabled = false;
    el.timeControlSelect.disabled = false;
    el.timerSelectionContainer.style.display = "flex";
    if (el.lobbyErrorMessage) el.lobbyErrorMessage.textContent = "";
  },

  renderOpenRooms: function (rooms) {
    const listEl = this.elements.openRoomsList;
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
    select.innerHTML = "";
    let options = [];

    if (controlType === "move") {
      options = [
        { val: 5, label: "5 segundos" },
        { val: 7, label: "7 segundos" },
        { val: 10, label: "10 segundos" },
        { val: 30, label: "30 segundos" },
        { val: 40, label: "40 segundos" },
      ];
    } else {
      options = [
        { val: 40, label: "40 segundos" },
        { val: 60, label: "1 minuto" },
      ];
    }

    options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.val;
      option.textContent = opt.label;
      if (opt.val === 40 || opt.val === 60) option.selected = true;
      select.appendChild(option);
    });
  },

  highlightLastMove: function (lastMove) {
    document
      .querySelectorAll(".last-move")
      .forEach((el) => el.classList.remove("last-move"));

    if (lastMove) {
      const fromSq = this.boardCache[lastMove.from.row]?.[lastMove.from.col];
      const toSq = this.boardCache[lastMove.to.row]?.[lastMove.to.col];

      if (fromSq) fromSq.classList.add("last-move");
      if (toSq) toSq.classList.add("last-move");
    }
  },

  highlightMandatoryPieces: function (piecesToHighlight) {
    document
      .querySelectorAll(".mandatory-capture")
      .forEach((p) => p.classList.remove("mandatory-capture"));

    if (piecesToHighlight && piecesToHighlight.length > 0) {
      piecesToHighlight.forEach((pos) => {
        const square = this.boardCache[pos.row]?.[pos.col];
        if (square && square.firstElementChild) {
          square.firstElementChild.classList.add("mandatory-capture");
        }
      });
    }
  },

  highlightValidMoves: function (moves) {
    // requestAnimationFrame aqui evita travar o UI se houver muitos movimentos
    requestAnimationFrame(() => {
      moves.forEach((move) => {
        const square = this.boardCache[move.row]?.[move.col];
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
      this.elements.board.classList.add("your-turn-active");
    } else {
      this.elements.board.classList.remove("your-turn-active");
    }
  },

  playAudio: function (type) {
    // Otimização de áudio: Não espera promessa e trata erro silenciosamente
    let sound;
    if (type === "capture") sound = this.elements.captureSound;
    else if (type === "join") sound = this.elements.joinSound;
    else sound = this.elements.moveSound;

    if (sound) {
      sound.currentTime = 0;
      // .catch() vazio para evitar erros no console se o usuário não interagiu ainda
      sound.play().catch(() => {});

      // DISPARA VIBRAÇÃO SEGURA (Sincronizada com o som)
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
    this.elements.lobbyContainer.classList.add("hidden");
    this.elements.gameContainer.classList.remove("hidden");

    this.elements.overlay.classList.add("hidden");
    this.elements.winnerScreen.classList.add("hidden");
    this.elements.loserScreen.classList.add("hidden");
    this.elements.drawScreen.classList.add("hidden");
    this.elements.spectatorEndScreen.classList.add("hidden");
    this.elements.nextGameOverlay.classList.add("hidden");
    this.elements.drawRequestOverlay.classList.add("hidden");
    this.elements.connectionLostOverlay.classList.add("hidden");

    if (isSpectator) {
      this.elements.spectatorIndicator.classList.remove("hidden");
      this.elements.spectatorLeaveBtn.classList.remove("hidden");
      this.elements.resignBtn.classList.add("hidden");
      this.elements.drawBtn.classList.add("hidden");
    } else {
      this.elements.spectatorIndicator.classList.add("hidden");
      this.elements.spectatorLeaveBtn.classList.add("hidden");
      this.elements.resignBtn.classList.remove("hidden");
      this.elements.drawBtn.classList.remove("hidden");
      this.elements.drawBtn.disabled = false;
      this.elements.drawBtn.textContent = "Empate";
    }
  },

  returnToLobbyScreen: function () {
    this.elements.gameContainer.classList.add("hidden");
    this.elements.overlay.classList.add("hidden");
    this.elements.winnerScreen.classList.add("hidden");
    this.elements.loserScreen.classList.add("hidden");
    this.elements.drawScreen.classList.add("hidden");
    this.elements.spectatorEndScreen.classList.add("hidden");
    this.elements.nextGameOverlay.classList.add("hidden");
    this.elements.drawRequestOverlay.classList.add("hidden");
    this.elements.connectionLostOverlay.classList.add("hidden");

    this.elements.lobbyContainer.classList.remove("hidden");
    this.elements.board.classList.remove("board-flipped");
    this.elements.board.innerHTML = "";
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
