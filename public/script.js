document.addEventListener("DOMContentLoaded", () => {
  // --- Elementos do DOM ---
  const authContainer = document.getElementById("auth-container");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const authMessage = document.getElementById("auth-message");
  const showRegisterLink = document.getElementById("show-register");
  const showLoginLink = document.getElementById("show-login");
  const lobbyContainer = document.getElementById("lobby-container");
  const lobbyWelcomeMessage = document.getElementById("lobby-welcome-message");
  const createRoomBtn = document.getElementById("create-room-btn");
  const joinRoomBtn = document.getElementById("join-room-btn");
  const roomCodeInput = document.getElementById("room-code-input");
  const waitingArea = document.getElementById("waiting-area");
  const roomCodeDisplay = document.getElementById("room-code-display");
  const lobbyErrorMessage = document.getElementById("lobby-error-message");
  const betAmountInput = document.getElementById("bet-amount-input");
  const gameContainer = document.getElementById("game-container");
  const gameStatus = document.getElementById("game-status");
  const boardElement = document.getElementById("board");
  const turnDisplay = document.getElementById("turn");
  const timerDisplay = document.getElementById("timer");
  const overlay = document.getElementById("game-over-overlay");
  const winnerScreen = document.getElementById("winner-screen");
  const loserScreen = document.getElementById("loser-screen");
  const drawScreen = document.getElementById("draw-screen");
  const drawReason = document.getElementById("draw-reason");
  const connectionLostOverlay = document.getElementById("connection-lost-overlay");
  const connectionLostMessage = document.getElementById("connection-lost-message");
  const confirmBetOverlay = document.getElementById("confirm-bet-overlay");
  const confirmBetAmount = document.getElementById("confirm-bet-amount");
  const acceptBetBtn = document.getElementById("accept-bet-btn");
  const declineBetBtn = document.getElementById("decline-bet-btn");
  const logoutBtn = document.getElementById("logout-btn");
  // ELEMENTOS DE ÁUDIO
  const moveSound = document.getElementById("move-sound");
  const captureSound = document.getElementById("capture-sound");


  const socket = io({ autoConnect: false });
  let currentUser = null;
  let myColor = null;
  let currentRoom = null;
  let boardState = [];
  let selectedPiece = null;
  let tempRoomCode = null;

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
          authContainer.classList.add("hidden");
          lobbyContainer.classList.remove("hidden");
          lobbyWelcomeMessage.textContent = `Bem-vindo, ${currentUser.email}! Saldo: R$ ${currentUser.saldo.toFixed(2)}`;
          socket.connect();
        } else {
          localStorage.removeItem("checkersUserEmail");
          localStorage.removeItem("checkersCurrentRoom");
          socket.connect();
        }
      } catch (error) {
        console.error("Falha ao re-autenticar:", error);
        socket.connect();
      }
    } else {
      socket.connect();
    }
  }

  function returnToLobby() {
    gameContainer.classList.add("hidden");
    overlay.classList.add("hidden");
    winnerScreen.classList.add("hidden");
    loserScreen.classList.add("hidden");
    if (drawScreen) drawScreen.classList.add("hidden");
    connectionLostOverlay.classList.add("hidden");
    lobbyContainer.classList.remove("hidden");
    boardElement.classList.remove('board-flipped');
    boardElement.innerHTML = "";
    currentRoom = null;
    myColor = null;
    localStorage.removeItem("checkersCurrentRoom");
    if (currentUser) {
      lobbyWelcomeMessage.textContent = `Bem-vindo, ${currentUser.email}! Saldo: R$ ${currentUser.saldo.toFixed(2)}`;
    }
  }

  showRegisterLink.addEventListener("click", (e) => {
    e.preventDefault();
    loginForm.style.display = "none";
    registerForm.style.display = "block";
    authMessage.textContent = "";
  });
  showLoginLink.addEventListener("click", (e) => {
    e.preventDefault();
    registerForm.style.display = "none";
    loginForm.style.display = "block";
    authMessage.textContent = "";
  });
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("register-email").value;
    const password = document.getElementById("register-password").value;
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      authMessage.textContent = data.message;
      if (response.ok) {
        authMessage.style.color = "green";
        setTimeout(() => {
          showLoginLink.click();
        }, 2000);
      } else {
        authMessage.style.color = "red";
      }
    } catch (error) {
      authMessage.textContent = "Erro ao conectar ao servidor.";
      authMessage.style.color = "red";
    }
  });
  loginForm.addEventListener("submit", async (e) => {
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
        authContainer.classList.add("hidden");
        lobbyContainer.classList.remove("hidden");
        lobbyWelcomeMessage.textContent = `Bem-vindo, ${currentUser.email}! Saldo: R$ ${currentUser.saldo.toFixed(2)}`;
      } else {
        authMessage.textContent = data.message;
        authMessage.style.color = "red";
      }
    } catch (error) {
      authMessage.textContent = "Erro ao conectar ao servidor.";
      authMessage.style.color = "red";
    }
  });

  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("checkersUserEmail");
    localStorage.removeItem("checkersCurrentRoom");
    window.location.reload();
  });

  createRoomBtn.addEventListener("click", () => {
    const bet = parseInt(betAmountInput.value, 10);
    const isTablita = document.getElementById("tablita-mode-checkbox").checked;
    
    if (bet > 0 && currentUser) {
      socket.emit("createRoom", { bet, user: currentUser, isTablita });
      lobbyErrorMessage.textContent = "";
    } else if (!currentUser) {
      lobbyErrorMessage.textContent = "Erro de autenticação. Tente fazer o login novamente.";
    } else {
      lobbyErrorMessage.textContent = "A aposta deve ser maior que zero.";
    }
  });
  joinRoomBtn.addEventListener("click", () => {
    const roomCode = roomCodeInput.value.toUpperCase();
    if (roomCode && currentUser) {
      socket.emit("joinRoomRequest", { roomCode, user: currentUser });
      lobbyErrorMessage.textContent = "";
    }
  });
  acceptBetBtn.addEventListener("click", () => {
    if (tempRoomCode && currentUser) {
      socket.emit("acceptBet", { roomCode: tempRoomCode, user: currentUser });
      confirmBetOverlay.classList.add("hidden");
    }
  });
  declineBetBtn.addEventListener("click", () => {
    confirmBetOverlay.classList.add("hidden");
    tempRoomCode = null;
  });

  function createBoard() {
    boardElement.innerHTML = "";
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = document.createElement("div");
        square.classList.add("square");
        const isDark = (row + col) % 2 === 1;
        square.classList.add(isDark ? "dark" : "light");
        square.dataset.row = row;
        square.dataset.col = col;
        boardElement.appendChild(square);
      }
    }
    boardElement.addEventListener("click", handleBoardClick);
  }
  function renderPieces() {
    document.querySelectorAll(".piece").forEach((p) => p.remove());
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const pieceType = boardState[row][col];
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
            `.square[data-row='${row}'][data-col='${col}']`
          );
          if (square) {
            square.appendChild(piece);
          }
        }
      }
    }
  }
  function handleBoardClick(e) {
    if (!myColor) return;
    const square = e.target.closest(".square");
    if (!square) return;
    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    if (selectedPiece) {
      socket.emit("playerMove", {
        from: { row: selectedPiece.row, col: selectedPiece.col },
        to: { row, col },
        room: currentRoom,
      });
      unselectPiece();
    } else if (e.target.classList.contains("piece")) {
      const pieceColor = e.target.classList.contains("white-piece") ? "b" : "p";
      if (pieceColor === myColor) {
        selectPiece(e.target, row, col);
      }
    }
  }

  function selectPiece(pieceElement, row, col) {
    unselectPiece();
    pieceElement.classList.add("selected");
    selectedPiece = { element: pieceElement, row, col };
    socket.emit("getValidMoves", { row, col, roomCode: currentRoom });
  }

  function unselectPiece() {
    document.querySelectorAll('.valid-move-highlight').forEach(square => {
        square.classList.remove('valid-move-highlight');
    });

    if (selectedPiece) {
        selectedPiece.element.classList.remove("selected");
        selectedPiece = null;
    }
  }

  function updateGame(gameState) {
    // Lógica para contar peças e tocar som
    const oldPieceCount = boardState.flat().filter(p => p !== 0).length;
    const newPieceCount = gameState.boardState.flat().filter(p => p !== 0).length;

    if (newPieceCount > 0 && oldPieceCount > 0) { // Não toca som no início do jogo
        if (newPieceCount < oldPieceCount) {
            captureSound.currentTime = 0;
            captureSound.play();
        } else {
            moveSound.currentTime = 0;
            moveSound.play();
        }
    }
    
    boardState = gameState.boardState;
    renderPieces();
    turnDisplay.textContent =
      gameState.currentPlayer === "b" ? "Brancas" : "Pretas";
  }

  socket.on("roomCreated", (data) => {
    roomCodeDisplay.textContent = data.roomCode;
    waitingArea.classList.remove("hidden");
  });
  socket.on("joinError", (data) => {
    lobbyErrorMessage.textContent = data.message;
  });
  
  socket.on("confirmBet", (data) => {
    confirmBetAmount.textContent = data.bet;
    tempRoomCode = data.roomCode;
    const tablitaInfo = document.getElementById('confirm-tablita-mode');
    if (data.isTablita) {
        tablitaInfo.textContent = "Esta partida será em modo Tablita (início aleatório).";
    } else {
        tablitaInfo.textContent = "Esta partida será em modo Clássico.";
    }
    confirmBetOverlay.classList.remove("hidden");
  });

  socket.on("gameStart", (gameState) => {
    lobbyContainer.classList.add("hidden");
    gameContainer.classList.remove("hidden");
    createBoard();
    currentRoom = gameState.roomCode;
    localStorage.setItem("checkersCurrentRoom", currentRoom);
    myColor = socket.id === gameState.players.white ? "b" : "p";
    gameStatus.textContent = `Você joga com as ${
      myColor === "b" ? "Brancas" : "Pretas"
    }.`;
    if (myColor === 'p') {
      boardElement.classList.add('board-flipped');
    }
    // Não toca som no gameStart, apenas atualiza o estado inicial
    boardState = gameState.boardState;
    renderPieces();
    turnDisplay.textContent =
      gameState.currentPlayer === "b" ? "Brancas" : "Pretas";
  });
  socket.on("timerUpdate", (data) => {
    timerDisplay.textContent = data.timeLeft;
  });

  // O "gameStateUpdate" agora é a ÚNICA fonte de atualização e som
  socket.on("gameStateUpdate", (gameState) => {
    updateGame(gameState);
  });

  socket.on("invalidMove", (data) => {
    alert(data.message);
  });
  socket.on("opponentConnectionLost", (data) => {
    connectionLostMessage.textContent = `Conexão do oponente lenta, aguarde ${data.waitTime} segundos para a conexão restabelecer...`;
    connectionLostOverlay.classList.remove("hidden");
  });
  socket.on("gameResumed", (data) => {
    connectionLostOverlay.classList.add("hidden");
    updateGame(data.gameState);
    timerDisplay.textContent = data.timeLeft;

    myColor = socket.id === data.gameState.players.white ? "b" : "p";
    boardElement.classList.remove('board-flipped');
    if (myColor === 'p') {
      boardElement.classList.add('board-flipped');
    }
  });
  socket.on("opponentDisconnected", (data) => {
    returnToLobby();
  });
  socket.on("gameOver", (data) => {
    connectionLostOverlay.classList.add("hidden");
    if (data.reason) {
      console.log("Fim de jogo:", data.reason);
    }
    overlay.classList.remove("hidden");
    if (data.winner === myColor) {
      winnerScreen.classList.remove("hidden");
    } else {
      loserScreen.classList.remove("hidden");
    }
  });
  socket.on("gameDraw", (data) => {
    connectionLostOverlay.classList.add("hidden");
    if (drawReason) drawReason.textContent = data.reason;
    overlay.classList.remove("hidden");
    if (drawScreen) drawScreen.classList.remove("hidden");
  });

  socket.on("showValidMoves", (moves) => {
    moves.forEach(move => {
        const square = document.querySelector(`.square[data-row='${move.row}'][data-col='${move.col}']`);
        if (square) {
            square.classList.add('valid-move-highlight');
        }
    });
  });

  socket.on("updateSaldo", (data) => {
    if (currentUser) {
      currentUser.saldo = data.newSaldo;
    }
  });
  document.getElementById("play-again-btn-winner").addEventListener("click", () => {
    returnToLobby();
  });
  document.getElementById("play-again-btn-loser").addEventListener("click", () => {
    returnToLobby();
  });
  if (document.getElementById("draw-play-again-btn")) {
    document.getElementById("draw-play-again-btn").addEventListener("click", () => {
      returnToLobby();
    });
  }
  socket.on("connect", () => {
    console.log("Conectado ao servidor com o ID:", socket.id);
    const savedRoom = localStorage.getItem("checkersCurrentRoom");
    if (currentUser && !waitingArea.classList.contains("hidden")) {
      const roomCode = roomCodeDisplay.textContent;
      if (roomCode) {
        socket.emit("rejoinWaitingRoom", { roomCode, user: currentUser });
      }
    } else if (currentUser && savedRoom) {
      currentRoom = savedRoom;
      socket.emit('rejoinActiveGame', { roomCode: currentRoom, user: currentUser });
      authContainer.classList.add("hidden");
      lobbyContainer.classList.add("hidden");
      gameContainer.classList.remove("hidden");
      createBoard();
    }
  });

  socket.on("gameNotFound", () => {
    alert("A partida anterior não foi encontrada. O tempo para reconexão pode ter expirado. A voltar para o lobby...");
    returnToLobby();
  });
  
  checkSession();
});
