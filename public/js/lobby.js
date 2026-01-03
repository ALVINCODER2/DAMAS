// public/js/lobby.js - Gerencia Lobby, Torneios, Salas e Pagamentos

window.initLobby = function (socket, UI) {
  let paymentCheckInterval = null;
  let tempRoomCode = null;
  let tournamentCountdownInterval = null;
  let countdownClosedByUser = false;
  let currentSelectedPresetId = null;
  console.log("[initLobby] currentUser at init:", window.currentUser);

  // --- HELPER: UPDATE WELCOME MESSAGE (Global) ---
  window.updateLobbyWelcome = function () {
    const welcomeMsg = document.getElementById("lobby-welcome-message");
    const avatarImg = document.getElementById("lobby-avatar");

    if (welcomeMsg && window.currentUser) {
      const displayName =
        window.currentUser.username || window.currentUser.email.split("@")[0];
      welcomeMsg.innerHTML = `Olá, <strong>${displayName}</strong><br><small style="color:#f1c40f">R$ ${window.currentUser.saldo.toFixed(
        2
      )}</small>`;

      if (avatarImg) {
        if (
          window.currentUser.avatar &&
          window.currentUser.avatar.trim() !== ""
        ) {
          avatarImg.src = window.currentUser.avatar;
        } else {
          avatarImg.src = `https://ui-avatars.com/api/?name=${displayName}&background=random`;
          console.log("[prefs] populatePresets start");
        }
      }
    }
  };

  function populatePresets() {
    try {
      const container = document.getElementById("prefs-presets");
      if (!container) return;
      container.innerHTML = "";
      const presets = window.BOARD_PRESETS || [];
      presets.forEach((p) => {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "prefs-preset-btn";
        sw.title = p.name || p.id;
        sw.style.cssText = `width:64px;height:48px;border-radius:6px;border:2px solid transparent;padding:4px;background:#111;display:flex;align-items:center;justify-content:center;cursor:pointer;`;

        // mini visual: a pequena grade 2x2 com cores
        sw.innerHTML = `
          <div style="width:100%;height:100%;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;border-radius:4px;overflow:hidden;">
            <div style="background:${p.boardLight}"></div>
            <div style="background:${p.boardDark}"></div>
            <div style="background:${p.boardDark}"></div>
            <div style="background:${p.boardLight}"></div>
          </div>
        `;

        sw.addEventListener("click", () => {
          // Aplica preset ao preview e marca como selecionado
          try {
            currentSelectedPresetId = p.id;
            const previewBoard = document.getElementById("prefs-preview-board");
            if (previewBoard) {
              if (p.boardLight)
                previewBoard.style.setProperty("--light-square", p.boardLight);
              if (p.boardDark)
                previewBoard.style.setProperty("--dark-square", p.boardDark);
              if (p.pieceWhite)
                previewBoard.style.setProperty(
                  "--white-piece-color-1",
                  p.pieceWhite
                );
              if (p.pieceBlack)
                previewBoard.style.setProperty(
                  "--black-piece-color-1",
                  p.pieceBlack
                );
              if (window.UI && window.UI.renderBoardInto) {
                const sample = makeEmptyBoard(8);
                window.UI.renderBoardInto(previewBoard, sample, 8);
              }
            }
            // Highlight selected
            document.querySelectorAll(".prefs-preset-btn").forEach((btn) => {
              btn.style.borderColor = "transparent";
              btn.style.boxShadow = "none";
              if (btn.title === currentSelectedPresetId) {
                btn.style.borderColor = "#f1c40f";
                btn.style.boxShadow = "0 0 0 3px rgba(241,196,15,0.12)";
              }
            });
          } catch (e) {}
        });
        container.appendChild(sw);
      });
    } catch (e) {}
  }

  // --- Handler do botão de Histórico (permite busca por email e ver públicas) ---
  try {
    const viewHistoryBtn = document.getElementById("view-history-btn");
    if (viewHistoryBtn)
      viewHistoryBtn.addEventListener("click", async () => {
        const overlay = document.getElementById("history-overlay");
        const list = document.getElementById("history-list");
        overlay.classList.remove("hidden");
        // Build a small search control to allow fetching by email
        try {
          list.innerHTML = "";
          const ctrl = document.createElement("div");
          ctrl.style.display = "flex";
          ctrl.style.gap = "8px";
          ctrl.style.marginBottom = "10px";
          const input = document.createElement("input");
          input.type = "email";
          input.placeholder =
            "Email para buscar histórico (ex: alvincoder@gmail.com)";
          input.style.flex = "1";
          input.style.padding = "6px";
          input.style.borderRadius = "6px";
          input.style.border = "1px solid #444";
          if (window.currentUser && window.currentUser.email)
            input.value = window.currentUser.email;
          const btn = document.createElement("button");
          btn.textContent = "Buscar";
          btn.className = "btn-confirm";
          ctrl.appendChild(input);
          ctrl.appendChild(btn);
          list.appendChild(ctrl);

          const resultsContainer = document.createElement("div");
          list.appendChild(resultsContainer);

          async function doSearch(targetEmail) {
            console.log(
              "[history] doSearch targetEmail:",
              targetEmail,
              "window.currentUser:",
              window.currentUser && window.currentUser.email
            );
            resultsContainer.innerHTML =
              '<p style="color:#ccc;">Carregando...</p>';
            try {
              console.log("[history] POST /api/user/history body:", {
                email: targetEmail,
              });
              const res = await fetch("/api/user/history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: targetEmail }),
              });
              const data = await res.json();
              resultsContainer.innerHTML = "";
              if (!data || data.length === 0) {
                resultsContainer.innerHTML = "<p>Sem partidas recentes.</p>";
                const pubBtn = document.createElement("button");
                pubBtn.textContent = "Ver partidas públicas recentes";
                pubBtn.style.marginTop = "8px";
                pubBtn.addEventListener("click", async () => {
                  try {
                    pubBtn.disabled = true;
                    pubBtn.textContent = "Carregando...";
                    const resp = await fetch(`/api/recent-matches?limit=50`);
                    const pubRaw = await resp.json();
                    const target = (
                      targetEmail ||
                      (window.currentUser && window.currentUser.email) ||
                      ""
                    ).toLowerCase();
                    const pub = Array.isArray(pubRaw)
                      ? pubRaw.filter((m) => {
                          const p1 = (m.player1 || "").toLowerCase();
                          const p2 = (m.player2 || "").toLowerCase();
                          return p1 === target || p2 === target;
                        })
                      : [];
                    resultsContainer.innerHTML = "";
                    if (!pub || pub.length === 0) {
                      resultsContainer.innerHTML =
                        "<p>Nenhuma partida pública recente.</p>";
                    } else {
                      const ul2 = document.createElement("ul");
                      ul2.style.listStyle = "none";
                      ul2.style.padding = "0";
                      pub.forEach((m) => {
                        try {
                          const li = document.createElement("li");
                          li.style.background = "rgba(255,255,255,0.05)";
                          li.style.marginBottom = "8px";
                          li.style.padding = "10px";
                          li.style.borderRadius = "8px";
                          li.style.fontSize = "0.9rem";
                          let resultText = "Empate";
                          let color = "#95a5a6";
                          if (m.winner) {
                            if (
                              window.currentUser &&
                              m.winner === window.currentUser.email
                            ) {
                              resultText = "VITÓRIA";
                              color = "#2ecc71";
                            } else {
                              resultText = "DERROTA";
                              color = "#e74c3c";
                            }
                          }
                          const opponent = window.currentUser
                            ? m.player1 === window.currentUser.email
                              ? m.player2
                              : m.player1
                            : m.player1 + " / " + m.player2;
                          const date = new Date(
                            m.createdAt
                          ).toLocaleDateString();
                          li.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong style="color:${color}">${resultText}</strong><span style="color:#aaa; font-size:0.8rem;">${date}</span></div><div style="display:flex; justify-content:space-between;"><span>vs ${
                            opponent.split("@")[0]
                          }</span><span>Aposta: <strong>R$ ${Number(
                            m.bet || 0
                          ).toFixed(2)}</strong></span></div>`;
                          ul2.appendChild(li);
                        } catch (e) {}
                      });
                      // Merge recent optimistic buffer entries (if any) into the displayed list
                      try {
                        const buf = (window.__recentHistoryBuffer || []).filter(
                          (bm) => {
                            const targetLower = (target || "").toLowerCase();
                            const bp1 = (bm.player1 || "").toLowerCase();
                            const bp2 = (bm.player2 || "").toLowerCase();
                            return bp1 === targetLower || bp2 === targetLower;
                          }
                        );
                        buf.forEach((bm) => {
                          try {
                            const exists = pub.some((d) => {
                              if (!d || !bm) return false;
                              const matchPlayers =
                                (d.player1 === bm.player1 &&
                                  d.player2 === bm.player2) ||
                                (d.player1 === bm.player2 &&
                                  d.player2 === bm.player1);
                              const sameBet =
                                Number(d.bet || 0) === Number(bm.bet || 0);
                              const timeDiff = Math.abs(
                                new Date(d.createdAt).getTime() -
                                  new Date(bm.createdAt).getTime()
                              );
                              return matchPlayers && sameBet && timeDiff < 5000;
                            });
                            if (!exists) {
                              const li = document.createElement("li");
                              li.style.background = "rgba(255,255,255,0.05)";
                              li.style.marginBottom = "8px";
                              li.style.padding = "10px";
                              li.style.borderRadius = "8px";
                              li.style.fontSize = "0.9rem";
                              let resultText = "Empate";
                              let color = "#95a5a6";
                              if (bm.winner) {
                                if (
                                  window.currentUser &&
                                  bm.winner === window.currentUser.email
                                ) {
                                  resultText = "VITÓRIA";
                                  color = "#2ecc71";
                                } else {
                                  resultText = "DERROTA";
                                  color = "#e74c3c";
                                }
                              }
                              const opponent = window.currentUser
                                ? bm.player1 === window.currentUser.email
                                  ? bm.player2
                                  : bm.player1
                                : bm.player1 + " / " + bm.player2;
                              const date = new Date(
                                bm.createdAt
                              ).toLocaleDateString();
                              li.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong style="color:${color}">${resultText}</strong><span style="color:#aaa; font-size:0.8rem;">${date}</span></div><div style="display:flex; justify-content:space-between;"><span>vs ${
                                opponent.split("@")[0]
                              }</span><span>Aposta: <strong>R$ ${Number(
                                bm.bet || 0
                              ).toFixed(2)}</strong></span></div>`;
                              ul2.insertBefore(li, ul2.firstChild);
                            }
                          } catch (e) {}
                        });
                      } catch (e) {}
                      resultsContainer.appendChild(ul2);
                    }
                  } catch (e) {
                    resultsContainer.innerHTML =
                      "<p>Erro ao carregar públicas.</p>";
                  }
                });
                resultsContainer.appendChild(pubBtn);
                return;
              }
              const ul = document.createElement("ul");
              ul.style.listStyle = "none";
              ul.style.padding = "0";
              data.forEach((m) => {
                try {
                  const li = document.createElement("li");
                  li.style.background = "rgba(255,255,255,0.05)";
                  li.style.marginBottom = "8px";
                  li.style.padding = "10px";
                  li.style.borderRadius = "8px";
                  li.style.fontSize = "0.9rem";
                  let resultText = "Empate";
                  let color = "#95a5a6";
                  if (m.winner) {
                    if (
                      m.winner ===
                      (window.currentUser && window.currentUser.email)
                    ) {
                      resultText = "VITÓRIA";
                      color = "#2ecc71";
                    } else {
                      resultText = "DERROTA";
                      color = "#e74c3c";
                    }
                  }
                  const opponent =
                    m.player1 ===
                    (window.currentUser && window.currentUser.email)
                      ? m.player2
                      : m.player1;
                  const date = new Date(m.createdAt).toLocaleDateString();
                  li.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong style="color:${color}">${resultText}</strong><span style="color:#aaa; font-size:0.8rem;">${date}</span></div><div style="display:flex; justify-content:space-between;"><span>vs ${
                    opponent.split("@")[0]
                  }</span><span>Aposta: <strong>R$ ${Number(m.bet || 0).toFixed(
                    2
                  )}</strong></span></div>`;
                  ul.appendChild(li);
                } catch (e) {}
              });
              // Merge recent optimistic buffer entries (if any) into the displayed personal list
              try {
                const buf = window.__recentHistoryBuffer || [];
                buf.forEach((bm) => {
                  try {
                    const exists = data.some((d) => {
                      if (!d || !bm) return false;
                      const matchPlayers =
                        (d.player1 === bm.player1 &&
                          d.player2 === bm.player2) ||
                        (d.player1 === bm.player2 && d.player2 === bm.player1);
                      const sameBet =
                        Number(d.bet || 0) === Number(bm.bet || 0);
                      const timeDiff = Math.abs(
                        new Date(d.createdAt).getTime() -
                          new Date(bm.createdAt).getTime()
                      );
                      return matchPlayers && sameBet && timeDiff < 5000;
                    });
                    if (!exists) {
                      const li = document.createElement("li");
                      li.style.background = "rgba(255,255,255,0.05)";
                      li.style.marginBottom = "8px";
                      li.style.padding = "10px";
                      li.style.borderRadius = "8px";
                      li.style.fontSize = "0.9rem";
                      let resultText = "Empate";
                      let color = "#95a5a6";
                      if (bm.winner) {
                        if (
                          bm.winner ===
                          (window.currentUser && window.currentUser.email)
                        ) {
                          resultText = "VITÓRIA";
                          color = "#2ecc71";
                        } else {
                          resultText = "DERROTA";
                          color = "#e74c3c";
                        }
                      }
                      const opponent =
                        bm.player1 ===
                        (window.currentUser && window.currentUser.email)
                          ? bm.player2
                          : bm.player1;
                      const date = new Date(bm.createdAt).toLocaleDateString();
                      li.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"> <strong style="color:${color}">${resultText}</strong><span style="color:#aaa; font-size:0.8rem;">${date}</span></div><div style="display:flex; justify-content:space-between;"><span>vs ${
                        opponent.split("@")[0]
                      }</span><span>Aposta: <strong>R$ ${Number(
                        bm.bet || 0
                      ).toFixed(2)}</strong></span></div>`;
                      ul.insertBefore(li, ul.firstChild);
                    }
                  } catch (e) {}
                });
              } catch (e) {}
              resultsContainer.appendChild(ul);
            } catch (e) {
              resultsContainer.innerHTML =
                "<p style='color:#e74c3c;'>Erro ao carregar.</p>";
            }
          }

          btn.addEventListener("click", () => {
            const target = (input.value || "").trim();
            if (!target) return alert("Informe um email válido.");
            doSearch(target.toLowerCase());
          });
          // auto-search if input had preset value
          if (input.value && input.value.trim() !== "")
            doSearch(input.value.trim().toLowerCase());
        } catch (e) {
          list.innerHTML =
            "<p style='color:#e74c3c;'>Erro ao abrir histórico.</p>";
        }
      });
  } catch (e) {}

  function renderPreviewBoard(boardEl, boardState) {
    try {
      const size = boardState.length || 8;
      if (window.UI && window.UI.renderBoardInto) {
        window.UI.renderBoardInto(boardEl, boardState, size);
        // remove texturas caso existam (garante que cor apareça)
        boardEl
          .querySelectorAll(".light, .dark")
          .forEach((sq) => (sq.style.backgroundImage = "none"));
      } else {
        boardEl.innerHTML = "";
      }
    } catch (e) {
      console.error("renderPreviewBoard error", e);
    }
  }

  function initPreviewBoard() {
    const previewBoard = document.getElementById("prefs-preview-board");
    if (!previewBoard) return;
    const size = 8;
    const sample = makeEmptyBoard(size);
    renderPreviewBoard(previewBoard, sample);

    // Aplica preferências iniciais ao preview (se existirem)
    const prefs = window.userPreferences || {};
    // Se existir presetId, aplica cores correspondentes
    if (prefs.presetId && window.BOARD_PRESETS) {
      const p = (window.BOARD_PRESETS || []).find(
        (x) => x.id === prefs.presetId
      );
      if (p) {
        previewBoard.style.setProperty("--light-square", p.boardLight);
        previewBoard.style.setProperty("--dark-square", p.boardDark);
        previewBoard.style.setProperty("--white-piece-color-1", p.pieceWhite);
        previewBoard.style.setProperty("--black-piece-color-1", p.pieceBlack);
        currentSelectedPresetId = p.id;
      }
    } else {
      if (prefs.boardLight)
        previewBoard.style.setProperty("--light-square", prefs.boardLight);
      if (prefs.boardDark)
        previewBoard.style.setProperty("--dark-square", prefs.boardDark);
      if (prefs.pieceWhite)
        previewBoard.style.setProperty(
          "--white-piece-color-1",
          prefs.pieceWhite
        );
      if (prefs.pieceBlack)
        previewBoard.style.setProperty(
          "--black-piece-color-1",
          prefs.pieceBlack
        );
    }

    // highlight preset if selected
    setTimeout(() => {
      if (!currentSelectedPresetId) return;
      document.querySelectorAll(".prefs-preset-btn").forEach((btn) => {
        btn.style.borderColor = "transparent";
        btn.style.boxShadow = "none";
        if (
          btn.title === currentSelectedPresetId ||
          btn.title === currentSelectedPresetId
        ) {
          btn.style.borderColor = "#f1c40f";
          btn.style.boxShadow = "0 0 0 3px rgba(241,196,15,0.12)";
        }
      });
    }, 120);
  }

  // --- ADICIONA BOTÃO NO LOBBY E CARREGA PREFERÊNCIAS ---
  try {
    const welcomeMsgEl = document.getElementById("lobby-welcome-message");
    if (welcomeMsgEl && !document.getElementById("customize-visual-open-btn")) {
      const btn = document.createElement("button");
      btn.id = "customize-visual-open-btn";
      btn.textContent = "Personalizar Visual";
      btn.style.marginLeft = "8px";
      btn.style.padding = "6px 8px";
      btn.style.borderRadius = "6px";
      btn.style.border = "none";
      btn.style.cursor = "pointer";
      btn.addEventListener("click", openVisualPrefs);
      welcomeMsgEl.parentNode.appendChild(btn);
    }
    loadAndApplyPreferences();
  } catch (e) {}

  // --- FUNÇÃO DE CONTAGEM REGRESSIVA TORNEIO ---
  function startTournamentTimer() {
    const timerContainer = document.getElementById("tournament-inline-timer");
    const timerDisplay = document.getElementById("countdown-timer-display");

    if (tournamentCountdownInterval) clearInterval(tournamentCountdownInterval);

    const updateTimer = () => {
      const now = new Date();
      const target = new Date();
      const targetHour = 21;
      const targetMinute = 0;

      target.setHours(targetHour, targetMinute, 0, 0);

      const diff = target - now;

      // Se já passou muito tempo (ex: 10 min depois), esconde o timer
      if (diff < -600000) {
        if (timerContainer) timerContainer.classList.add("hidden");
        clearInterval(tournamentCountdownInterval);
        return;
      }

      if (diff < 0) {
        // Estamos no horário (23:59 - ...)
        if (timerDisplay) {
          timerDisplay.textContent = "INICIANDO...";
          timerDisplay.style.color = "#e74c3c"; // Vermelho
        }
        if (timerContainer) timerContainer.classList.remove("hidden");
        return;
      }

      // Calculando tempo restante
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (timerDisplay) {
        timerDisplay.textContent = `${hours
          .toString()
          .padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
          .toString()
          .padStart(2, "0")}`;
        timerDisplay.style.color = "#f1c40f"; // Gold
      }
      if (timerContainer) timerContainer.classList.remove("hidden");
    };

    updateTimer();
    tournamentCountdownInterval = setInterval(updateTimer, 1000);
  }

  function stopTournamentTimer() {
    if (tournamentCountdownInterval) clearInterval(tournamentCountdownInterval);
    const timerContainer = document.getElementById("tournament-inline-timer");
    if (timerContainer) timerContainer.classList.add("hidden");
  }

  // Expõe stopTournamentTimer globalmente para o logout usar
  window.stopTournamentTimer = stopTournamentTimer;

  // --- TOGGLE CRIAR SALA ---
  const createRoomToggle = document.getElementById("btn-toggle-create-room");
  if (createRoomToggle) {
    createRoomToggle.addEventListener("click", () => {
      const section = document.getElementById("create-room-section");
      if (section) {
        if (
          section.classList.contains("hidden-animated") ||
          section.classList.contains("hidden")
        ) {
          section.classList.remove("hidden");
          section.classList.remove("hidden-animated");
          section.classList.add("visible-animated");
        } else {
          section.classList.remove("visible-animated");
          section.classList.add("hidden-animated");
          setTimeout(() => {
            if (section.classList.contains("hidden-animated"))
              section.classList.add("hidden");
          }, 300);
        }
      }
    });
  }

  // --- LÓGICA DE SALAS ---
  if (UI.elements.timeControlSelect) {
    UI.elements.timeControlSelect.addEventListener("change", () => {
      UI.updateTimerOptions(UI.elements.timeControlSelect.value);
    });
    UI.updateTimerOptions("move");
  }

  const createRoomBtn = document.getElementById("create-room-btn");
  if (createRoomBtn) {
    createRoomBtn.addEventListener("click", () => {
      if (!window.currentUser.username) {
        if (window.enforceUsernameRequirement)
          window.enforceUsernameRequirement();
        return;
      }
      const betInput = document.getElementById("bet-amount-input");
      const bet = parseInt(betInput.value, 10);
      const gameMode = document.getElementById("game-mode-select").value;
      const timeControl = document.getElementById("time-control-select").value;
      const timerSelect = document.getElementById("timer-select");
      const timerDuration = timerSelect ? timerSelect.value : 40;

      // Lê checkbox de sala privada para enviar ao servidor
      const privateCheckbox = document.getElementById("private-room-checkbox");
      const isPrivate = !!(privateCheckbox && privateCheckbox.checked);

      if (bet > 0 && window.currentUser) {
        socket.emit("createRoom", {
          bet,
          user: window.currentUser,
          gameMode,
          timerDuration,
          timeControl,
          isPrivate, // Envia para o servidor
        });
        createRoomBtn.disabled = true;
        createRoomBtn.textContent = "Criando...";
      } else if (!window.currentUser) {
        alert("Erro de autenticação.");
      } else {
        alert("Aposta deve ser maior que zero.");
      }
    });
  }

  const cancelRoomBtn = document.getElementById("cancel-room-btn");
  if (cancelRoomBtn) {
    cancelRoomBtn.addEventListener("click", () => {
      const roomCode = document.getElementById("room-code-display").textContent;
      if (roomCode) socket.emit("cancelRoom", { roomCode });
    });
  }

  // --- NOVO: ENTRAR EM SALA PRIVADA POR CÓDIGO ---
  const joinPrivateBtn = document.getElementById("join-private-btn");
  if (joinPrivateBtn) {
    joinPrivateBtn.addEventListener("click", () => {
      if (!window.currentUser || !window.currentUser.username) {
        if (window.enforceUsernameRequirement)
          window.enforceUsernameRequirement();
        return;
      }

      const codeInput = document.getElementById("join-room-code-input");
      const roomCode = codeInput.value.trim().toUpperCase();

      if (roomCode && window.currentUser) {
        // Se o usuário criou uma sala antes, cancelar imediatamente essa sala
        try {
          const myCodeEl = document.getElementById("room-code-display");
          const myCode = myCodeEl ? myCodeEl.textContent.trim() : null;
          const waitingArea = document.getElementById("waiting-area");
          if (
            waitingArea &&
            !waitingArea.classList.contains("hidden") &&
            myCode &&
            myCode !== "---" &&
            myCode !== roomCode
          ) {
            socket.emit("cancelRoom", { roomCode: myCode });
            // atualizar UI localmente para resposta imediata
            waitingArea.classList.add("hidden");
            const btn = document.getElementById("create-room-btn");
            if (btn) {
              btn.disabled = false;
              btn.textContent = "INICIAR SALA";
            }
            tempRoomCode = null;
          }
        } catch (e) {}

        socket.emit("joinRoomRequest", { roomCode, user: window.currentUser });
      } else {
        alert("Por favor, digite o código da sala.");
      }
    });
  }

  document.getElementById("lobby-container").addEventListener("click", (e) => {
    if (e.target.classList.contains("join-room-btn")) {
      if (!window.currentUser || !window.currentUser.username) {
        if (window.enforceUsernameRequirement)
          window.enforceUsernameRequirement();
        return;
      }
      const roomCode = e.target.dataset.roomCode;
      if (roomCode && window.currentUser) {
        // Se o usuário criou uma sala antes, cancelar imediatamente essa sala
        try {
          const myCodeEl = document.getElementById("room-code-display");
          const myCode = myCodeEl ? myCodeEl.textContent.trim() : null;
          const waitingArea = document.getElementById("waiting-area");
          if (
            waitingArea &&
            !waitingArea.classList.contains("hidden") &&
            myCode &&
            myCode !== "---" &&
            myCode !== roomCode
          ) {
            socket.emit("cancelRoom", { roomCode: myCode });
            waitingArea.classList.add("hidden");
            const btn = document.getElementById("create-room-btn");
            if (btn) {
              btn.disabled = false;
              btn.textContent = "INICIAR SALA";
            }
            tempRoomCode = null;
          }
        } catch (e) {}

        socket.emit("joinRoomRequest", { roomCode, user: window.currentUser });
      }
    }
    if (e.target.classList.contains("watch-game-btn")) {
      const roomCode = e.target.dataset.roomCode;
      if (!window.currentUser) return alert("Faça login para assistir.");
      if (!window.currentUser.username) {
        if (window.enforceUsernameRequirement)
          window.enforceUsernameRequirement();
        return;
      }
      try {
        localStorage.setItem("spectateRoom", roomCode);
        localStorage.setItem("spectatePending", "1");
      } catch (e) {}
      // Emit request to server to join as spectator; server will emit spectatorJoined or joinError
      socket.emit("joinAsSpectator", { roomCode });
      return;
    }
  });

  function openVisualPrefs() {
    createVisualPrefsUI();
    const overlay = document.getElementById("visual-prefs-overlay");
    if (!overlay) return;
    const defaults = window.userPreferences || {};
    // determina preset inicial (por presetId salvo, ou primeiro preset disponível)
    const presets = window.BOARD_PRESETS || [];
    if (defaults.presetId) currentSelectedPresetId = defaults.presetId;
    else if (!currentSelectedPresetId && presets.length > 0)
      currentSelectedPresetId = presets[0].id;
    overlay.classList.remove("hidden");

    // Atualiza destaque do preset selecionado
    try {
      document.querySelectorAll(".prefs-preset-btn").forEach((btn) => {
        btn.style.borderColor = "transparent";
        btn.style.boxShadow = "none";
        const title = btn.title || "";
        const presets = window.BOARD_PRESETS || [];
        const p = presets.find(
          (x) =>
            x.id === currentSelectedPresetId ||
            x.name === title ||
            x.id === title
        );
        if (p && p.id === currentSelectedPresetId) {
          btn.style.borderColor = "#f1c40f";
          btn.style.boxShadow = "0 0 0 3px rgba(241,196,15,0.12)";
        }
      });
    } catch (e) {}

    // Atualiza preview imediatamente
    try {
      const previewBoard = document.getElementById("prefs-preview-board");
      const size = 8;
      const sample = makeEmptyBoard(size);
      if (defaults.boardLight)
        previewBoard.style.setProperty("--light-square", defaults.boardLight);
      if (defaults.boardDark)
        previewBoard.style.setProperty("--dark-square", defaults.boardDark);
      if (defaults.pieceWhite)
        previewBoard.style.setProperty(
          "--white-piece-color-1",
          defaults.pieceWhite
        );
      if (defaults.pieceBlack)
        previewBoard.style.setProperty(
          "--black-piece-color-1",
          defaults.pieceBlack
        );
      if (window.UI && window.UI.renderBoardInto) {
        window.UI.renderBoardInto(previewBoard, sample, size);
        previewBoard
          .querySelectorAll(".light, .dark")
          .forEach((sq) => (sq.style.backgroundImage = "none"));
      }
    } catch (e) {}
  }

  const refreshLobbyBtn = document.getElementById("refresh-lobby-btn");
  if (refreshLobbyBtn) {
    refreshLobbyBtn.addEventListener("click", () => {
      if (window.currentUser) {
        socket.emit("enterLobby", window.currentUser);
        if (window.updateTournamentStatus) window.updateTournamentStatus();
        const originalText = refreshLobbyBtn.innerHTML;
        refreshLobbyBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i>';
        refreshLobbyBtn.disabled = true;
        setTimeout(() => {
          refreshLobbyBtn.innerHTML = originalText;
          refreshLobbyBtn.disabled = false;
        }, 1000);
      }
    });
  }

  // --- STATUS TORNEIO (GLOBAL) ---
  window.updateTournamentStatus = async function () {
    const today = new Date().toLocaleDateString();
    const isCancelled = localStorage.getItem(`tournament_cancelled_${today}`);
    if (isCancelled === "true") {
      const body = document.querySelector(".tournament-body");
      if (body) {
        // Verifica se existe um horário até quando o cancelamento vigora
        const untilIso = localStorage.getItem("tournament_cancelled_until");
        let untilText = "";
        let untilDate = null;
        try {
          if (untilIso) {
            untilDate = new Date(untilIso);
            const hh = String(untilDate.getHours()).padStart(2, "0");
            const mm = String(untilDate.getMinutes()).padStart(2, "0");
            untilText = `Reabre automaticamente às ${hh}:${mm}`;
          } else {
            untilText = "Reabertura automática às 01:00";
          }
        } catch (e) {
          untilText = "Reabertura automática às 01:00";
        }

        body.innerHTML = `
          <div class="cancelled-status"><i class="fa-solid fa-ban"></i>
            <p style="font-weight:800;">TORNEIO CANCELADO</p>
            <small>Motivo: Insuficiência de jogadores</small>
            <div style="margin-top:8px; color:#9ae6b4; font-weight:bold;">${untilText}</div>
          </div>`;
      }

      // Desabilita botão de inscrição até o horário
      try {
        const joinBtn = document.getElementById("join-tournament-btn");
        if (joinBtn) {
          joinBtn.disabled = true;
          joinBtn.textContent = "Torneio cancelado";
        }
      } catch (e) {}

      stopTournamentTimer();

      // Se houver uma data de reabertura, agenda limpeza quando passar
      try {
        const untilIso = localStorage.getItem("tournament_cancelled_until");
        if (untilIso) {
          const until = new Date(untilIso);
          const now = new Date();
          if (now >= until) {
            // passou do horário: limpa flags e atualiza
            localStorage.removeItem(`tournament_cancelled_${today}`);
            localStorage.removeItem("tournament_cancelled_until");
            // chama atualização para reabrir inscrições
            return window.updateTournamentStatus();
          }

          // agenda verificação para quando atingir o horário (usando setTimeout)
          const ms = until.getTime() - now.getTime();
          if (ms > 0) {
            setTimeout(() => {
              try {
                localStorage.removeItem(`tournament_cancelled_${today}`);
                localStorage.removeItem("tournament_cancelled_until");
                if (window.updateTournamentStatus)
                  window.updateTournamentStatus();
              } catch (e) {}
            }, ms + 1000);
          }
        }
      } catch (e) {}

      return;
    }

    const savedResult = localStorage.getItem(`tournament_result_${today}`);
    if (savedResult) {
      const res = JSON.parse(savedResult);
      const body = document.querySelector(".tournament-body");
      if (body) {
        const wName = res.winner ? res.winner.split("@")[0] : "???";
        const rName = res.runnerUp ? res.runnerUp.split("@")[0] : "???";
        body.innerHTML = `
                <div class="podium-container">
                    <div class="podium-winner"><i class="fa-solid fa-trophy"></i><h3>CAMPEÃO</h3><p>${wName}</p><span class="prize">+R$ ${res.championPrize.toFixed(
          2
        )}</span></div>
                    <div class="podium-runnerup"><i class="fa-solid fa-medal"></i><h4>Vice-Campeão</h4><p>${rName}</p><span class="prize">+R$ ${res.runnerUpPrize.toFixed(
          2
        )}</span></div>
                </div>`;
      }
      stopTournamentTimer();
      return;
    }

    try {
      let url = "/api/tournament/status";
      if (window.currentUser) url += `?email=${window.currentUser.email}`;
      const res = await fetch(url);
      const data = await res.json();

      const countEl = document.getElementById("trn-participants-count");
      const prizeEl = document.getElementById("trn-prize-pool");
      const joinBtn = document.getElementById("join-tournament-btn");
      const leaveBtn = document.getElementById("leave-tournament-btn");

      if (countEl)
        countEl.innerHTML = `Inscritos: ${data.participantsCount} <span style="font-size:0.8em; opacity:0.7;">(Mín. 4)</span>`;
      if (prizeEl)
        prizeEl.innerHTML = `Prêmio: R$ ${data.prizePool.toFixed(
          2
        )} <span style="font-size:0.8em; opacity:0.7;">(Entrada: R$ ${data.entryFee.toFixed(
          2
        )})</span>`;

      // Remove textos antigos de taxa se existirem
      const taxTexts = document.querySelectorAll(
        ".tournament-body p, .tournament-body small, .tournament-body span"
      );
      taxTexts.forEach((el) => {
        if (
          el !== prizeEl &&
          el !== countEl &&
          (el.textContent.toLowerCase().includes("taxa") ||
            el.textContent.toLowerCase().includes("manutenção"))
        ) {
          el.style.display = "none";
        }
      });

      const body = document.querySelector(".tournament-body");
      if (body && !document.getElementById("trn-info-display")) {
        const info = document.createElement("div");
        info.id = "trn-info-display";
        info.style.cssText =
          "text-align: center; margin-bottom: 10px; color: #f1c40f; font-weight: bold;";
        info.innerHTML = `<i class="fa-regular fa-clock"></i> Início às 21:00 BRT`;
        body.insertBefore(info, body.firstChild);
      }

      if (joinBtn && leaveBtn) {
        if (data.status === "open") {
          if (data.isRegistered) {
            joinBtn.classList.add("hidden");
            leaveBtn.classList.remove("hidden");
            startTournamentTimer();
          } else {
            joinBtn.classList.remove("hidden");
            leaveBtn.classList.add("hidden");
            joinBtn.textContent = `Entrar (R$ ${data.entryFee.toFixed(2)})`;
            joinBtn.disabled = false;
            stopTournamentTimer();
          }
        } else {
          joinBtn.textContent = "Inscrições Fechadas";
          joinBtn.classList.remove("hidden");
          leaveBtn.classList.add("hidden");
          joinBtn.disabled = true;
          stopTournamentTimer();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // --- BOTÕES DE TORNEIO ---
  const joinTournamentBtn = document.getElementById("join-tournament-btn");
  if (joinTournamentBtn) {
    joinTournamentBtn.addEventListener("click", async () => {
      if (!window.currentUser) return alert("Faça login.");
      if (!window.currentUser.username) {
        if (window.enforceUsernameRequirement)
          window.enforceUsernameRequirement();
        return;
      }

      try {
        const res = await fetch("/api/tournament/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: window.currentUser.email }),
        });
        const data = await res.json();
        if (res.ok) {
          window.currentUser.saldo = data.newSaldo;
          window.updateLobbyWelcome();
          window.updateTournamentStatus();
          alert("Inscrito com sucesso!");
        } else {
          alert(data.message);
        }
      } catch (e) {
        alert("Erro de conexão");
      }
    });
  }

  const leaveTournamentBtn = document.getElementById("leave-tournament-btn");
  if (leaveTournamentBtn) {
    leaveTournamentBtn.addEventListener("click", async () => {
      if (!window.currentUser) return;
      if (!confirm("Sair do torneio e receber reembolso?")) return;
      try {
        const res = await fetch("/api/tournament/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: window.currentUser.email }),
        });
        const data = await res.json();
        if (res.ok) {
          window.currentUser.saldo = data.newSaldo;
          window.updateLobbyWelcome();
          window.updateTournamentStatus();
        } else {
          alert(data.message);
        }
      } catch (e) {
        alert("Erro ao sair");
      }
    });
  }

  // --- SOCKET LISTENERS ---
  socket.on("roomCreated", (data) => {
    document.getElementById("room-code-display").textContent = data.roomCode;
    document.getElementById("waiting-area").classList.remove("hidden");
    const section = document.getElementById("create-room-section");
    section.classList.remove("visible-animated");
    section.classList.add("hidden-animated");
    setTimeout(() => section.classList.add("hidden"), 300);
    const btn = document.getElementById("create-room-btn");
    btn.disabled = false;
    btn.textContent = "INICIAR SALA";
  });
  socket.on("roomCancelled", () => {
    document.getElementById("waiting-area").classList.add("hidden");
    document.getElementById("create-room-btn").disabled = false;
  });
  socket.on("updateLobby", (data) => {
    UI.renderOpenRooms(data.waiting);
    UI.renderActiveRooms(data.active);
  });
  socket.on("tournamentUpdate", (data) => {
    const today = new Date().toLocaleDateString();
    if (
      localStorage.getItem(`tournament_cancelled_${today}`) ||
      localStorage.getItem(`tournament_result_${today}`)
    )
      return;
    const countEl = document.getElementById("trn-participants-count");
    if (countEl) countEl.textContent = `Inscritos: ${data.participantsCount}`;
    const prizeEl = document.getElementById("trn-prize-pool");
    if (prizeEl)
      prizeEl.textContent = `Prêmio: R$ ${data.prizePool.toFixed(2)}`;
  });
  // Tocar som quando outro jogador entra na sua sala (será emitido apenas para o criador)
  socket.on("playerJoined", (data) => {
    try {
      if (!data) return;
      // Segurança: não tocar se o evento for referente ao próprio usuário
      if (window.currentUser && data.email === window.currentUser.email) return;
      if (window.UI && window.UI.playAudio) window.UI.playAudio("join");
    } catch (e) {}
  });
  socket.on("joinError", (data) => {
    alert(data.message);
    document.getElementById("waiting-area").classList.add("hidden");
    document.getElementById("create-room-btn").disabled = false;
  });
  socket.on("confirmBet", (data) => {
    document.getElementById(
      "confirm-bet-amount"
    ).textContent = `R$ ${data.bet.toFixed(2)}`;
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
  document.getElementById("accept-bet-btn").addEventListener("click", () => {
    if (tempRoomCode && window.currentUser) {
      window.isSpectator = false;
      socket.emit("acceptBet", {
        roomCode: tempRoomCode,
        user: window.currentUser,
      });
      document.getElementById("confirm-bet-overlay").classList.add("hidden");
    }
  });
  document.getElementById("decline-bet-btn").addEventListener("click", () => {
    document.getElementById("confirm-bet-overlay").classList.add("hidden");
    tempRoomCode = null;
  });
  socket.on("updateSaldo", (d) => {
    if (window.currentUser) {
      window.currentUser.saldo = d.newSaldo;
      window.updateLobbyWelcome();
    }
  });
  // Adicionado listener para desempate do torneio
  socket.on("tournamentTieBreak", (d) => {
    if (d.winner === null) {
      return;
    }
    if (d.winner === window.currentUser?.email) {
      alert(`🎉 PARABÉNS!\n\n${d.reason}`);
    } else {
      alert(`😢 QUE PENA!\n\n${d.reason}`);
    }
  });

  // --- SISTEMA FINANCEIRO (PIX/SAQUE) ---
  const addBalanceBtn = document.getElementById("add-balance-btn");
  if (addBalanceBtn)
    addBalanceBtn.addEventListener("click", () =>
      document.getElementById("pix-overlay").classList.remove("hidden")
    );
  document
    .getElementById("close-pix-overlay-btn")
    .addEventListener("click", () => {
      document.getElementById("pix-overlay").classList.add("hidden");
      document.getElementById("mp-loading").classList.add("hidden");
      document.getElementById("qr-code-container").classList.add("hidden");
      const payBtn = document.getElementById("pay-mercadopago-btn");
      if (payBtn) payBtn.disabled = false;
      if (paymentCheckInterval) {
        clearInterval(paymentCheckInterval);
        paymentCheckInterval = null;
      }
    });
  const payBtn = document.getElementById("pay-mercadopago-btn");
  if (payBtn) {
    payBtn.addEventListener("click", async () => {
      if (!window.currentUser) return;
      const amount = parseFloat(
        document.getElementById("deposit-amount").value
      );
      if (!amount || amount < 1) return alert("Mínimo R$ 1,00");
      payBtn.disabled = true;
      document.getElementById("mp-loading").classList.remove("hidden");
      try {
        const res = await fetch("/api/payment/create_preference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, email: window.currentUser.email }),
        });
        const data = await res.json();
        document.getElementById("mp-loading").classList.add("hidden");
        if (data.qr_code) {
          document
            .getElementById("qr-code-container")
            .classList.remove("hidden");
          document.getElementById(
            "qr-code-img"
          ).src = `data:image/png;base64,${data.qr_code_base64}`;
          document.getElementById("pix-copy-paste").value = data.qr_code;
          const initialSaldo = window.currentUser.saldo;
          paymentCheckInterval = setInterval(async () => {
            try {
              const checkRes = await fetch("/api/user/re-authenticate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: window.currentUser.email }),
              });
              const checkData = await checkRes.json();
              if (checkData.user.saldo > initialSaldo) {
                window.currentUser.saldo = checkData.user.saldo;
                window.updateLobbyWelcome();
                alert("Pagamento Recebido!");
                clearInterval(paymentCheckInterval);
                document.getElementById("pix-overlay").classList.add("hidden");
              }
            } catch (e) {}
          }, 5000);
        }
      } catch (e) {
        alert("Erro ao gerar PIX");
        payBtn.disabled = false;
        document.getElementById("mp-loading").classList.add("hidden");
      }
    });
  }
  document.getElementById("copy-pix-code-btn").addEventListener("click", () => {
    const copyText = document.getElementById("pix-copy-paste");
    copyText.select();
    document.execCommand("copy");
    alert("Código copiado!");
  });
  const withdrawBtn = document.getElementById("withdraw-btn");
  if (withdrawBtn)
    withdrawBtn.addEventListener("click", () =>
      document.getElementById("withdraw-overlay").classList.remove("hidden")
    );
  document
    .getElementById("close-withdraw-overlay-btn")
    .addEventListener("click", () =>
      document.getElementById("withdraw-overlay").classList.add("hidden")
    );
  document
    .getElementById("withdraw-form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const pixKey = document.getElementById("withdraw-pix-key").value;
      const amount = parseFloat(
        document.getElementById("withdraw-amount").value
      );
      // Mínimo de saque agora R$10
      if (!pixKey || amount < 10) return alert("Valor inválido. Mínimo R$10.");
      try {
        const res = await fetch("/api/withdraw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: window.currentUser.email,
            amount,
            pixKey,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          alert("Solicitação enviada!");
          document.getElementById("withdraw-overlay").classList.add("hidden");
        } else {
          alert(data.message);
        }
      } catch (e) {
        alert("Erro de conexão");
      }
    });

  // --- OUTROS (TUTORIAL, REFERENCIA, HISTORICO) ---
  const tutorialBtn = document.getElementById("tutorial-btn");
  if (tutorialBtn)
    tutorialBtn.addEventListener("click", () =>
      document
        .getElementById("general-tutorial-overlay")
        .classList.remove("hidden")
    );
  document
    .getElementById("close-tutorial-btn")
    .addEventListener("click", () =>
      document
        .getElementById("general-tutorial-overlay")
        .classList.add("hidden")
    );

  const trnInfoBtn = document.getElementById("tournament-info-btn");
  if (trnInfoBtn)
    trnInfoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const overlay = document.getElementById("tournament-info-overlay");

      const content = overlay.querySelector(".modal-content");
      if (content) {
        content.innerHTML = `
            <span id="close-tournament-info-btn" style="position:absolute; top:10px; right:20px; font-size:2rem; cursor:pointer; color:#fff;">&times;</span>
            <h2 style="color:#f1c40f; margin-bottom:15px; text-align:center;">Regras do Torneio</h2>
            <div style="text-align:left; line-height:1.6; color:#ddd; padding:0 10px;">
                <p><strong>🕒 Início:</strong> 23:59 BRT</p>
                <p><strong>💰 Entrada:</strong> R$ 2,00</p>
                <p><strong>🏆 Premiação:</strong> 100% distribuído (Sem taxas!)</p>
                <ul style="margin-left:20px; margin-bottom:10px;">
                    <li>🥇 Campeão: 70%</li>
                    <li>🥈 Vice: 30%</li>
                </ul>
                <p><strong>🚫 Taxa Administrativa:</strong> 0% (Isento)</p>
                <p><strong>⚔️ Formato:</strong> Mata-mata (7s por jogada)</p>
                <div style="background: rgba(255, 255, 255, 0.05); padding: 10px; border-radius: 6px; border-left: 3px solid #f1c40f; margin-top: 10px;">
                    <h4 style="color: #f1c40f; margin-bottom: 5px; font-size: 0.9rem;">🤝 Critérios de Desempate</h4>
                    <p style="font-size: 0.85rem;">Se a partida terminar empatada:</p>
                    <ol style="margin-left: 20px; font-size: 0.85rem; margin-bottom: 0;">
                        <li><strong>Contagem de Peças:</strong> Vence quem tiver mais peças.</li>
                        <li><strong>Sorteio Automático:</strong> Se as peças forem iguais, o sistema decide na sorte (50/50).</li>
                    </ol>
                </div>
            </div>
        `;
        const closeBtn = content.querySelector("#close-tournament-info-btn");
        if (closeBtn) closeBtn.onclick = () => overlay.classList.add("hidden");
      }
      overlay.classList.remove("hidden");
    });
  document
    .getElementById("close-tournament-info-btn")
    .addEventListener("click", () =>
      document.getElementById("tournament-info-overlay").classList.add("hidden")
    );

  const copyReferralBtn = document.getElementById("copy-referral-btn");
  if (copyReferralBtn)
    copyReferralBtn.addEventListener("click", () => {
      if (!window.currentUser) return;
      const encodedRef = btoa(window.currentUser.email);
      const link = `${window.location.origin}/?ref=${encodeURIComponent(
        encodedRef
      )}`;
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard
          .writeText(link)
          .then(() => {
            const originalText = copyReferralBtn.innerHTML;
            copyReferralBtn.innerHTML =
              '<i class="fa-solid fa-check"></i> Copiado!';
            setTimeout(() => (copyReferralBtn.innerHTML = originalText), 2000);
          })
          .catch(() => fallbackCopyTextToClipboard(link));
      } else {
        fallbackCopyTextToClipboard(link);
      }
    });
  function fallbackCopyTextToClipboard(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
      alert("Link copiado para a área de transferência!");
    } catch (err) {
      alert("Não foi possível copiar o link.");
    }
    document.body.removeChild(textArea);
  }
  const viewRefBtn = document.getElementById("view-referrals-btn");
  if (viewRefBtn)
    viewRefBtn.addEventListener("click", async () => {
      if (!window.currentUser) return;
      const list = document.getElementById("referrals-list");
      document.getElementById("referrals-overlay").classList.remove("hidden");
      list.innerHTML = '<p style="color:#ccc;">Carregando...</p>';
      try {
        const response = await fetch("/api/user/referrals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: window.currentUser.email }),
        });
        const referrals = await response.json();
        list.innerHTML = "";
        if (referrals.length === 0) {
          list.innerHTML = "<p>Você ainda não tem indicações.</p>";
        } else {
          const ul = document.createElement("ul");
          ul.style.listStyle = "none";
          ul.style.padding = "0";
          referrals.forEach((ref) => {
            const li = document.createElement("li");
            li.style.background = "rgba(255,255,255,0.05)";
            li.style.marginBottom = "8px";
            li.style.padding = "10px";
            li.style.borderRadius = "8px";
            li.style.display = "flex";
            li.style.justifyContent = "space-between";
            li.style.alignItems = "center";
            let statusHtml = "";
            if (ref.hasDeposited) {
              const val = ref.firstDepositValue || 0;
              statusHtml =
                val >= 5
                  ? `<span style="color: #2ecc71; font-weight:bold; font-size:0.8rem;">+R$ 1,00 (Dep. R$${val})</span>`
                  : `<span style="color: #f39c12; font-size:0.8rem;">Dep. R$${val} (Sem bônus)</span>`;
            } else {
              statusHtml =
                '<span style="color: #95a5a6; font-size:0.8rem;">Pendente</span>';
            }
            li.innerHTML = `<span style="font-weight:600; font-size:0.9rem;">${
              ref.email.split("@")[0]
            }...</span>${statusHtml}`;
            ul.appendChild(li);
          });
          // expose helper to prepend future entries
          window.__historyListElement = ul;
          list.appendChild(ul);
        }
      } catch (e) {
        list.innerHTML = "<p style='color: #e74c3c;'>Erro ao carregar.</p>";
      }
    });

  // Listen for immediate history events from server and update UI if relevant
  try {
    socket.on("matchRecorded", (m) => {
      try {
        // Always keep a small recent buffer so events that arrive before
        // the page has currentUser set are not lost. Buffer is per-client
        // (in-memory) and will be merged into the history view when opened.
        try {
          window.__recentHistoryBuffer = window.__recentHistoryBuffer || [];
          window.__recentHistoryBuffer.unshift(m);
          if (window.__recentHistoryBuffer.length > 50)
            window.__recentHistoryBuffer.pop();
        } catch (e) {}

        const currentEmail =
          window.currentUser && window.currentUser.email
            ? (window.currentUser.email || "").toLowerCase()
            : null;
        const p1 = (m.player1 || "").toLowerCase();
        const p2 = (m.player2 || "").toLowerCase();
        if (currentEmail && p1 !== currentEmail && p2 !== currentEmail) return;

        // Create li similar to the history rendering above
        const li = document.createElement("li");
        li.style.background = "rgba(255,255,255,0.05)";
        li.style.marginBottom = "8px";
        li.style.padding = "10px";
        li.style.borderRadius = "8px";
        li.style.fontSize = "0.9rem";
        let resultText = "Empate";
        let color = "#95a5a6";
        if (m.winner) {
          if (m.winner === email) {
            resultText = "VITÓRIA";
            color = "#2ecc71";
          } else {
            resultText = "DERROTA";
            color = "#e74c3c";
          }
        }
        const opponent =
          (m.player1 || "").toLowerCase() === email ? m.player2 : m.player1;
        const date = new Date(m.createdAt).toLocaleDateString();
        li.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong style="color:${color}">${resultText}</strong><span style="color:#aaa; font-size:0.8rem;">${date}</span></div><div style="display:flex; justify-content:space-between;"><span>vs ${
          opponent.split("@")[0]
        }</span><span>Aposta: <strong>R$ ${Number(m.bet || 0).toFixed(
          2
        )}</strong></span></div>`;

        // If history overlay is open and list present, prepend; otherwise show small toast
        const overlay = document.getElementById("history-overlay");
        const listEl = document.getElementById("history-list");
        if (
          overlay &&
          !overlay.classList.contains("hidden") &&
          window.__historyListElement
        ) {
          // prepend to displayed list
          window.__historyListElement.insertBefore(
            li,
            window.__historyListElement.firstChild
          );
        } else if (listEl) {
          // keep recent entry for when user opens history: store in a small buffer
          // (already buffered above)
          // show a brief notification
          try {
            const n = document.createElement("div");
            n.style.position = "fixed";
            n.style.bottom = "20px";
            n.style.left = "50%";
            n.style.transform = "translateX(-50%)";
            n.style.background = "rgba(0,0,0,0.8)";
            n.style.color = "#fff";
            n.style.padding = "8px 12px";
            n.style.borderRadius = "6px";
            n.style.zIndex = 99999;
            n.textContent = "Partida registrada — ver Histórico";
            document.body.appendChild(n);
            setTimeout(() => n.remove(), 3000);
          } catch (e) {}
        }
      } catch (e) {}
    });
  } catch (e) {}
  const closeRefBtn = document.getElementById("close-referrals-overlay-btn");
  if (closeRefBtn)
    closeRefBtn.addEventListener("click", () =>
      document.getElementById("referrals-overlay").classList.add("hidden")
    );
  const viewHistoryBtn = document.getElementById("view-history-btn");
  console.log("[initLobby] viewHistoryBtn found:", !!viewHistoryBtn);
  if (viewHistoryBtn)
    viewHistoryBtn.addEventListener("click", async () => {
      console.log(
        "[history] viewHistory clicked; currentUser:",
        window.currentUser && window.currentUser.email
      );
      if (!window.currentUser) return;
      const list = document.getElementById("history-list");
      document.getElementById("history-overlay").classList.remove("hidden");
      list.innerHTML = '<p style="color:#ccc;">Carregando...</p>';
      try {
        console.log("[history] auto POST /api/user/history body:", {
          email: window.currentUser && window.currentUser.email,
        });
        const res = await fetch("/api/user/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: window.currentUser && window.currentUser.email,
          }),
        });
        const data = await res.json();
        list.innerHTML = "";
        if (data.length === 0) {
          list.innerHTML = "<p>Sem partidas recentes.</p>";
          // Offer to show recent public matches
          try {
            const btn = document.createElement("button");
            btn.textContent = "Ver partidas públicas recentes";
            btn.style.marginTop = "8px";
            btn.addEventListener("click", async () => {
              try {
                btn.disabled = true;
                btn.textContent = "Carregando...";
                const resp = await fetch(`/api/recent-matches?limit=50`);
                const pubRaw = await resp.json();
                const target =
                  window.currentUser && window.currentUser.email
                    ? window.currentUser.email.toLowerCase()
                    : "";
                const pub = Array.isArray(pubRaw)
                  ? pubRaw.filter((m) => {
                      const p1 = (m.player1 || "").toLowerCase();
                      const p2 = (m.player2 || "").toLowerCase();
                      return p1 === target || p2 === target;
                    })
                  : [];
                list.innerHTML = "";
                if (!pub || pub.length === 0) {
                  list.innerHTML = "<p>Nenhuma partida pública recente.</p>";
                } else {
                  const ul2 = document.createElement("ul");
                  ul2.style.listStyle = "none";
                  ul2.style.padding = "0";
                  pub.forEach((m) => {
                    try {
                      const li = document.createElement("li");
                      li.style.background = "rgba(255,255,255,0.05)";
                      li.style.marginBottom = "8px";
                      li.style.padding = "10px";
                      li.style.borderRadius = "8px";
                      li.style.fontSize = "0.9rem";
                      let resultText = "Empate";
                      let color = "#95a5a6";
                      if (m.winner) {
                        // mark if current user participated
                        if (
                          window.currentUser &&
                          m.winner === window.currentUser.email
                        ) {
                          resultText = "VITÓRIA";
                          color = "#2ecc71";
                        } else {
                          resultText = "DERROTA";
                          color = "#e74c3c";
                        }
                      }
                      const opponent = window.currentUser
                        ? m.player1 === window.currentUser.email
                          ? m.player2
                          : m.player1
                        : m.player1 + " / " + m.player2;
                      const date = new Date(m.createdAt).toLocaleDateString();
                      li.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong style="color:${color}">${resultText}</strong><span style="color:#aaa; font-size:0.8rem;">${date}</span></div><div style="display:flex; justify-content:space-between;"><span>vs ${
                        opponent.split("@")[0]
                      }</span><span>Aposta: <strong>R$ ${Number(
                        m.bet || 0
                      ).toFixed(2)}</strong></span></div>`;
                      ul2.appendChild(li);
                    } catch (e) {}
                  });
                  list.appendChild(ul2);
                }
              } catch (e) {
                list.innerHTML = "<p>Erro ao carregar públicas.</p>";
              }
            });
            list.appendChild(btn);
          } catch (e) {}
          return;
        }
        const ul = document.createElement("ul");
        ul.style.listStyle = "none";
        ul.style.padding = "0";
        // Build a signature set to avoid duplicates when merging recent buffer
        const sigSet = new Set();
        data.forEach((m) => {
          try {
            const sig = `${m.player1}|${m.player2}|${m.winner}|${new Date(
              m.createdAt
            ).getTime()}`;
            sigSet.add(sig);
          } catch (e) {}
          const li = document.createElement("li");
          li.style.background = "rgba(255,255,255,0.05)";
          li.style.marginBottom = "8px";
          li.style.padding = "10px";
          li.style.borderRadius = "8px";
          li.style.fontSize = "0.9rem";
          let resultText = "Empate";
          let color = "#95a5a6";
          if (m.winner) {
            if (m.winner === window.currentUser.email) {
              resultText = "VITÓRIA";
              color = "#2ecc71";
            } else {
              resultText = "DERROTA";
              color = "#e74c3c";
            }
          }
          const opponent =
            m.player1 === window.currentUser.email ? m.player2 : m.player1;
          const date = new Date(m.createdAt).toLocaleDateString();
          li.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong style="color:${color}">${resultText}</strong><span style="color:#aaa; font-size:0.8rem;">${date}</span></div><div style="display:flex; justify-content:space-between;"><span>vs ${
            opponent.split("@")[0]
          }</span><span>Aposta: <strong>R$ ${m.bet.toFixed(
            2
          )}</strong></span></div>`;
          ul.appendChild(li);
        });

        // Merge recent in-memory buffer (if any) and prepend unique entries
        try {
          if (
            window.__recentHistoryBuffer &&
            Array.isArray(window.__recentHistoryBuffer)
          ) {
            const buf = window.__recentHistoryBuffer.slice();
            buf.reverse(); // older first so we prepend newest on top
            buf.forEach((m) => {
              try {
                const sig = `${m.player1}|${m.player2}|${m.winner}|${new Date(
                  m.createdAt
                ).getTime()}`;
                if (sigSet.has(sig)) return;
                // create li same as above
                const li = document.createElement("li");
                li.style.background = "rgba(255,255,255,0.05)";
                li.style.marginBottom = "8px";
                li.style.padding = "10px";
                li.style.borderRadius = "8px";
                li.style.fontSize = "0.9rem";
                let resultText = "Empate";
                let color = "#95a5a6";
                if (m.winner) {
                  if (m.winner === window.currentUser.email) {
                    resultText = "VITÓRIA";
                    color = "#2ecc71";
                  } else {
                    resultText = "DERROTA";
                    color = "#e74c3c";
                  }
                }
                const opponent =
                  m.player1 === window.currentUser.email
                    ? m.player2
                    : m.player1;
                const date = new Date(m.createdAt).toLocaleDateString();
                li.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><strong style="color:${color}">${resultText}</strong><span style="color:#aaa; font-size:0.8rem;">${date}</span></div><div style="display:flex; justify-content:space-between;"><span>vs ${
                  opponent.split("@")[0]
                }</span><span>Aposta: <strong>R$ ${Number(m.bet || 0).toFixed(
                  2
                )}</strong></span></div>`;
                ul.insertBefore(li, ul.firstChild);
                sigSet.add(sig);
              } catch (e) {}
            });
            // Clear buffer after merging
            window.__recentHistoryBuffer = [];
          }
        } catch (e) {}
        list.appendChild(ul);
      } catch (e) {
        list.innerHTML =
          "<p style='color: #e74c3c;'>Erro ao carregar histórico.</p>";
      }
    });
  const closeHistBtn = document.getElementById("close-history-overlay-btn");
  if (closeHistBtn)
    closeHistBtn.addEventListener("click", () =>
      document.getElementById("history-overlay").classList.add("hidden")
    );

  // Botão de limpar histórico foi removido — histórico agora é limitado/limpo automaticamente a cada 24h

  // Adicionando a função createVisualPrefsUI para evitar erros de referência
  function createVisualPrefsUI() {
    // Cria a UI do modal (apenas uma vez)
    const overlay = document.getElementById("visual-prefs-overlay");
    if (!overlay) return;
    try {
      const pieceStyleEl = document.getElementById("prefs-piece-style");
      const whiteEl = document.getElementById("prefs-piece-white");
      const blackEl = document.getElementById("prefs-piece-black");
      const preview = document.getElementById("prefs-preview-board");
      const saveBtn = document.getElementById("prefs-save-btn");
      const cancelBtn = document.getElementById("prefs-cancel-btn");

      const prefs = window.userPreferences || {};
      if (pieceStyleEl && prefs.pieceStyle)
        pieceStyleEl.value = prefs.pieceStyle;
      if (whiteEl && prefs.pieceWhite) whiteEl.value = prefs.pieceWhite;
      if (blackEl && prefs.pieceBlack) blackEl.value = prefs.pieceBlack;

      const resetBtn = document.getElementById("prefs-reset-btn");

      // Atualiza preview sempre que mudar
      const updatePreview = () => {
        const now = {
          pieceWhite: whiteEl ? whiteEl.value : prefs.pieceWhite || "#ffffff",
          pieceBlack: blackEl ? blackEl.value : prefs.pieceBlack || "#222222",
          pieceStyle: pieceStyleEl
            ? pieceStyleEl.value
            : prefs.pieceStyle || "default",
        };
        window.UI.applyPreferences({
          pieceWhite: now.pieceWhite,
          pieceBlack: now.pieceBlack,
        });
        if (preview && window.UI && window.UI.renderBoardInto) {
          try {
            preview.style.setProperty("--white-piece-color-1", now.pieceWhite);
            preview.style.setProperty("--black-piece-color-1", now.pieceBlack);
            preview.dataset.pieceStyle = now.pieceStyle;
            const sample = makeEmptyBoard(
              parseInt(preview.dataset.size || 8, 10)
            );
            window.UI.renderBoardInto(
              preview,
              sample,
              parseInt(preview.dataset.size || 8, 10)
            );
            preview
              .querySelectorAll(".light, .dark")
              .forEach((sq) => (sq.style.backgroundImage = "none"));
          } catch (e) {}
        }
      };

      if (pieceStyleEl) pieceStyleEl.addEventListener("change", updatePreview);
      if (whiteEl) whiteEl.addEventListener("input", updatePreview);
      if (blackEl) blackEl.addEventListener("input", updatePreview);

      if (saveBtn) {
        saveBtn.onclick = async () => {
          // Build new prefs but avoid carrying over board colors when
          // user only changed piece visuals (prevents board color flip).
          const newPrefs = Object.assign({}, window.userPreferences || {});
          // remove board-specific colors so they are not reapplied unintentionally
          try {
            delete newPrefs.boardLight;
            delete newPrefs.boardDark;
          } catch (e) {}
          if (pieceStyleEl) newPrefs.pieceStyle = pieceStyleEl.value;
          if (whiteEl) newPrefs.pieceWhite = whiteEl.value;
          if (blackEl) newPrefs.pieceBlack = blackEl.value;
          window.userPreferences = newPrefs;
          try {
            const key = `prefs_${window.currentUser?.email || "anon"}`;
            localStorage.setItem(key, JSON.stringify(newPrefs));
            try {
              localStorage.setItem("prefs_last", JSON.stringify(newPrefs));
            } catch (e) {}
          } catch (e) {}
          if (window.UI && window.UI.applyPreferences)
            window.UI.applyPreferences(newPrefs);
          try {
            if (newPrefs.pieceWhite)
              document.documentElement.style.setProperty(
                "--white-piece-color-1",
                newPrefs.pieceWhite
              );
            if (newPrefs.pieceBlack)
              document.documentElement.style.setProperty(
                "--black-piece-color-1",
                newPrefs.pieceBlack
              );
          } catch (e) {}
          overlay.classList.add("hidden");
        };
      }
      if (cancelBtn) cancelBtn.onclick = () => overlay.classList.add("hidden");

      if (resetBtn) {
        resetBtn.onclick = () => {
          try {
            // Clear stored prefs for this user (or anon)
            const key = `prefs_${window.currentUser?.email || "anon"}`;
            try {
              localStorage.removeItem(key);
            } catch (e) {}
            try {
              localStorage.setItem("prefs_last", JSON.stringify({}));
            } catch (e) {}
            // Clear runtime prefs
            window.userPreferences = {};
            // Apply defaults via UI helper
            if (window.UI && window.UI.applyPreferences)
              window.UI.applyPreferences({ resetToDefaults: true });
            // Reset controls to defaults
            if (pieceStyleEl) pieceStyleEl.value = "default";
            if (whiteEl) whiteEl.value = "#ffffff";
            if (blackEl) blackEl.value = "#2e2e2e";
            // Update preview
            setTimeout(() => {
              try {
                if (preview && window.UI && window.UI.renderBoardInto) {
                  preview.dataset.pieceStyle = "default";
                  preview
                    .querySelectorAll(".light, .dark")
                    .forEach((sq) => (sq.style.backgroundImage = ""));
                  const sample = makeEmptyBoard(
                    parseInt(preview.dataset.size || 8, 10)
                  );
                  window.UI.renderBoardInto(
                    preview,
                    sample,
                    parseInt(preview.dataset.size || 8, 10)
                  );
                }
              } catch (e) {}
            }, 40);
          } catch (e) {
            console.error("reset prefs error:", e);
          }
        };
      }

      // Inicial preview
      setTimeout(updatePreview, 50);
    } catch (e) {
      console.error("createVisualPrefsUI error:", e);
    }
  }
};
