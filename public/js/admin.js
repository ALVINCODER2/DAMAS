document.addEventListener("DOMContentLoaded", () => {
  const authContainer = document.getElementById("auth-admin-container");
  const adminContainer = document.getElementById("admin-container");
  const secretForm = document.getElementById("secret-form");
  const secretKeyInput = document.getElementById("secret-key-input");
  const authMessage = document.getElementById("auth-admin-message");
  const searchInput = document.getElementById("search-input");
  const usersTableBody = document.querySelector("#users-table tbody");
  const withdrawalsTableBody = document.querySelector(
    "#withdrawals-table tbody"
  );
  const resetAllSaldosBtn = document.getElementById("reset-all-saldos-btn");
  const refreshWithdrawalsBtn = document.getElementById(
    "refresh-withdrawals-btn"
  );

  let adminSecretKey = null;
  let allUsers = [];
  let availableOpenings = []; // Lista de sorteios carregada do servidor

  secretForm.addEventListener("submit", (e) => {
    e.preventDefault();
    adminSecretKey = secretKeyInput.value;
    if (!adminSecretKey) {
      authMessage.textContent = "Por favor, insira a senha.";
      authMessage.style.color = "red";
      return;
    }
    loadData();
  });

  async function loadData() {
    await loadUsers();
    await loadWithdrawals();
    authContainer.classList.add("hidden");
    adminContainer.classList.remove("hidden");
    initializeTestBoard(); // Inicializa o tabuleiro e carrega as aberturas
  }

  async function loadUsers() {
    try {
      const response = await fetch("/api/admin/users", {
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret-key": adminSecretKey,
        },
      });

      if (response.status === 403) {
        authMessage.textContent = "Senha secreta inválida!";
        authMessage.style.color = "red";
        adminSecretKey = null;
        return;
      }
      if (!response.ok) throw new Error("Falha ao carregar utilizadores.");

      allUsers = await response.json();
      renderTable(allUsers);
    } catch (error) {
      authMessage.textContent = `Erro: ${error.message}`;
      authMessage.style.color = "red";
    }
  }

  async function loadWithdrawals() {
    try {
      const response = await fetch("/api/admin/withdrawals", {
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret-key": adminSecretKey,
        },
      });
      if (!response.ok) throw new Error("Falha ao carregar saques.");
      const withdrawals = await response.json();
      renderWithdrawalsTable(withdrawals);
    } catch (error) {
      console.error(error);
      alert("Erro ao carregar lista de saques.");
    }
  }
  function renderWithdrawalsTable(withdrawals) {
    withdrawalsTableBody.innerHTML = "";
    if (withdrawals.length === 0) {
      withdrawalsTableBody.innerHTML =
        "<tr><td colspan='5' style='text-align:center;'>Nenhuma solicitação pendente.</td></tr>";
      return;
    }

    withdrawals.forEach((w) => {
      const row = document.createElement("tr");
      const date = new Date(w.createdAt).toLocaleString();
      const amountRequested = w.amount;
      const amountToSend = amountRequested * 0.7; // 30% de taxa

      row.innerHTML = `
            <td>${date}</td>
            <td>${w.email}</td>
            <td style="font-family: monospace; background: #222; color: #f1c40f; padding: 5px;">${
              w.pixKey
            }</td>
            <td>
              <div>Solicitado: R$ ${amountRequested.toFixed(2)}</div>
              <div style="font-weight: bold; color: #2ecc71;">Enviar: R$ ${amountToSend.toFixed(
                2
              )}</div>
            </td>
            <td>
                <button class="approve-btn" data-id="${w._id}" data-amount="${
        w.amount
      }">Concluir (Pagar)</button>
                <button class="reject-btn" data-id="${w._id}">Rejeitar</button>
            </td>
          `;
      withdrawalsTableBody.appendChild(row);
    });
  }

  withdrawalsTableBody.addEventListener("click", async (e) => {
    const target = e.target;
    const id = target.dataset.id;

    if (target.classList.contains("approve-btn")) {
      const amount = parseFloat(target.dataset.amount);
      const amountToSend = (amount * 0.7).toFixed(2);

      if (
        confirm(
          `Confirma que enviou R$ ${amountToSend} (já descontado 30%) para o usuário? O sistema removerá R$ ${amount.toFixed(
            2
          )} do saldo dele.`
        )
      ) {
        await approveWithdrawal(id);
      }
    }

    if (target.classList.contains("reject-btn")) {
      if (
        confirm(
          "Deseja rejeitar esta solicitação? O saldo do usuário não será alterado."
        )
      ) {
        await rejectWithdrawal(id);
      }
    }
  });

  if (refreshWithdrawalsBtn) {
    refreshWithdrawalsBtn.addEventListener("click", loadWithdrawals);
  }

  async function approveWithdrawal(id) {
    try {
      const response = await fetch("/api/admin/approve-withdrawal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: adminSecretKey, withdrawalId: id }),
      });
      const data = await response.json();
      alert(data.message);
      loadData();
    } catch (error) {
      alert("Erro ao aprovar.");
    }
  }

  async function rejectWithdrawal(id) {
    try {
      const response = await fetch("/api/admin/reject-withdrawal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: adminSecretKey, withdrawalId: id }),
      });
      const data = await response.json();
      alert(data.message);
      loadWithdrawals();
    } catch (error) {
      alert("Erro ao rejeitar.");
    }
  }

  function renderTable(users) {
    usersTableBody.innerHTML = "";
    users.forEach((user) => {
      const row = document.createElement("tr");
      // Ícone para status de depósito
      const depositStatus = user.hasDeposited ? "✅" : "⏳";
      const referredBy = user.referredBy ? user.referredBy : "-";

      row.innerHTML = `
        <td>
            ${user.email}<br>
            <small style="color:#aaa; font-size: 0.8em;">Indicado por: ${referredBy}</small>
        </td>
        <td data-email="${user.email}">
          <span>${user.saldo.toFixed(2)}</span>
        </td>
        <td style="text-align:center;">${depositStatus}</td>
        <td>
          <button class="add-saldo-btn" data-email="${
            user.email
          }" style="background-color: #2ecc71; margin-right: 5px;">+ Saldo</button>
          <button class="edit-btn" data-email="${
            user.email
          }" style="margin-right: 5px;">Editar</button>
          <button class="delete-btn" data-email="${
            user.email
          }" style="background-color: #c0392b;">Excluir</button>
        </td>
      `;
      usersTableBody.appendChild(row);
    });
  }

  usersTableBody.addEventListener("click", (e) => {
    const target = e.target;
    const email = target.dataset.email;

    if (target.classList.contains("edit-btn")) {
      handleEdit(email);
    }
    if (target.classList.contains("delete-btn")) {
      handleDelete(email);
    }
    // ### NOVO BOTÃO DE ADICIONAR SALDO ###
    if (target.classList.contains("add-saldo-btn")) {
      handleAddSaldo(email);
    }
  });

  // Função para ADICIONAR SALDO (e processar bônus)
  async function handleAddSaldo(email) {
    const amount = prompt(
      `Quanto deseja adicionar para ${email}? (Se for o 1º depósito >= R$5, o indicador ganha bônus)`
    );
    if (amount && !isNaN(amount) && Number(amount) > 0) {
      try {
        const response = await fetch("/api/admin/add-saldo-bonus", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            amountToAdd: Number(amount),
            secret: adminSecretKey,
          }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message);

        alert(data.message);
        loadUsers();
      } catch (error) {
        alert(`Erro: ${error.message}`);
      }
    }
  }

  function handleEdit(email) {
    const saldoCell = document.querySelector(`td[data-email="${email}"]`);
    const currentSaldo = saldoCell.querySelector("span").textContent;

    const input = document.createElement("input");
    input.type = "number";
    input.value = currentSaldo;
    input.min = "0";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Salvar";
    saveBtn.onclick = () => saveNewSaldo(email, input.value);

    saldoCell.innerHTML = "";
    saldoCell.appendChild(input);
    saldoCell.appendChild(saveBtn);
  }

  async function saveNewSaldo(email, newSaldo) {
    try {
      const response = await fetch("/api/admin/update-saldo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          newSaldo,
          secret: adminSecretKey,
        }),
      });

      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Falha ao atualizar saldo.");

      alert(data.message);
      loadUsers();
    } catch (error) {
      alert(`Erro: ${error.message}`);
    }
  }

  async function handleDelete(email) {
    if (!confirm(`Tem a certeza que deseja excluir o utilizador ${email}?`))
      return;
    try {
      const response = await fetch(`/api/admin/user/${email}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: adminSecretKey }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      alert(data.message);
      loadUsers();
    } catch (error) {
      alert(`Erro: ${error.message}`);
    }
  }

  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filteredUsers = allUsers.filter((user) =>
      user.email.toLowerCase().includes(searchTerm)
    );
    renderTable(filteredUsers);
  });

  if (resetAllSaldosBtn) {
    resetAllSaldosBtn.addEventListener("click", async () => {
      if (!confirm("TEM A CERTEZA ABSOLUTA? Isso zera TODOS os saldos!"))
        return;
      try {
        const response = await fetch("/api/admin/reset-all-saldos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: adminSecretKey }),
        });
        const data = await response.json();
        alert(data.message);
        loadUsers();
      } catch (error) {
        alert(`Erro: ${error.message}`);
      }
    });
  }

  // --- LÓGICA DO TABULEIRO DE TESTE ---
  const standardOpening = [
    [0, "p", 0, "p", 0, "p", 0, "p"],
    ["p", 0, "p", 0, "p", 0, "p", 0],
    [0, "p", 0, "p", 0, "p", 0, "p"],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    ["b", 0, "b", 0, "b", 0, "b", 0],
    [0, "b", 0, "b", 0, "b", 0, "b"],
    ["b", 0, "b", 0, "b", 0, "b", 0],
  ];

  let testGame = {};
  let selectedPiece = null;
  let testGameHistory = [];
  let removeMode = false;
  let promoteMode = false;
  let editMoveMode = false;
  let editMoveSelected = null;

  const toggleTestBoardBtn = document.getElementById("toggle-test-board-btn");
  const testBoardContainer = document.getElementById("test-board-container");
  const boardElement = document.getElementById("board");
  const testStatus = document.getElementById("test-status");
  const resetBoardBtn = document.getElementById("reset-board-btn");
  const switchTurnBtn = document.getElementById("switch-turn-btn");
  const undoBoardBtn = document.getElementById("undo-board-btn");
  const testTurnSpan = document.getElementById("test-turn");
  const turnSelect = document.getElementById("turn-select");
  const setTurnBtn = document.getElementById("set-turn-btn");

  // Novo Elemento Select
  const openingSelect = document.getElementById("opening-select");

  async function loadOpenings() {
    try {
      const response = await fetch("/api/admin/openings", {
        headers: { "x-admin-secret-key": adminSecretKey },
      });
      if (response.ok) {
        availableOpenings = await response.json();
        // Popula o select
        availableOpenings.forEach((op, index) => {
          const option = document.createElement("option");
          option.value = index;
          option.textContent = op.name;
          openingSelect.appendChild(option);
        });
      }
    } catch (e) {
      console.error("Erro ao carregar aberturas", e);
    }
  }

  function initializeTestBoard() {
    // Carrega as aberturas ao iniciar o tabuleiro
    loadOpenings();

    toggleTestBoardBtn.addEventListener("click", () => {
      testBoardContainer.classList.toggle("hidden");
    });

    // Listener de mudança de sorteio
    openingSelect.addEventListener("change", (e) => {
      startTestGame(); // Reinicia o jogo usando o valor selecionado
    });

    resetBoardBtn.addEventListener("click", startTestGame);
    undoBoardBtn.addEventListener("click", handleUndoMove);
    switchTurnBtn.addEventListener("click", () => {
      testGame.currentPlayer = testGame.currentPlayer === "b" ? "p" : "b";
      updateTestGameUI();
    });

    // Carregador de JSON do tabuleiro (para reproduzir cenários)
    const boardJsonInput = document.getElementById("board-json-input");
    const loadJsonBtn = document.getElementById("load-json-btn");
    const clearJsonBtn = document.getElementById("clear-json-btn");
    const exportJsonBtn = document.getElementById("export-json-btn");
    const removeModeBtn = document.getElementById("remove-mode-btn");
    const promoteModeBtn = document.getElementById("promote-mode-btn");
    const editMoveBtn = document.getElementById("edit-move-btn");
    const moveInput = document.getElementById("move-input");
    const addMoveBtn = document.getElementById("add-move-btn");
    const execNextBtn = document.getElementById("exec-next-btn");
    const execAllBtn = document.getElementById("exec-all-btn");
    const clearMovesBtn = document.getElementById("clear-moves-btn");
    const movesListEl = document.getElementById("moves-list");
    const ignoreMajorityEl = document.getElementById("ignore-majority");

    let movesQueue = [];

    if (loadJsonBtn) {
      loadJsonBtn.addEventListener("click", () => {
        const raw = boardJsonInput.value.trim();
        if (!raw) {
          testStatus.textContent = "Cole o JSON do tabuleiro antes.";
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          let boardArr = null;
          let player = null;
          if (Array.isArray(parsed)) {
            boardArr = parsed;
          } else if (parsed && parsed.board && Array.isArray(parsed.board)) {
            boardArr = parsed.board;
            if (parsed.currentPlayer) player = parsed.currentPlayer;
          }

          if (
            !boardArr ||
            boardArr.length !== 8 ||
            !boardArr.every((r) => Array.isArray(r) && r.length === 8)
          ) {
            testStatus.textContent =
              "Formato inválido: envie um array 8x8 ou um objeto {board: [...], currentPlayer: 'b'}.";
            return;
          }

          testGame.boardState = JSON.parse(JSON.stringify(boardArr));
          testGame.turnCapturedPieces = [];
          if (player === "b" || player === "p") testGame.currentPlayer = player;
          testGameHistory = [];
          movesQueue = [];
          renderMovesList();
          renderPieces();
          updateTestGameUI();
          testStatus.textContent = "Tabuleiro carregado com sucesso.";
        } catch (e) {
          testStatus.textContent = "JSON inválido: " + e.message;
        }
      });
    }

    // Exporta o board atual para o campo JSON e copia para clipboard
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener("click", async () => {
        try {
          let json = null;
          if (testGame && Array.isArray(testGame.boardState)) {
            json = JSON.stringify(testGame.boardState);
          } else {
            // fallback: monta a partir do DOM
            const board = [];
            for (let r = 0; r < 8; r++) {
              const row = [];
              for (let c = 0; c < 8; c++) {
                const sq = document.querySelector(
                  `#board .square[data-row='${r}'][data-col='${c}']`
                );
                const pieceEl = sq ? sq.querySelector(".piece") : null;
                if (!pieceEl) {
                  row.push(0);
                  continue;
                }
                const isBlack = pieceEl.classList.contains("black-piece");
                const isKing = pieceEl.classList.contains("king");
                let ch = isBlack ? "p" : "b";
                if (isKing) ch = ch.toUpperCase();
                row.push(ch);
              }
              board.push(row);
            }
            json = JSON.stringify(board);
          }
          if (boardJsonInput) boardJsonInput.value = json;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(json);
            testStatus.textContent =
              "JSON exportado e copiado para a área de transferência.";
          } else {
            testStatus.textContent =
              "JSON exportado para o campo; copie manualmente.";
          }
        } catch (e) {
          testStatus.textContent = "Erro ao exportar JSON: " + e.message;
        }
      });
    }

    if (clearJsonBtn) {
      clearJsonBtn.addEventListener("click", () => {
        const b = document.getElementById("board-json-input");
        if (b) b.value = "";
        testStatus.textContent = "Campo limpo.";
      });
    }

    // Remover / Promover modos
    function updateModeButtons() {
      if (removeModeBtn) removeModeBtn.style.opacity = removeMode ? "1" : "0.7";
      if (promoteModeBtn)
        promoteModeBtn.style.opacity = promoteMode ? "1" : "0.7";
      if (editMoveBtn) editMoveBtn.style.opacity = editMoveMode ? "1" : "0.7";
      if (removeMode && promoteMode) {
        // nunca ambos ao mesmo tempo
        promoteMode = false;
      }
      // Se outro modo estiver ativo, desativa o modo mover
      if (removeMode || promoteMode) editMoveMode = false;
    }

    if (removeModeBtn) {
      removeModeBtn.addEventListener("click", () => {
        removeMode = !removeMode;
        if (removeMode) promoteMode = false;
        updateModeButtons();
        testStatus.textContent = removeMode
          ? "Modo Remover ativo: clique em uma peça para removê-la."
          : "";
      });
    }

    if (promoteModeBtn) {
      promoteModeBtn.addEventListener("click", () => {
        promoteMode = !promoteMode;
        if (promoteMode) removeMode = false;
        updateModeButtons();
        testStatus.textContent = promoteMode
          ? "Modo Promover ativo: clique em uma peça para promovê-la."
          : "";
      });
    }

    if (editMoveBtn) {
      editMoveBtn.addEventListener("click", () => {
        editMoveMode = !editMoveMode;
        if (editMoveMode) {
          removeMode = false;
          promoteMode = false;
          editMoveSelected = null;
        }
        updateModeButtons();
        testStatus.textContent = editMoveMode
          ? "Modo Mover ativo: clique na peça que deseja mover, depois clique no destino."
          : "";
      });
    }

    // Moves queue handlers
    function parseMoveText(text) {
      // accepts formats: "r,c->r,c" or "r,c r,c"
      const t = text.trim();
      const arrow = t.includes("->");
      const parts = arrow ? t.split("->") : t.split(/\s+/);
      if (parts.length < 2) return null;
      const a = parts[0]
        .trim()
        .split(",")
        .map((s) => parseInt(s.trim()));
      const b = parts[1]
        .trim()
        .split(",")
        .map((s) => parseInt(s.trim()));
      if (a.length < 2 || b.length < 2 || a.some(isNaN) || b.some(isNaN))
        return null;
      return { from: { row: a[0], col: a[1] }, to: { row: b[0], col: b[1] } };
    }

    function renderMovesList() {
      movesListEl.innerHTML = "";
      movesQueue.forEach((m, idx) => {
        const div = document.createElement("div");
        div.style.display = "flex";
        div.style.justifyContent = "space-between";
        div.style.alignItems = "center";
        div.style.padding = "4px 0";
        div.innerHTML = `<span style="color:#fff">${idx + 1}. ${m.from.row},${
          m.from.col
        } -> ${m.to.row},${m.to.col}</span>`;
        const rm = document.createElement("button");
        rm.textContent = "X";
        rm.style.background = "#c0392b";
        rm.style.color = "white";
        rm.style.border = "0";
        rm.style.borderRadius = "4px";
        rm.style.padding = "2px 6px";
        rm.onclick = () => {
          movesQueue.splice(idx, 1);
          renderMovesList();
        };
        div.appendChild(rm);
        movesListEl.appendChild(div);
      });
      if (movesQueue.length === 0)
        movesListEl.innerHTML =
          '<div style="color:#94a3b8">Nenhuma jogada na fila.</div>';
    }

    if (addMoveBtn) {
      addMoveBtn.addEventListener("click", () => {
        const txt = moveInput.value;
        const mv = parseMoveText(txt);
        if (!mv) {
          testStatus.textContent = "Formato inválido. Use r,c->r,c";
          return;
        }
        movesQueue.push(mv);
        renderMovesList();
        moveInput.value = "";
        testStatus.textContent = "Jogada adicionada.";
      });
    }

    async function applyMoveObj(mv, ignoreMajority = false) {
      // Validate with gameLogic
      const player = testGame.currentPlayer;
      const res = window.gameLogic.isMoveValid(
        mv.from,
        mv.to,
        player,
        testGame,
        ignoreMajority
      );
      if (!res.valid) {
        testStatus.textContent = res.reason || "Movimento inválido.";
        return false;
      }

      // Save history
      testGameHistory.push(JSON.parse(JSON.stringify(testGame)));

      // Apply move
      const piece = testGame.boardState[mv.from.row][mv.from.col];
      testGame.boardState[mv.to.row][mv.to.col] = piece;
      testGame.boardState[mv.from.row][mv.from.col] = 0;

      if (res.isCapture && res.capturedPos) {
        // store captured positions in turnCapturedPieces (do not remove yet)
        if (!Array.isArray(res.capturedPos)) {
          testGame.turnCapturedPieces.push(res.capturedPos);
        } else {
          res.capturedPos.forEach((p) => testGame.turnCapturedPieces.push(p));
        }

        const nextCaptures = window.gameLogic.getAllPossibleCapturesForPiece(
          mv.to.row,
          mv.to.col,
          testGame
        );
        const canCaptureAgain = nextCaptures.length > 0;
        if (!canCaptureAgain) {
          // finalize: remove captured pieces now
          testGame.turnCapturedPieces.forEach((p) => {
            if (
              testGame.boardState[p.row] &&
              typeof testGame.boardState[p.row][p.col] !== "undefined"
            ) {
              testGame.boardState[p.row][p.col] = 0;
            }
          });
          testGame.turnCapturedPieces = [];

          // promotion handling
          if (piece === "b" && mv.to.row === 0)
            testGame.boardState[mv.to.row][mv.to.col] = "B";
          if (piece === "p" && mv.to.row === testGame.boardSize - 1)
            testGame.boardState[mv.to.row][mv.to.col] = "P";
          testGame.currentPlayer = testGame.currentPlayer === "b" ? "p" : "b";
        }
      } else {
        // non capture move
        if (piece === "b" && mv.to.row === 0)
          testGame.boardState[mv.to.row][mv.to.col] = "B";
        if (piece === "p" && mv.to.row === testGame.boardSize - 1)
          testGame.boardState[mv.to.row][mv.to.col] = "P";
        testGame.currentPlayer = testGame.currentPlayer === "b" ? "p" : "b";
      }

      renderPieces();
      updateTestGameUI();
      return true;
    }

    // Expor para o escopo global para chamadas assíncronas/externas
    try {
      window.applyMoveObj = applyMoveObj;
    } catch (e) {
      // ignore
    }

    if (execNextBtn) {
      execNextBtn.addEventListener("click", async () => {
        if (movesQueue.length === 0) {
          testStatus.textContent = "Nenhuma jogada na fila.";
          return;
        }
        const mv = movesQueue.shift();
        renderMovesList();
        const ignore = ignoreMajorityEl && ignoreMajorityEl.checked;
        const ok = await applyMoveObj(mv, ignore);
        if (!ok) {
          testStatus.textContent =
            "Falha ao aplicar jogada; operação interrompida.";
        }
      });
    }

    if (execAllBtn) {
      execAllBtn.addEventListener("click", async () => {
        const ignore = ignoreMajorityEl && ignoreMajorityEl.checked;
        while (movesQueue.length > 0) {
          const mv = movesQueue.shift();
          renderMovesList();
          const ok = await applyMoveObj(mv, ignore);
          if (!ok) break;
        }
      });
    }

    if (clearMovesBtn) {
      clearMovesBtn.addEventListener("click", () => {
        movesQueue = [];
        renderMovesList();
        testStatus.textContent = "Lista limpa.";
      });
    }

    renderMovesList();

    if (setTurnBtn && turnSelect) {
      setTurnBtn.addEventListener("click", () => {
        const val = turnSelect.value;
        if (val === "b" || val === "p") {
          testGame.currentPlayer = val;
          updateTestGameUI();
          testStatus.textContent = `Vez definida: ${
            val === "b" ? "Brancas" : "Vermelhas"
          }`;
        }
      });
    }
    createBoard();
    startTestGame();
  }

  function handleUndoMove() {
    if (testGameHistory && testGameHistory.length > 0) {
      testGame = testGameHistory.pop();
      renderPieces();
      updateTestGameUI();
      testStatus.textContent = "Jogada anterior restaurada.";
    } else {
      testStatus.textContent = "Nenhuma jogada para voltar.";
    }
  }

  function startTestGame() {
    let initialBoard = standardOpening;

    // Verifica o valor selecionado no dropdown
    const selectedIdx = parseInt(openingSelect.value);
    if (selectedIdx >= 0 && availableOpenings[selectedIdx]) {
      // Usa o tabuleiro do sorteio selecionado (fazendo cópia profunda)
      initialBoard = availableOpenings[selectedIdx].board;
      testStatus.textContent = `Sorteio: ${availableOpenings[selectedIdx].name}`;
    } else {
      testStatus.textContent = "Abertura Padrão";
    }

    testGame = {
      boardState: JSON.parse(JSON.stringify(initialBoard)),
      boardSize: 8,
      currentPlayer: "b",
      turnCapturedPieces: [],
    };
    selectedPiece = null;
    testGameHistory = [];
    renderPieces();
    updateTestGameUI();
  }

  function createBoard() {
    boardElement.innerHTML = "";
    boardElement.style.display = "grid";
    boardElement.style.gridTemplateColumns = "repeat(8, min(60px, 10vw))";
    boardElement.style.gridTemplateRows = "repeat(8, min(60px, 10vw))";
    boardElement.style.border = "12px solid #382d21";
    boardElement.style.borderRadius = "5px";
    boardElement.style.boxShadow =
      "0 15px 30px rgba(0, 0, 0, 0.4), inset 0 0 15px rgba(0, 0, 0, 0.6)";

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = document.createElement("div");
        square.classList.add(
          "square",
          (row + col) % 2 === 1 ? "dark" : "light"
        );
        square.dataset.row = row;
        square.dataset.col = col;
        boardElement.appendChild(square);
      }
    }
    boardElement.addEventListener("click", handleBoardClick);
  }

  function renderPieces() {
    document.querySelectorAll("#board .piece").forEach((p) => p.remove());
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const pieceType = testGame.boardState[row][col];
        if (pieceType !== 0) {
          const piece = document.createElement("div");
          piece.classList.add("piece");
          const isBlack = pieceType.toLowerCase() === "p";
          piece.classList.add(isBlack ? "black-piece" : "white-piece");
          const isKing = pieceType === "P" || pieceType === "B";
          if (isKing) {
            piece.classList.add("king");
          }
          const square = document.querySelector(
            `#board .square[data-row='${row}'][data-col='${col}']`
          );
          if (square) {
            square.appendChild(piece);
          }
        }
      }
    }
  }

  function updateTestGameUI() {
    testTurnSpan.textContent =
      testGame.currentPlayer === "b" ? "Brancas" : "Vermelhas";
    // testStatus.textContent = ""; // Não limpa para manter o nome do sorteio visível

    highlightMandatoryPieces([]);
    unselectPiece();

    if (!window.gameLogic.hasValidMoves(testGame.currentPlayer, testGame)) {
      const winner = testGame.currentPlayer === "b" ? "Vermelhas" : "Brancas";
      testStatus.textContent += ` - FIM DE JOGO! ${winner} venceu por bloqueio!`;
      return;
    }

    const bestCaptures = window.gameLogic.findBestCaptureMoves(
      testGame.currentPlayer,
      testGame
    );
    if (bestCaptures.length > 0) {
      testStatus.textContent += " - Captura Obrigatória!";
      const mandatoryPieces = bestCaptures.map((seq) => seq[0]);
      highlightMandatoryPieces(mandatoryPieces);
    }
  }

  function handleBoardClick(e) {
    const square = e.target.closest(".square");
    if (!square) return;

    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    const clickedPieceElement = e.target.closest(".piece");

    // Modo Editar/Mover: selecione peça e clique destino (movimento livre)
    if (editMoveMode) {
      // Se clicou em uma peça, seleciona-a para mover
      if (clickedPieceElement && testGame.boardState[row][col] !== 0) {
        editMoveSelected = { row, col, piece: testGame.boardState[row][col] };
        testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
        testStatus.textContent = `Peça selecionada em (${row}, ${col}). Agora clique no destino.`;
        return;
      }

      // Se clicou em um quadrado vazio (ou sobre outra peça) e há seleção, move
      if (editMoveSelected) {
        // evita mover para a mesma casa
        if (editMoveSelected.row === row && editMoveSelected.col === col) {
          testStatus.textContent = "Destino igual à origem; seleção mantida.";
          return;
        }

        // realiza o movimento (substitui o destino)
        testGame.boardState[editMoveSelected.row][editMoveSelected.col] = 0;
        testGame.boardState[row][col] = editMoveSelected.piece;
        renderPieces();
        updateTestGameUI();
        testStatus.textContent = `Peça movida para (${row}, ${col}).`;
        editMoveSelected = null;
        return;
      }

      testStatus.textContent =
        "Clique em uma peça para selecionar antes de mover.";
      return;
    }
    // Modo Remover: ao clicar em qualquer peça, remove-a
    if (removeMode) {
      if (testGame.boardState[row][col] !== 0) {
        testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
        testGame.boardState[row][col] = 0;
        renderPieces();
        updateTestGameUI();
        testStatus.textContent = `Peça removida em (${row}, ${col}).`;
      } else {
        testStatus.textContent = "Não há peça nessa casa.";
      }
      return;
    }

    // Modo Promover: ao clicar em peça, promove para dama
    if (promoteMode) {
      const pieceType = testGame.boardState[row][col];
      if (pieceType !== 0) {
        testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
        const lower = pieceType.toLowerCase();
        if (lower === "b") testGame.boardState[row][col] = "B";
        else if (lower === "p") testGame.boardState[row][col] = "P";
        renderPieces();
        updateTestGameUI();
        testStatus.textContent = `Peça promovida em (${row}, ${col}).`;
      } else {
        testStatus.textContent = "Não há peça nessa casa para promover.";
      }
      return;
    }

    if (selectedPiece) {
      if (square.classList.contains("valid-move-highlight")) {
        const move = {
          from: { row: selectedPiece.row, col: selectedPiece.col },
          to: { row, col },
        };

        const isValid = window.gameLogic.isMoveValid(
          move.from,
          move.to,
          testGame.currentPlayer,
          testGame,
          false
        );

        if (isValid.valid) {
          testGameHistory.push(JSON.parse(JSON.stringify(testGame)));
          const piece = testGame.boardState[move.from.row][move.from.col];
          testGame.boardState[move.to.row][move.to.col] = piece;
          testGame.boardState[move.from.row][move.from.col] = 0;

          let canCaptureAgain = false;

          if (isValid.isCapture) {
            // accumulate captured positions into turnCapturedPieces (do not remove yet)
            if (!Array.isArray(isValid.capturedPos)) {
              testGame.turnCapturedPieces.push(isValid.capturedPos);
            } else {
              isValid.capturedPos.forEach((p) =>
                testGame.turnCapturedPieces.push(p)
              );
            }

            const nextCaptures =
              window.gameLogic.getAllPossibleCapturesForPiece(
                move.to.row,
                move.to.col,
                testGame
              );
            canCaptureAgain = nextCaptures.length > 0;

            if (!canCaptureAgain) {
              // finalize captures: remove captured pieces now
              testGame.turnCapturedPieces.forEach((p) => {
                if (
                  testGame.boardState[p.row] &&
                  typeof testGame.boardState[p.row][p.col] !== "undefined"
                ) {
                  testGame.boardState[p.row][p.col] = 0;
                }
              });
              testGame.turnCapturedPieces = [];
            }
          }

          if (!canCaptureAgain) {
            if (piece === "b" && move.to.row === 0) {
              testGame.boardState[move.to.row][move.to.col] = "B";
            } else if (piece === "p" && move.to.row === 7) {
              testGame.boardState[move.to.row][move.to.col] = "P";
            }
          }

          if (!canCaptureAgain) {
            testGame.currentPlayer = testGame.currentPlayer === "b" ? "p" : "b";
          }

          renderPieces();
          updateTestGameUI();
        } else {
          testStatus.textContent = isValid.reason || "Movimento inválido";
          unselectPiece();
        }
        return;
      }
    }

    unselectPiece();

    if (clickedPieceElement) {
      const pieceColor = clickedPieceElement.classList.contains("white-piece")
        ? "b"
        : "p";

      if (pieceColor === testGame.currentPlayer) {
        selectPiece(clickedPieceElement, row, col);
      }
    }
  }

  function selectPiece(pieceElement, row, col) {
    unselectPiece();
    pieceElement.classList.add("selected");
    selectedPiece = { element: pieceElement, row, col };

    // Tenta executar captura automaticamente quando existe captura obrigatória
    try {
      if (
        window.gameLogic &&
        typeof window.gameLogic.findBestCaptureMoves === "function"
      ) {
        const bestCaptures = window.gameLogic.findBestCaptureMoves(
          testGame.currentPlayer,
          testGame
        );

        // Filtra sequências que começam nesta peça
        const capturesForPiece = bestCaptures.filter(
          (seq) => seq[0] && seq[0].row === row && seq[0].col === col
        );

        if (capturesForPiece.length > 0) {
          // Escolhe a sequência mais longa (maior número de capturas)
          capturesForPiece.sort((a, b) => b.length - a.length);
          const chosenSeq = capturesForPiece[0];

          (async () => {
            let curFrom = { row: chosenSeq[0].row, col: chosenSeq[0].col };

            for (let i = 1; i < chosenSeq.length; i++) {
              const dest = chosenSeq[i];
              const mv = {
                from: { row: curFrom.row, col: curFrom.col },
                to: dest,
              };

              // Ao executar uma sequência pré-calculada, ignoramos a "lei da maioria"
              // porque a sequência foi escolhida como uma das ótimas no estado inicial.
              const ok = await applyMoveObj(mv, true);
              if (!ok) return;

              curFrom = { row: dest.row, col: dest.col };
              // pequeno delay para render/visual
              await new Promise((r) => setTimeout(r, 150));

              // verifica opções futuras;
              // se houver mais de uma opção, só interrompe se NÃO houver uma
              // próxima etapa já definida na `chosenSeq` que corresponda a essa opção.
              if (
                window.gameLogic &&
                typeof window.gameLogic.getAllPossibleCapturesForPiece ===
                  "function"
              ) {
                const nextCaptures =
                  window.gameLogic.getAllPossibleCapturesForPiece(
                    curFrom.row,
                    curFrom.col,
                    testGame
                  );

                if (nextCaptures.length > 1) {
                  // se houver uma próxima etapa prevista na chosenSeq, verifique se ela
                  // corresponde a uma das opções retornadas. Se corresponder, continue;
                  // caso contrário, interrompa e aguarde escolha do usuário.
                  const nextIdx = i + 1;
                  if (chosenSeq && nextIdx < chosenSeq.length) {
                    const planned = chosenSeq[nextIdx];
                    const matchesPlanned = nextCaptures.some((seq) => {
                      if (!seq[1]) return false;
                      return (
                        seq[1].row === planned.row && seq[1].col === planned.col
                      );
                    });
                    if (!matchesPlanned) return;
                  } else {
                    return;
                  }
                }
              }
            }
          })().catch(() => {});

          return;
        }
      }
    } catch (e) {
      // silently ignore auto-capture check errors
    }

    // comportamento padrão: mostra movimentos válidos
    showValidMoves(row, col);
  }

  function unselectPiece() {
    document
      .querySelectorAll("#board .valid-move-highlight")
      .forEach((square) => {
        square.classList.remove("valid-move-highlight");
      });
    if (selectedPiece) {
      selectedPiece.element.classList.remove("selected");
      selectedPiece = null;
    }
  }

  function highlightMandatoryPieces(piecesToHighlight) {
    document
      .querySelectorAll("#board .mandatory-capture")
      .forEach((p) => p.classList.remove("mandatory-capture"));
    if (piecesToHighlight && piecesToHighlight.length > 0) {
      piecesToHighlight.forEach((pos) => {
        const square = document.querySelector(
          `#board .square[data-row='${pos.row}'][data-col='${pos.col}']`
        );
        if (square && square.firstChild) {
          square.firstChild.classList.add("mandatory-capture");
        }
      });
    }
  }

  function showValidMoves(row, col) {
    const piece = testGame.boardState[row][col];
    if (piece === 0) return;

    const playerColor = piece.toLowerCase();
    let validMoves = [];

    const bestCaptures = window.gameLogic.findBestCaptureMoves(
      playerColor,
      testGame
    );

    if (bestCaptures.length > 0) {
      const capturesForThisPiece = bestCaptures.filter(
        (seq) => seq[0].row === row && seq[0].col === col
      );
      // coletar todos os pousos possíveis da sequência (não apenas o primeiro)
      const dests = [];
      capturesForThisPiece.forEach((seq) => {
        for (let i = 1; i < seq.length; i++) {
          dests.push(seq[i]);
        }
      });
      // deduplicar
      const seen = new Set();
      validMoves = dests.filter((d) => {
        const k = `${d.row},${d.col}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    } else {
      for (let toRow = 0; toRow < 8; toRow++) {
        for (let toCol = 0; toCol < 8; toCol++) {
          const result = window.gameLogic.isMoveValid(
            { row, col },
            { row: toRow, col: toCol },
            playerColor,
            testGame,
            true
          );

          if (result.valid && !result.isCapture) {
            validMoves.push({ row: toRow, col: toCol });
          }
        }
      }
    }

    validMoves.forEach((move) => {
      const square = document.querySelector(
        `#board .square[data-row='${move.row}'][data-col='${move.col}']`
      );
      if (square) {
        square.classList.add("valid-move-highlight");
      }
    });
  }
});
