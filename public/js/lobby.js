// public/js/lobby.js - Gerencia Lobby, Torneios, Salas e Pagamentos

window.initLobby = function (socket, UI) {
  let paymentCheckInterval = null;
  let tempRoomCode = null;
  let tournamentCountdownInterval = null;
  let countdownClosedByUser = false;

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
        }
      }
    }
  };

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

      // NOVA LÓGICA: Checa se é privada
      const isPrivateCheckbox = document.getElementById(
        "private-room-checkbox"
      );
      const isPrivate = isPrivateCheckbox ? isPrivateCheckbox.checked : false;

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
        socket.emit("joinRoomRequest", { roomCode, user: window.currentUser });
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
        body.innerHTML = `<div class="cancelled-status"><i class="fa-solid fa-ban"></i><p>CANCELADO HOJE</p><small>Insuficiência de jogadores</small></div>`;
      }
      stopTournamentTimer();
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
      if (!pixKey || amount < 30) return alert("Valor inválido.");
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
          list.appendChild(ul);
        }
      } catch (e) {
        list.innerHTML = "<p style='color: #e74c3c;'>Erro ao carregar.</p>";
      }
    });
  const closeRefBtn = document.getElementById("close-referrals-overlay-btn");
  if (closeRefBtn)
    closeRefBtn.addEventListener("click", () =>
      document.getElementById("referrals-overlay").classList.add("hidden")
    );
  const viewHistoryBtn = document.getElementById("view-history-btn");
  if (viewHistoryBtn)
    viewHistoryBtn.addEventListener("click", async () => {
      if (!window.currentUser) return;
      const list = document.getElementById("history-list");
      document.getElementById("history-overlay").classList.remove("hidden");
      list.innerHTML = '<p style="color:#ccc;">Carregando...</p>';
      try {
        const res = await fetch("/api/user/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: window.currentUser.email }),
        });
        const data = await res.json();
        list.innerHTML = "";
        if (data.length === 0) {
          list.innerHTML = "<p>Sem partidas recentes.</p>";
          return;
        }
        const ul = document.createElement("ul");
        ul.style.listStyle = "none";
        ul.style.padding = "0";
        data.forEach((m) => {
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
};
