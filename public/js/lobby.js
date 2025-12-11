// public/lobby.js - Gerencia Autenticação, Lobby, Torneios e Modais

window.initLobby = function (socket, UI) {
  // Variáveis locais do Lobby
  let paymentCheckInterval = null;
  let tempRoomCode = null; // Para confirmação de aposta

  // --- AUTENTICAÇÃO ---

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
          window.currentUser = data.user; // Define globalmente
          localStorage.setItem("checkersUserEmail", window.currentUser.email);

          document.getElementById("main-container").classList.add("hidden");
          document.getElementById("lobby-container").classList.remove("hidden");
          updateLobbyWelcome();
          updateTournamentStatus();
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

  // --- LÓGICA DO LOBBY ---

  UI.elements.timeControlSelect.addEventListener("change", () => {
    UI.updateTimerOptions(UI.elements.timeControlSelect.value);
  });
  UI.updateTimerOptions("move");

  document.getElementById("create-room-btn").addEventListener("click", () => {
    const bet = parseInt(UI.elements.betAmountInput.value, 10);
    const gameMode = UI.elements.gameModeSelect.value;
    const timerDuration = UI.elements.timerSelect.value;
    const timeControl = UI.elements.timeControlSelect.value;

    if (bet > 0 && window.currentUser) {
      socket.emit("createRoom", {
        bet,
        user: window.currentUser,
        gameMode,
        timerDuration,
        timeControl,
      });
      if (UI.elements.lobbyErrorMessage)
        UI.elements.lobbyErrorMessage.textContent = "";
      UI.elements.createRoomBtn.disabled = true;
      UI.elements.betAmountInput.disabled = true;
      UI.elements.timerSelectionContainer.style.display = "none";
    } else if (!window.currentUser) {
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
        updateTournamentStatus();
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

  // --- LÓGICA DE TORNEIO ---
  const joinTournamentBtn = document.getElementById("join-tournament-btn");
  const leaveTournamentBtn = document.getElementById("leave-tournament-btn");
  const trnMessage = document.getElementById("trn-message");

  // NOVO: Lógica do botão de Informação do Torneio
  const infoBtn = document.getElementById("tournament-info-btn");
  if (infoBtn) {
    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // Evita que o clique abra/feche o acordeão
      document
        .getElementById("tournament-info-overlay")
        .classList.remove("hidden");
    });
  }
  document
    .getElementById("close-tournament-info-btn")
    .addEventListener("click", () => {
      document
        .getElementById("tournament-info-overlay")
        .classList.add("hidden");
    });

  async function updateTournamentStatus() {
    try {
      let url = "/api/tournament/status";
      if (window.currentUser) {
        url += `?email=${window.currentUser.email}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      const countEl = document.getElementById("trn-participants-count");
      const headerCountEl = document.getElementById(
        "header-participants-count"
      ); // NOVO: Elemento do cabeçalho
      const prizeEl = document.getElementById("trn-prize-pool");

      if (countEl) countEl.textContent = `Inscritos: ${data.participantsCount}`;
      if (headerCountEl)
        headerCountEl.textContent = `(${data.participantsCount})`; // NOVO: Atualiza o cabeçalho

      if (prizeEl)
        prizeEl.textContent = `Prêmio Atual: R$ ${data.prizePool.toFixed(2)}`;

      if (joinTournamentBtn && leaveTournamentBtn) {
        if (data.status === "open") {
          if (data.isRegistered) {
            joinTournamentBtn.classList.add("hidden");
            leaveTournamentBtn.classList.remove("hidden");
            leaveTournamentBtn.disabled = false;
          } else {
            joinTournamentBtn.classList.remove("hidden");
            leaveTournamentBtn.classList.add("hidden");
            joinTournamentBtn.disabled = false;
            joinTournamentBtn.textContent = `Inscrever-se (R$ ${data.entryFee.toFixed(
              2
            )})`;
          }
        } else if (data.status === "active") {
          joinTournamentBtn.classList.remove("hidden");
          leaveTournamentBtn.classList.add("hidden");
          joinTournamentBtn.disabled = true;
          joinTournamentBtn.textContent = "Torneio em Andamento";
        } else {
          joinTournamentBtn.classList.remove("hidden");
          leaveTournamentBtn.classList.add("hidden");
          joinTournamentBtn.disabled = true;
          joinTournamentBtn.textContent = "Inscrições Fechadas";
        }
      }
    } catch (e) {
      console.error("Erro ao atualizar torneio:", e);
    }
  }
  // Exporta para ser usada no script principal se necessário
  window.updateTournamentStatus = updateTournamentStatus;

  if (joinTournamentBtn) {
    joinTournamentBtn.addEventListener("click", async () => {
      if (!window.currentUser) {
        alert("Erro: Você precisa estar logado para se inscrever.");
        return;
      }
      joinTournamentBtn.disabled = true;
      trnMessage.textContent = "Processando inscrição...";
      trnMessage.style.color = "#f39c12";

      try {
        const res = await fetch("/api/tournament/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: window.currentUser.email }),
        });
        const data = await res.json();

        trnMessage.textContent = data.message;
        if (res.ok) {
          trnMessage.style.color = "#2ecc71";
          alert("✅ Inscrição realizada com sucesso! Boa sorte!");
          window.currentUser.saldo = data.newSaldo;
          updateLobbyWelcome();
          updateTournamentStatus();
        } else {
          trnMessage.style.color = "#e74c3c";
          alert("⚠️ " + data.message);
          joinTournamentBtn.disabled = false;
        }
      } catch (e) {
        trnMessage.textContent = "Erro de conexão ao inscrever.";
        trnMessage.style.color = "#e74c3c";
        alert("❌ Erro de conexão ao tentar se inscrever. Tente novamente.");
        joinTournamentBtn.disabled = false;
      }
    });
  }

  if (leaveTournamentBtn) {
    leaveTournamentBtn.addEventListener("click", async () => {
      if (!window.currentUser) return;
      if (
        !confirm("Deseja realmente sair do torneio? O valor será reembolsado.")
      )
        return;

      leaveTournamentBtn.disabled = true;
      trnMessage.textContent = "Processando saída...";
      trnMessage.style.color = "#f39c12";

      try {
        const res = await fetch("/api/tournament/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: window.currentUser.email }),
        });
        const data = await res.json();

        trnMessage.textContent = data.message;
        if (res.ok) {
          trnMessage.style.color = "#2ecc71";
          alert("✅ Inscrição cancelada. Valor reembolsado.");
          window.currentUser.saldo = data.newSaldo;
          updateLobbyWelcome();
          updateTournamentStatus();
        } else {
          trnMessage.style.color = "#e74c3c";
          alert("⚠️ " + data.message);
          leaveTournamentBtn.disabled = false;
        }
      } catch (e) {
        trnMessage.textContent = "Erro ao sair.";
        leaveTournamentBtn.disabled = false;
      }
    });
  }

  // --- MODAIS (Histórico, PIX, Saque, Indicações) ---

  const setupModalLogic = () => {
    // Histórico
    const viewHistoryBtn = document.getElementById("view-history-btn");
    if (viewHistoryBtn) {
      viewHistoryBtn.addEventListener("click", async () => {
        if (!window.currentUser) return;
        document.getElementById("history-overlay").classList.remove("hidden");
        const list = document.getElementById("history-list");
        list.innerHTML = "<p>Carregando...</p>";
        try {
          const res = await fetch("/api/user/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: window.currentUser.email }),
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
              : m.winner === window.currentUser.email
              ? "Vitória"
              : "Derrota";
            let resClass = !m.winner
              ? "history-draw"
              : m.winner === window.currentUser.email
              ? "history-win"
              : "history-loss";
            const opp =
              m.player1 === window.currentUser.email ? m.player2 : m.player1;
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

    // PIX / Adicionar Saldo
    const addBalanceBtn = document.getElementById("add-balance-btn");
    if (addBalanceBtn) {
      addBalanceBtn.addEventListener("click", () => {
        document.getElementById("pix-overlay").classList.remove("hidden");
      });
    }

    // Botão Fechar Modal de PIX
    document
      .getElementById("close-pix-overlay-btn")
      .addEventListener("click", () => {
        document.getElementById("pix-overlay").classList.add("hidden");
        document.getElementById("mp-loading").classList.add("hidden");
        document.getElementById("qr-code-container").classList.add("hidden"); // Oculta QR se estiver aberto

        const payBtn = document.getElementById("pay-mercadopago-btn");
        if (payBtn) payBtn.disabled = false;

        if (paymentCheckInterval) {
          clearInterval(paymentCheckInterval);
          paymentCheckInterval = null;
        }
      });

    // Copiar código PIX
    document
      .getElementById("copy-pix-code-btn")
      .addEventListener("click", () => {
        const copyText = document.getElementById("pix-copy-paste");
        copyText.select();
        copyText.setSelectionRange(0, 99999);
        document.execCommand("copy");
        alert("Código PIX copiado!");
      });

    const payBtn = document.getElementById("pay-mercadopago-btn");
    const loadingDiv = document.getElementById("mp-loading");
    const qrContainer = document.getElementById("qr-code-container");
    const qrImg = document.getElementById("qr-code-img");
    const qrText = document.getElementById("pix-copy-paste");

    if (payBtn) {
      payBtn.addEventListener("click", async () => {
        if (!window.currentUser) return;
        const amountInput = document.getElementById("deposit-amount");
        const amount = parseFloat(amountInput.value);

        if (!amount || amount < 1) {
          alert("Valor mínimo de R$ 1,00");
          return;
        }

        // AVISO DE TAXA
        const totalToPay = (amount * 1.01).toFixed(2);
        if (
          !confirm(
            `Será adicionada uma taxa de 1% (tarifa PIX). \n\nValor a receber (Créditos): R$ ${amount.toFixed(
              2
            )}\nValor a pagar no PIX: R$ ${totalToPay}\n\nDeseja continuar?`
          )
        ) {
          return;
        }

        payBtn.disabled = true;
        loadingDiv.classList.remove("hidden");
        qrContainer.classList.add("hidden"); // Garante que começa escondido

        try {
          const response = await fetch("/api/payment/create_preference", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: amount,
              email: window.currentUser.email,
            }),
          });

          const data = await response.json();

          if (data.qr_code_base64 && data.qr_code) {
            // Sucesso! Mostra o QR Code
            loadingDiv.classList.add("hidden");
            qrContainer.classList.remove("hidden");

            qrImg.src = `data:image/png;base64,${data.qr_code_base64}`;
            qrText.value = data.qr_code;

            // Inicia verificação automática
            if (paymentCheckInterval) clearInterval(paymentCheckInterval);
            const initialSaldo = window.currentUser.saldo;

            paymentCheckInterval = setInterval(async () => {
              try {
                const checkRes = await fetch("/api/user/re-authenticate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: window.currentUser.email }),
                });
                const checkData = await checkRes.json();
                if (checkData.user && checkData.user.saldo > initialSaldo) {
                  window.currentUser = checkData.user;
                  updateLobbyWelcome();
                  alert(
                    `Pagamento confirmado! R$ ${amount.toFixed(
                      2
                    )} foram adicionados.`
                  );
                  clearInterval(paymentCheckInterval);
                  paymentCheckInterval = null;

                  // Reseta o modal
                  document
                    .getElementById("pix-overlay")
                    .classList.add("hidden");
                  qrContainer.classList.add("hidden");
                  payBtn.disabled = false;
                }
              } catch (err) {
                console.error("Erro na verificação de saldo:", err);
              }
            }, 5000);
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

    // Saque
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

    const withdrawForm = document.getElementById("withdraw-form");
    if (withdrawForm) {
      withdrawForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!window.currentUser) return;

        const pixKey = document.getElementById("withdraw-pix-key").value;
        const amount = parseFloat(
          document.getElementById("withdraw-amount").value
        );
        const msgElement = document.getElementById("withdraw-message");

        if (!pixKey || !amount) {
          msgElement.textContent = "Preencha todos os campos.";
          msgElement.style.color = "red";
          return;
        }
        if (amount < 30) {
          msgElement.textContent = "O valor mínimo é R$ 30,00.";
          msgElement.style.color = "red";
          return;
        }

        const submitBtn = withdrawForm.querySelector("button[type='submit']");
        submitBtn.disabled = true;
        submitBtn.textContent = "Enviando...";

        try {
          const response = await fetch("/api/withdraw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: window.currentUser.email,
              amount: amount,
              pixKey: pixKey,
            }),
          });
          const data = await response.json();
          if (response.ok) {
            msgElement.textContent =
              "Solicitação enviada! Aguarde a aprovação.";
            msgElement.style.color = "green";
            setTimeout(() => {
              document
                .getElementById("withdraw-overlay")
                .classList.add("hidden");
              document.getElementById("withdraw-pix-key").value = "";
              document.getElementById("withdraw-amount").value = "";
              msgElement.textContent = "";
            }, 2000);
          } else {
            msgElement.textContent = data.message || "Erro ao solicitar.";
            msgElement.style.color = "red";
          }
        } catch (error) {
          msgElement.textContent = "Erro de conexão.";
          msgElement.style.color = "red";
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = "Solicitar";
        }
      });
    }

    // Indicações
    const copyReferralBtn = document.getElementById("copy-referral-btn");
    if (copyReferralBtn) {
      copyReferralBtn.addEventListener("click", () => {
        if (!window.currentUser) return;
        const link = `${window.location.origin}/?ref=${window.currentUser.email}`;
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
        if (!window.currentUser) return;
        document.getElementById("referrals-overlay").classList.remove("hidden");
        const list = document.getElementById("referrals-list");
        list.innerHTML = "<p>Carregando...</p>";
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

  // --- CONFIRMAÇÃO DE APOSTA ---
  document.getElementById("accept-bet-btn").addEventListener("click", () => {
    if (tempRoomCode && window.currentUser) {
      window.isSpectator = false; // Define variavel global do jogo
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

  // --- LISTENERS DO SOCKET RELACIONADOS AO LOBBY ---

  socket.on("roomCreated", (data) => {
    document.getElementById("room-code-display").textContent = data.roomCode;
    document.getElementById("waiting-area").classList.remove("hidden");
  });

  socket.on("roomCancelled", () => UI.resetLobbyUI());

  socket.on("updateLobby", (data) => {
    UI.renderOpenRooms(data.waiting);
    UI.renderActiveRooms(data.active);
  });

  socket.on("tournamentUpdate", (data) => {
    const countEl = document.getElementById("trn-participants-count");
    const headerCountEl = document.getElementById("header-participants-count"); // NOVO
    const prizeEl = document.getElementById("trn-prize-pool");

    if (countEl) countEl.textContent = `Inscritos: ${data.participantsCount}`;
    if (headerCountEl)
      headerCountEl.textContent = `(${data.participantsCount})`; // NOVO

    if (prizeEl)
      prizeEl.textContent = `Prêmio Atual: R$ ${data.prizePool.toFixed(2)}`;
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

  socket.on("updateSaldo", (d) => {
    if (window.currentUser) {
      window.currentUser.saldo = d.newSaldo;
      updateLobbyWelcome();
    }
  });

  socket.on("balanceUpdate", (data) => {
    if (window.currentUser && data.email === window.currentUser.email) {
      window.currentUser.saldo = data.newSaldo;
      updateLobbyWelcome();

      if (
        !document.getElementById("pix-overlay").classList.contains("hidden")
      ) {
        document.getElementById("pix-overlay").classList.add("hidden");
        alert("Pagamento confirmado! Saldo atualizado.");
        if (paymentCheckInterval) clearInterval(paymentCheckInterval);
      }
    }
  });

  // --- Helpers Locais ---
  function updateLobbyWelcome() {
    const welcomeMsg = document.getElementById("lobby-welcome-message");
    if (welcomeMsg && window.currentUser) {
      welcomeMsg.textContent = `Bem-vindo, ${
        window.currentUser.email
      }! Saldo: R$ ${window.currentUser.saldo.toFixed(2)}`;
    }
  }

  // Verificar sessão ao iniciar
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
          window.currentUser = data.user;
          document.getElementById("main-container").classList.add("hidden");
          document.getElementById("lobby-container").classList.remove("hidden");
          updateLobbyWelcome();
          updateTournamentStatus();
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
};
