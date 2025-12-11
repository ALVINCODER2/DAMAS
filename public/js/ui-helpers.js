// ui-helpers.js (COM RENDERIZAÇÃO INTELIGENTE E ANIMAÇÃO CORRIGIDA)

window.UI = {
  elements: {},

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
      joinSound: document.getElementById("join-sound"), // NOVO
    };
  },

  // --- ANIMAÇÃO DE MOVIMENTO (CORRIGIDA) ---

  animatePieceMove: function (from, to, boardSize) {
    return new Promise((resolve) => {
      const square = document.querySelector(
        `.square[data-row='${from.row}'][data-col='${from.col}']`
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
      const toSquare = document.querySelector(
        `.square[data-row='${to.row}'][data-col='${to.col}']`
      );
      if (!toSquare) {
        resolve();
        return;
      }
      const toRect = toSquare.getBoundingClientRect();

      let deltaX = toRect.left - fromRect.left;
      let deltaY = toRect.top - fromRect.top;

      // ### CORREÇÃO DO BUG DAS PRETAS ###
      const isFlipped = this.elements.board.classList.contains("board-flipped");

      piece.style.transition = "transform 0.2s ease-in-out";
      piece.style.zIndex = 100;

      if (isFlipped) {
        // Alteração na Lógica: Ao aplicar 'rotate' ANTES do 'translate', reorientamos os eixos
        // da peça para alinhar com a tela (360 graus efetivos), permitindo usar deltas normais.
        piece.style.transform = `rotate(180deg) translate(${deltaX}px, ${deltaY}px)`;
      } else {
        piece.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
      }

      setTimeout(() => {
        resolve();
      }, 200);
    });
  },

  // --- RENDERIZAÇÃO INTELIGENTE ---

  renderPieces: function (boardState, boardSize) {
    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const square = document.querySelector(
          `.square[data-row='${row}'][data-col='${col}']`
        );
        if (!square) continue;

        const pieceType = boardState[row][col];
        const existingPiece = square.querySelector(".piece");

        if (pieceType !== 0) {
          const isBlack = pieceType.toString().toLowerCase() === "p";
          const isKing = pieceType === "P" || pieceType === "B";
          const classColor = isBlack ? "black-piece" : "white-piece";

          if (existingPiece) {
            if (!existingPiece.classList.contains(classColor)) {
              existingPiece.className = `piece ${classColor}`;
            }
            if (isKing && !existingPiece.classList.contains("king")) {
              existingPiece.classList.add("king");
            }
            // Limpa estilos de animação para garantir que a peça fique parada corretamente
            existingPiece.style.transform = "";
            existingPiece.style.transition = "";
            existingPiece.style.zIndex = "";
          } else {
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
  },

  createBoard: function (boardSize, clickHandler) {
    const board = this.elements.board;
    board.innerHTML = "";
    let squareSizeCSS;

    if (boardSize === 10) {
      squareSizeCSS = "min(50px, 8.5vw)";
      if (window.innerWidth <= 768) {
        squareSizeCSS = "min(36px, 9vw)";
      }
    } else {
      squareSizeCSS = "min(60px, 10vw)";
      if (window.innerWidth <= 768) {
        squareSizeCSS = "min(45px, 11vw)";
      }
    }

    board.style.gridTemplateColumns = `repeat(${boardSize}, ${squareSizeCSS})`;
    board.style.gridTemplateRows = `repeat(${boardSize}, ${squareSizeCSS})`;

    for (let row = 0; row < boardSize; row++) {
      for (let col = 0; col < boardSize; col++) {
        const square = document.createElement("div");
        square.classList.add(
          "square",
          (row + col) % 2 === 1 ? "dark" : "light"
        );
        square.dataset.row = row;
        square.dataset.col = col;
        board.appendChild(square);
      }
    }
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

      card.innerHTML = `
            <div class="room-card-info">
                <p><strong>Criador:</strong> ${
                  room.creatorEmail.split("@")[0]
                }</p>
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

      card.innerHTML = `
            <div class="room-card-info">
                <p><strong>Jogadores:</strong> ${
                  room.player1Email.split("@")[0]
                } vs ${room.player2Email.split("@")[0]}</p>
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
      const fromSq = document.querySelector(
        `.square[data-row='${lastMove.from.row}'][data-col='${lastMove.from.col}']`
      );
      const toSq = document.querySelector(
        `.square[data-row='${lastMove.to.row}'][data-col='${lastMove.to.col}']`
      );
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
        const square = document.querySelector(
          `.square[data-row='${pos.row}'][data-col='${pos.col}']`
        );
        if (square && square.firstChild) {
          square.firstChild.classList.add("mandatory-capture");
        }
      });
    }
  },

  highlightValidMoves: function (moves) {
    moves.forEach((move) => {
      const square = document.querySelector(
        `.square[data-row='${move.row}'][data-col='${move.col}']`
      );
      if (square) {
        square.classList.add("valid-move-highlight");
      }
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
    let sound;
    if (type === "capture") sound = this.elements.captureSound;
    else if (type === "join")
      sound = this.elements.joinSound; // Lógica para o som de entrada
    else sound = this.elements.moveSound;

    if (sound) {
      sound.currentTime = 0;
      sound.play().catch((e) => console.log("Áudio bloqueado:", e));
    }
  },

  updatePlayerNames: function (users) {
    if (!users) return;
    const whiteName = users.white ? users.white.split("@")[0] : "Brancas";
    const blackName = users.black ? users.black.split("@")[0] : "Pretas";

    if (this.elements.whitePlayerName)
      this.elements.whitePlayerName.textContent = whiteName;
    if (this.elements.blackPlayerName)
      this.elements.blackPlayerName.textContent = blackName;
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
