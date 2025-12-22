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
    // Estado e buffers para reprodução robusta (AudioContext fallback)
    this.audioCtx = null;
    this._decodedAudioBuffers = {};
    this._soundReady = {};

    // Preload básico e flag de readiness para cada elemento de áudio
    try {
      [
        ["join", this.elements.joinSound],
        ["move", this.elements.moveSound],
        ["capture", this.elements.captureSound],
      ].forEach(([key, el]) => {
        if (!el) return;
        try {
          el.preload = "auto";
          const onReady = () => {
            try {
              this._soundReady[key] = true;
            } catch (e) {}
          };
          el.addEventListener("canplaythrough", onReady, { once: true });
        } catch (e) {}
      });
    } catch (e) {}

    // Desbloqueio de áudio: cria/resume AudioContext no primeiro clique
    try {
      const self = this;
      const unlock = async () => {
        try {
          if (!self.audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx) self.audioCtx = new Ctx();
          }
          if (self.audioCtx && self.audioCtx.state === "suspended") {
            await self.audioCtx.resume();
          }

          // Tenta pré-decodificar o join sound para fallback via WebAudio
          const el = self.elements.joinSound || self.elements.moveSound;
          if (el && el.src) {
            try {
              const src = el.src;
              if (!self._decodedAudioBuffers[src]) {
                const resp = await fetch(src, { cache: "no-cache" });
                const arr = await resp.arrayBuffer();
                if (self.audioCtx && self.audioCtx.decodeAudioData) {
                  const buf = await new Promise((res, rej) => {
                    self.audioCtx.decodeAudioData(arr, res, rej);
                  });
                  self._decodedAudioBuffers[src] = buf;
                }
              }
            } catch (e) {}
          }
        } catch (e) {}
      };
      document.body.addEventListener("click", unlock, { once: true });
    } catch (e) {}
    // Controle de taxa para evitar reproduções muito rápidas
    this._lastPlayed = {};
    this._minIntervalMs = { join: 1000, move: 200, capture: 200 };
  },

  // Força o desbloqueio de áudio via interação do usuário.
  enableSound: async function () {
    try {
      // Marca local para evitar pedir sempre
      try {
        localStorage.setItem("soundEnabled", "true");
      } catch (e) {}

      if (!this.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this.audioCtx = new Ctx();
      }
      if (this.audioCtx && this.audioCtx.state === "suspended") {
        try {
          await this.audioCtx.resume();
        } catch (e) {}
      }

      // Tenta tocar um som de confirmação: primeiro elemento, depois WebAudio buzzer
      try {
        if (this.elements && this.elements.joinSound) {
          try {
            this.elements.joinSound.currentTime = 0;
            await this.elements.joinSound.play();
            this.elements.joinSound.pause();
            this.elements.joinSound.currentTime = 0;
            return true;
          } catch (e) {}
        }
      } catch (e) {}

      // Fallback: tocar breve tom via WebAudio (curto beep)
      try {
        if (this.audioCtx) {
          const ctx = this.audioCtx;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.setValueAtTime(880, ctx.currentTime);
          g.gain.setValueAtTime(0.001, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
          o.connect(g);
          g.connect(ctx.destination);
          o.start();
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
          setTimeout(() => {
            try {
              o.stop();
              o.disconnect();
              g.disconnect();
            } catch (e) {}
          }, 300);
          return true;
        }
      } catch (e) {}

      return false;
    } catch (e) {
      return false;
    }
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
      try {
        const boardEl =
          this.elements && this.elements.board
            ? this.elements.board
            : document.querySelector(".board");
        const fromSquare = document.querySelector(
          `.square[data-row="${from.row}"][data-col="${from.col}"]`
        );
        const toSquare = document.querySelector(
          `.square[data-row="${to.row}"][data-col="${to.col}"]`
        );

        // Se não houver elementos DOM, resolve imediatamente
        if (!boardEl || !fromSquare || !toSquare) return resolve();

        const pieceEl = fromSquare.querySelector(".piece");

        // Create a visual clone to animate
        let clone = null;
        if (pieceEl) {
          clone = pieceEl.cloneNode(true);
        } else {
          // fallback: create a simple circle element
          clone = document.createElement("div");
          clone.className = "piece temp-clone";
          clone.style.background =
            window.getComputedStyle(fromSquare).background || "#fff";
        }

        // Get bounding rects
        const fromRect = fromSquare.getBoundingClientRect();
        const toRect = toSquare.getBoundingClientRect();

        // Style clone for absolute positioning
        clone.style.position = "fixed";
        clone.style.left = `${fromRect.left}px`;
        clone.style.top = `${fromRect.top}px`;
        clone.style.width = `${fromRect.width}px`;
        clone.style.height = `${fromRect.height}px`;
        clone.style.margin = "0";
        clone.style.zIndex = 2147483650;
        clone.style.transition =
          "transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms linear";
        clone.style.pointerEvents = "none";

        document.body.appendChild(clone);

        // Preserve original piece class for fallback creation later
        let originalPieceClass = null;
        if (pieceEl) {
          originalPieceClass = pieceEl.className;
          // Hide original piece during animation to avoid visual duplicate
          pieceEl.style.visibility = "hidden";
        }

        // Calculate delta
        const deltaX = toRect.left - fromRect.left;
        const deltaY = toRect.top - fromRect.top;

        // Force reflow before starting transition
        // eslint-disable-next-line no-unused-expressions
        clone.getBoundingClientRect();

        // Start animation
        requestAnimationFrame(() => {
          try {
            clone.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
          } catch (e) {}
        });

        let finished = false;
        const cleanUp = () => {
          if (finished) return;
          finished = true;
          try {
            if (clone && clone.parentNode) clone.parentNode.removeChild(clone);
          } catch (e) {}
          // restore original piece visibility if it still exists in DOM
          try {
            if (pieceEl && pieceEl.parentNode) pieceEl.style.visibility = "";
          } catch (e) {}

          // Fallback: ensure the destination square has a visible `.piece` element.
          // Emitted deltas / full state updates sometimes race with the animation
          // and can leave the destination without a piece for a short time. To
          // make the UI robust, create a minimal piece element if missing.
          try {
            const destHasPiece =
              toSquare &&
              toSquare.querySelector &&
              toSquare.querySelector(".piece");
            if (!destHasPiece && toSquare) {
              const fallback = document.createElement("div");
              fallback.className = originalPieceClass || "piece black-piece";
              // ensure visible
              fallback.style.opacity = "1";
              fallback.style.visibility = "";
              toSquare.appendChild(fallback);
            }
          } catch (e) {}
          resolve();
        };

        // Transition end listener with timeout fallback
        const tEnd = (e) => {
          if (e && e.target !== clone) return;
          cleanUp();
        };
        clone.addEventListener("transitionend", tEnd);
        // Fallback timeout
        setTimeout(() => {
          try {
            clone.removeEventListener("transitionend", tEnd);
          } catch (e) {}
          cleanUp();
        }, 500);
      } catch (err) {
        try {
          console.error("animatePieceMove error", err);
        } catch (e) {}
        resolve();
      }
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
              // Remoção imediata da peça capturada sem animação
              try {
                if (existingPiece && existingPiece.parentNode)
                  existingPiece.parentNode.removeChild(existingPiece);
              } catch (e) {
                try {
                  existingPiece.remove();
                } catch (er) {}
              }
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
    const self = this;
    let soundEl;
    // Rate-limit: evita tocar o mesmo som repetidamente em curto espaço
    try {
      const key =
        type === "capture" ? "capture" : type === "join" ? "join" : "move";
      const min = (this._minIntervalMs && this._minIntervalMs[key]) || 400;
      const last = (this._lastPlayed && this._lastPlayed[key]) || 0;
      const now = Date.now();
      if (now - last < min) return; // muito cedo para tocar novamente
      // Se um som de capture foi tocado recentemente, suprimir sons de 'move'
      // para evitar tocar dois sons (capture + move) na mesma ação.
      if (
        key === "move" &&
        this._lastCapturePlayed &&
        now - this._lastCapturePlayed < (this._captureSuppressMs || 700)
      )
        return;
      this._lastPlayed = this._lastPlayed || {};
      this._lastPlayed[key] = now;
    } catch (e) {}
    // Marca tempo de último capture quando apropriado (feito depois do rate-limit)
    if (type === "capture") {
      soundEl = this.elements.captureSound;
      try {
        this._lastCapturePlayed = Date.now();
      } catch (e) {}
    } else if (type === "join") soundEl = this.elements.joinSound;
    else soundEl = this.elements.moveSound;

    this.triggerHaptic();

    const tryPlayElement = async (el) => {
      if (!el) return false;
      try {
        el.muted = false;
        // Garantia: para join desejar volume alto; evita caso volume tenha sido zerado
        if (el.id === "join-sound") el.volume = 0.95;
        else el.volume = el.volume || 0.8;
        el.currentTime = 0;
        await el.play();
        if (window.__CLIENT_DEBUG)
          console.log("[AUDIO] played element:", el.id);
        return true;
      } catch (e) {
        if (window.__CLIENT_DEBUG)
          console.warn("[AUDIO] tryPlayElement failed for", el && el.id, e);
        return false;
      }
    };

    const playViaAudioContext = async (el) => {
      try {
        if (!self.audioCtx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return false;
          self.audioCtx = new Ctx();
        }
        if (self.audioCtx.state === "suspended") {
          try {
            await self.audioCtx.resume();
          } catch (e) {}
        }

        let src = (el && el.src) || null;
        if (!src) return false;
        let buffer =
          self._decodedAudioBuffers && self._decodedAudioBuffers[src];
        if (!buffer) {
          const resp = await fetch(src, { cache: "no-cache" });
          const arr = await resp.arrayBuffer();
          buffer = await new Promise((res, rej) => {
            self.audioCtx.decodeAudioData(arr, res, rej);
          });
          self._decodedAudioBuffers = self._decodedAudioBuffers || {};
          self._decodedAudioBuffers[src] = buffer;
        }
        const bs = self.audioCtx.createBufferSource();
        bs.buffer = buffer;
        bs.connect(self.audioCtx.destination);
        bs.start(0);
        return true;
      } catch (e) {
        return false;
      }
    };

    return (async () => {
      // 1) Tenta diretamente no elemento (rápido)
      if (await tryPlayElement(soundEl)) return;

      // 2) Retentar algumas vezes brevemente (caso de carregamento lento)
      const RETRIES = 3;
      for (let i = 0; i < RETRIES; i++) {
        await new Promise((r) => setTimeout(r, 150));
        if (await tryPlayElement(soundEl)) return;
      }

      // 3) Fallback: WebAudio (decodificado) se disponível
      if (await playViaAudioContext(soundEl)) return;

      // 4) Fallback final: gerar beep curto via WebAudio para garantir um alerta
      try {
        if (self.audioCtx) {
          if (window.__CLIENT_DEBUG)
            console.log("[AUDIO] playing final beep fallback");
          const ctx = self.audioCtx;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.setValueAtTime(880, ctx.currentTime);
          g.gain.setValueAtTime(0.001, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
          o.connect(g);
          g.connect(ctx.destination);
          o.start();
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
          setTimeout(() => {
            try {
              o.stop();
              o.disconnect();
              g.disconnect();
            } catch (e) {}
          }, 300);
          return;
        }
      } catch (e) {
        if (window.__CLIENT_DEBUG)
          console.warn("[AUDIO] final beep fallback failed", e);
      }
    })();
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

  // --- TOASTS (não bloqueantes) ---
  showToast: function (message, opts = {}) {
    try {
      const type = opts.type || "info"; // info, success, error
      let container = document.getElementById("ui-toast-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "ui-toast-container";
        container.style.cssText =
          "position:fixed;right:16px;top:16px;z-index:999999;display:flex;flex-direction:column;gap:8px;";
        document.body.appendChild(container);
      }

      const t = document.createElement("div");
      t.className = `ui-toast ui-toast-${type}`;
      t.style.cssText = `min-width:160px;padding:10px 14px;border-radius:8px;color:#fff;font-weight:600;box-shadow:0 8px 20px rgba(0,0,0,0.35);opacity:0;transform:translateY(-8px);transition:all 220ms ease;`;
      t.textContent = message;
      if (type === "success")
        t.style.background = "linear-gradient(90deg,#2ecc71,#27ae60)";
      else if (type === "error")
        t.style.background = "linear-gradient(90deg,#e74c3c,#c0392b)";
      else t.style.background = "linear-gradient(90deg,#3498db,#2c82c9)";

      container.appendChild(t);
      // enter
      requestAnimationFrame(() => {
        t.style.opacity = "1";
        t.style.transform = "translateY(0)";
      });

      const duration = opts.duration || 3600;
      setTimeout(() => {
        try {
          t.style.opacity = "0";
          t.style.transform = "translateY(-8px)";
          setTimeout(() => {
            try {
              if (t && t.parentNode) t.parentNode.removeChild(t);
            } catch (e) {}
          }, 260);
        } catch (e) {}
      }, duration);
    } catch (e) {}
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
