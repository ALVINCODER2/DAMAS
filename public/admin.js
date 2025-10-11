document.addEventListener("DOMContentLoaded", () => {
  // Elementos do DOM
  const authContainer = document.getElementById("auth-admin-container");
  const adminContainer = document.getElementById("admin-container");
  const secretForm = document.getElementById("secret-form");
  const secretKeyInput = document.getElementById("secret-key-input");
  const authMessage = document.getElementById("auth-admin-message");
  const searchInput = document.getElementById("search-input");
  const usersTableBody = document.querySelector("#users-table tbody");

  let adminSecretKey = null;
  let allUsers = []; 

  // 1. Lida com o formulário de autenticação
  secretForm.addEventListener("submit", (e) => {
    e.preventDefault();
    adminSecretKey = secretKeyInput.value;
    if (!adminSecretKey) {
      authMessage.textContent = "Por favor, insira a senha.";
      authMessage.style.color = "red";
      return;
    }
    loadUsers();
  });

  // 2. Função para carregar os utilizadores do servidor
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
      if (!response.ok) {
        throw new Error("Falha ao carregar utilizadores.");
      }
      
      authContainer.classList.add("hidden");
      adminContainer.classList.remove("hidden");

      allUsers = await response.json();
      renderTable(allUsers); 

    } catch (error) {
      authMessage.textContent = `Erro: ${error.message}`;
      authMessage.style.color = "red";
    }
  }

  // 3. Função para renderizar (desenhar) a tabela de utilizadores
  function renderTable(users) {
    usersTableBody.innerHTML = ""; 
    users.forEach((user) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${user.email}</td>
        <td data-email="${user.email}">
          <span>${user.saldo}</span>
        </td>
        <td>
          <button class="edit-btn" data-email="${user.email}">Editar</button>
          <button class="delete-btn" data-email="${user.email}" style="background-color: #c0392b;">Excluir</button>
        </td>
      `;
      usersTableBody.appendChild(row);
    });
  }

  // 4. Lida com os cliques na tabela (para os botões "Editar" e "Excluir")
  usersTableBody.addEventListener("click", (e) => {
    const target = e.target;
    const email = target.dataset.email;

    if (target.classList.contains("edit-btn")) {
      handleEdit(email);
    }
    if (target.classList.contains("delete-btn")) {
      handleDelete(email);
    }
  });
  
  // 5. Função para editar o saldo
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

  // 6. Função para salvar o novo saldo no servidor
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
      if (!response.ok) throw new Error(data.message || "Falha ao atualizar saldo.");
      
      alert(data.message);
      loadUsers();

    } catch (error) {
      alert(`Erro: ${error.message}`);
    }
  }

  // 7. Função para excluir utilizador
  async function handleDelete(email) {
    if (!confirm(`Tem a certeza que deseja excluir o utilizador ${email}? Esta ação não pode ser desfeita.`)) {
      return;
    }
    
    try {
      const response = await fetch(`/api/admin/user/${email}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: adminSecretKey })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Falha ao excluir utilizador.');
      }

      alert(data.message);
      loadUsers();

    } catch (error) {
      alert(`Erro: ${error.message}`);
    }
  }

  // 8. Funcionalidade de pesquisa
  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filteredUsers = allUsers.filter(user => 
      user.email.toLowerCase().includes(searchTerm)
    );
    renderTable(filteredUsers);
  });

  // 9. LÓGICA PARA O BOTÃO DE ZERAR SALDOS
  const resetAllSaldosBtn = document.getElementById("reset-all-saldos-btn");

  if (resetAllSaldosBtn) {
      resetAllSaldosBtn.addEventListener("click", async () => {
          if (!confirm("TEM A CERTEZA ABSOLUTA?\nEsta ação irá zerar o saldo de TODOS os utilizadores e não pode ser desfeita.")) {
              return;
          }
          if (!confirm("Último aviso: Confirma que deseja zerar o saldo de todos os utilizadores?")) {
              return;
          }

          try {
              const response = await fetch('/api/admin/reset-all-saldos', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ secret: adminSecretKey })
              });

              const data = await response.json();

              if (!response.ok) {
                  throw new Error(data.message || 'Falha ao executar a operação.');
              }

              alert(data.message);
              loadUsers();

          } catch (error) {
              alert(`Erro: ${error.message}`);
          }
      });
  }
});
