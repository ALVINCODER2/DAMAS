// public/js/auth.js - Gerencia Login, Cadastro, Perfil e Sessão

window.initAuth = function (socket, UI) {
  // Função para forçar a criação de username (se não tiver)
  function enforceUsernameRequirement() {
    if (
      window.currentUser &&
      (!window.currentUser.username ||
        window.currentUser.username.trim() === "")
    ) {
      const profileOverlay = document.getElementById("profile-overlay");
      const closeBtn = document.getElementById("close-profile-btn");
      const msg = document.getElementById("profile-message");
      const usernameInput = document.getElementById("profile-username-input");
      const preview = document.getElementById("profile-preview-img");

      if (profileOverlay) profileOverlay.classList.remove("hidden");
      if (closeBtn) closeBtn.style.display = "none";
      if (msg) {
        msg.innerHTML =
          "<i class='fa-solid fa-circle-exclamation'></i> Defina um Apelido para continuar.";
        msg.style.color = "#f1c40f";
        msg.style.fontWeight = "bold";
      }
      if (usernameInput) usernameInput.focus();
      if (preview && (!preview.src || preview.src === "")) {
        preview.src = `https://ui-avatars.com/api/?name=User&background=random`;
      }
    }
  }

  // --- LÓGICA DE URL (REF CODE) ---
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get("ref");
  const referralInput = document.getElementById("referral-code-input");

  if (refCode && referralInput) {
    try {
      referralInput.value = atob(refCode);
    } catch (e) {
      referralInput.value = refCode;
    }
    const inputGroup = referralInput.closest(".input-group");
    if (inputGroup) inputGroup.style.display = "none";
    else referralInput.style.display = "none";

    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    if (loginForm) loginForm.style.display = "none";
    if (registerForm) registerForm.style.display = "block";
  }

  // --- ALTERNAR ENTRE LOGIN E CADASTRO ---
  const showRegisterBtn = document.getElementById("show-register");
  if (showRegisterBtn) {
    showRegisterBtn.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("login-form").style.display = "none";
      document.getElementById("register-form").style.display = "block";
      document.getElementById("auth-message").textContent = "";
    });
  }

  const showLoginBtn = document.getElementById("show-login");
  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("register-form").style.display = "none";
      document.getElementById("login-form").style.display = "block";
      document.getElementById("auth-message").textContent = "";
    });
  }

  // --- SUBMIT CADASTRO ---
  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("register-email").value;
      const password = document.getElementById("register-password").value;
      const referralCode = document.getElementById(
        "referral-code-input"
      )?.value;

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
          msg.style.color = "#2ecc71";
          setTimeout(() => {
            if (showLoginBtn) showLoginBtn.click();
          }, 2000);
        } else {
          msg.style.color = "#e74c3c";
        }
      } catch (error) {
        document.getElementById("auth-message").textContent =
          "Erro de conexão.";
      }
    });
  }

  // --- SUBMIT LOGIN ---
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
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
          window.currentUser = data.user;
          localStorage.setItem("checkersUserEmail", window.currentUser.email);

          document.getElementById("auth-container").style.display = "none";
          document.getElementById("lobby-container").classList.remove("hidden");

          // Chama funções globais definidas no lobby.js
          if (window.updateLobbyWelcome) window.updateLobbyWelcome();
          if (window.updateTournamentStatus) window.updateTournamentStatus();

          socket.connect();
          enforceUsernameRequirement();
        } else {
          const msg = document.getElementById("auth-message");
          msg.textContent = data.message;
          msg.style.color = "#e74c3c";
        }
      } catch (error) {
        document.getElementById("auth-message").textContent =
          "Erro de conexão.";
      }
    });
  }

  // --- LOGOUT ---
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("checkersUserEmail");
      localStorage.removeItem("checkersCurrentRoom");
      // Para o timer se existir (função global)
      if (window.stopTournamentTimer) window.stopTournamentTimer();
      window.location.reload();
    });
  }

  // --- PERFIL ---
  const openProfileBtn = document.getElementById("open-profile-btn");
  const closeProfileBtn = document.getElementById("close-profile-btn");
  const saveProfileBtn = document.getElementById("save-profile-btn");
  const profileOverlay = document.getElementById("profile-overlay");
  const avatarInput = document.getElementById("profile-avatar-input");
  const usernameInput = document.getElementById("profile-username-input");
  const profilePreview = document.getElementById("profile-preview-img");
  const profileMsg = document.getElementById("profile-message");

  if (openProfileBtn) {
    openProfileBtn.addEventListener("click", () => {
      if (!window.currentUser) return;
      profileOverlay.classList.remove("hidden");
      if (window.currentUser.username) {
        if (closeProfileBtn) closeProfileBtn.style.display = "block";
      } else {
        if (closeProfileBtn) closeProfileBtn.style.display = "none";
      }
      usernameInput.value = window.currentUser.username || "";
      avatarInput.value = window.currentUser.avatar || "";
      const defaultAvatar = `https://ui-avatars.com/api/?name=${
        window.currentUser.username || "User"
      }&background=random`;
      profilePreview.src = window.currentUser.avatar || defaultAvatar;
      profileMsg.textContent = "";
    });
  }
  if (closeProfileBtn) {
    closeProfileBtn.addEventListener("click", () =>
      profileOverlay.classList.add("hidden")
    );
  }
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", async () => {
      if (!window.currentUser) return;
      const newUsername = usernameInput.value.trim();
      const newAvatar = avatarInput.value.trim();
      if (!newUsername) {
        profileMsg.textContent = "O nome não pode ficar vazio.";
        profileMsg.style.color = "#e74c3c";
        return;
      }
      saveProfileBtn.disabled = true;
      saveProfileBtn.textContent = "Salvando...";
      try {
        const res = await fetch("/api/user/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: window.currentUser.email,
            username: newUsername,
            avatar: newAvatar,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          window.currentUser = data.user;
          if (window.updateLobbyWelcome) window.updateLobbyWelcome();
          profileMsg.textContent = "Perfil atualizado!";
          profileMsg.style.color = "#2ecc71";
          if (closeProfileBtn) closeProfileBtn.style.display = "block";
          setTimeout(() => profileOverlay.classList.add("hidden"), 1500);
        } else {
          profileMsg.textContent = data.message;
          profileMsg.style.color = "#e74c3c";
        }
      } catch (err) {
        profileMsg.textContent = "Erro de conexão.";
        profileMsg.style.color = "#e74c3c";
      } finally {
        saveProfileBtn.disabled = false;
        saveProfileBtn.textContent = "Salvar";
      }
    });
  }

  // --- CHECK SESSION ---
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
          document.getElementById("auth-container").style.display = "none";
          document.getElementById("lobby-container").classList.remove("hidden");

          if (window.updateLobbyWelcome) window.updateLobbyWelcome();
          if (window.updateTournamentStatus) window.updateTournamentStatus();

          socket.connect();
          enforceUsernameRequirement();
        } else {
          localStorage.removeItem("checkersUserEmail");
        }
      } catch (error) {
        console.log("Offline or error");
      }
    }
  }

  // Inicia verificação de sessão
  checkSession();

  // Torna a função global para uso em outros lugares se necessário
  window.checkSession = checkSession;
  window.enforceUsernameRequirement = enforceUsernameRequirement;
};
