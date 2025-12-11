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
    initializeTestBoard();
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

  // --- LÓGICA DO TABULEIRO DE TESTE (Mantida) ---
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
  let lastTestGameState = null;

  const toggleTestBoardBtn = document.getElementById("toggle-test-board-btn");
  const testBoardContainer = document.getElementById("test-board-container");
  const boardElement = document.getElementById("board");
  const testStatus = document.getElementById("test-status");
  const resetBoardBtn = document.getElementById("reset-board-btn");
  const switchTurnBtn = document.getElementById("switch-turn-btn");
  const undoBoardBtn = document.getElementById("undo-board-btn");
  const testTurnSpan = document.getElementById("test-turn");

  function initializeTestBoard() {
    toggleTestBoardBtn.addEventListener("click", () => {
      testBoardContainer.classList.toggle("hidden");
    });
    resetBoardBtn.addEventListener("click", startTestGame);
    undoBoardBtn.addEventListener("click", handleUndoMove);
    switchTurnBtn.addEventListener("click", () => {
      testGame.currentPlayer = testGame.currentPlayer === "b" ? "p" : "b";
      updateTestGameUI();
    });
    createBoard();
    startTestGame();
  }

  function handleUndoMove() {
    if (lastTestGameState) {
      testGame = JSON.parse(JSON.stringify(lastTestGameState));
      lastTestGameState = null;
      renderPieces();
      updateTestGameUI();
      testStatus.textContent = "Jogada anterior restaurada.";
    } else {
      testStatus.textContent = "Nenhuma jogada para voltar.";
    }
  }

  function startTestGame() {
    testGame = {
      boardState: JSON.parse(JSON.stringify(standardOpening)),
      boardSize: 8,
      currentPlayer: "b",
    };
    selectedPiece = null;
    lastTestGameState = null;
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
      testGame.currentPlayer === "b" ? "Brancas" : "Pretas";
    testStatus.textContent = "";

    highlightMandatoryPieces([]);
    unselectPiece();

    if (!window.gameLogic.hasValidMoves(testGame.currentPlayer, testGame)) {
      const winner = testGame.currentPlayer === "b" ? "Pretas" : "Brancas";
      testStatus.textContent = `FIM DE JOGO! O jogador ${winner} venceu por bloqueio!`;
      return;
    }

    const bestCaptures = window.gameLogic.findBestCaptureMoves(
      testGame.currentPlayer,
      testGame
    );
    if (bestCaptures.length > 0) {
      testStatus.textContent = "Captura Obrigatória!";
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
          true
        );

        if (isValid.valid) {
          lastTestGameState = JSON.parse(JSON.stringify(testGame));
          const piece = testGame.boardState[move.from.row][move.from.col];
          testGame.boardState[move.to.row][move.to.col] = piece;
          testGame.boardState[move.from.row][move.from.col] = 0;

          let canCaptureAgain = false;

          if (isValid.isCapture) {
            testGame.boardState[isValid.capturedPos.row][
              isValid.capturedPos.col
            ] = 0;
            const nextCaptures =
              window.gameLogic.getAllPossibleCapturesForPiece(
                move.to.row,
                move.to.col,
                testGame
              );
            canCaptureAgain = nextCaptures.length > 0;
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
      validMoves = capturesForThisPiece.map((seq) => seq[1]);
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
