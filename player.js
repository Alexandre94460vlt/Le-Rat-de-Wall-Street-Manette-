const socket = io("https://le-rat-de-wall-street-server.onrender.com");

// --- DOM Elements ---
const joinSection = document.getElementById("join-section");
const waitingSection = document.getElementById("waiting-section");
const gameSection = document.getElementById("game-section");

const nameInput = document.getElementById("name-input");
const joinButton = document.getElementById("join-button");

const playerNameDisplay = document.getElementById("player-name-display");
const netWorthDisplay = document.getElementById("net-worth-display");
const walletDisplay = document.getElementById("wallet-display");
const actionsContainer = document.getElementById("actions-container");
const backgroundGraphCanvas = document.getElementById("background-graph");

// --- State ---
let netWorthHistory = [];
let netWorthChart;
let hasSubmittedName = false;
let currentPlayerCash = 0; // Global variable for player's cash
let previousLeaderboard = []; // NOUVEAU : Mémoire du classement

// --- State Management Functions ---
function showState(state) {
  joinSection.style.display = "none";
  waitingSection.style.display = "none";
  gameSection.style.display = "none";

  if (state === "join") joinSection.style.display = "block";
  else if (state === "waiting") waitingSection.style.display = "block";
  else if (state === "game") gameSection.style.display = "block";
}

// --- Chart Functions ---
function initializeChart() {
  if (netWorthChart) netWorthChart.destroy();
  const ctx = backgroundGraphCanvas.getContext("2d");
  netWorthChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Net Worth",
          data: [],
          borderColor: "#FFFFFF", // Solid white color
          borderWidth: 4,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
    },
  });
}

function updateChart(newNetWorth) {
  if (!netWorthChart) return;
  const now = new Date();
  netWorthHistory.push({ time: now, value: newNetWorth });
  const oneMinuteAgo = now.getTime() - 60000;
  netWorthHistory = netWorthHistory.filter(
    (point) => point.time.getTime() > oneMinuteAgo,
  );
  netWorthChart.data.labels = netWorthHistory.map((p) => p.time);
  netWorthChart.data.datasets[0].data = netWorthHistory.map((p) => p.value);
  netWorthChart.update("none");
}

// --- Socket Event Handlers ---
socket.on("connect", () => {
  if (hasSubmittedName) {
    // Le serveur a redémarré : on le force à nous réinscrire automatiquement
    socket.emit("player:join", nameInput.value.trim() || "Joueur");
  } else {
    showState("join");
  }
});

socket.on("player:joined", (data) => {
  if (data.isGameOpen) {
    showState("game");
    initializeChart();
  } else {
    showState("waiting");
  }
});

socket.on("player:update", (data) => {
  // Si le joueur est actif mais que l'écran de jeu est caché, on le lance

  if (data.isActive && gameSection.style.display === "none") {
    showState("game");
    initializeChart();
  }
  // Si le jeu est fermé/en attente, on le renvoie dans le lobby
  else if (data.isWaiting && waitingSection.style.display === "none") {
    showState("waiting");
  }

  playerNameDisplay.textContent = data.name || "Player";
  netWorthDisplay.textContent = `${data.totalValue.toLocaleString()} €`;
  walletDisplay.textContent = `Wallet: ${data.cash.toLocaleString()} €`;
  currentPlayerCash = data.cash;
  updateChart(data.totalValue);

  // --- CALCUL DE LA TENDANCE REVOLUT ---
  // On compare le score actuel avec le plus vieux score de l'historique (max 60s)
  let oldNetWorth =
    netWorthHistory.length > 0 ? netWorthHistory[0].value : data.totalValue;
  let diff = data.totalValue - oldNetWorth;
  let diffPercent = oldNetWorth > 0 ? (diff / oldNetWorth) * 100 : 0;

  const trendDisplay = document.getElementById("net-worth-trend-display");
  if (diff > 0) {
    trendDisplay.innerHTML = `<span class="trend-up">+$${Math.round(diff).toLocaleString()} ▲${Math.abs(diffPercent).toFixed(1)}%</span>`;
  } else if (diff < 0) {
    trendDisplay.innerHTML = `<span class="trend-down">-$${Math.round(Math.abs(diff)).toLocaleString()} ▼${Math.abs(diffPercent).toFixed(1)}%</span>`;
  } else {
    trendDisplay.innerHTML = `<span class="trend-eq">= $0 0%</span>`;
  }

  document.querySelectorAll(".action-card").forEach((card) => {
    // card.dataset.actionName contient déjà le nom complet (ex: "ManqueDo")
    const actionName = card.dataset.actionName;

    // On récupère directement l'objet du portfolio
    const portfolioEntry = data.portfolio[actionName];
    const quantityOwned = portfolioEntry?.quantity || 0;
    const invested = portfolioEntry?.invested || 0;

    const parsedPrice = parseFloat(card.dataset.currentPrice);
    const currentPrice = isNaN(parsedPrice) ? 0 : parsedPrice;

    const currentValue = currentPrice * quantityOwned;
    const gainLoss = quantityOwned > 0 ? currentValue - invested : 0;

    card.querySelector(".action-total-value").textContent =
      `${currentValue.toLocaleString()} €`;
    card.querySelector(".details-quantity").textContent = quantityOwned;
    card.querySelector(".details-invested").textContent =
      invested.toLocaleString() + "€";

    const gainLossEl = card.querySelector(".details-gain-loss");
    gainLossEl.textContent = gainLoss.toFixed(2) + "€";
    gainLossEl.style.color = gainLoss >= 0 ? "#6eff92" : "#ff5757";

    // --- GESTION DES BOUTONS SELL ---
    card.querySelectorAll('button[data-action="sell"]').forEach((button) => {
      const quantityToSell = parseInt(button.dataset.quantity);
      // On peut vendre si on possède au moins la quantité demandée
      const canSell = quantityOwned >= quantityToSell;

      button.disabled = !canSell;
      button.classList.toggle("can-sell", canSell);
    });

    // --- GESTION DES BOUTONS BUY ---
    card.querySelectorAll('button[data-action="buy"]').forEach((button) => {
      const quantityToBuy = parseInt(button.dataset.quantity);
      button.disabled = currentPrice * quantityToBuy > currentPlayerCash;
    });
  });
});

socket.on("game:update", (data) => {
  if (!Array.isArray(data.actions)) return;

  // 1. On liste les noms des actions actuellement affichées sur l'écran du joueur
  const displayedActions = Array.from(actionsContainer.children).map(
    (card) => card.dataset.actionName,
  );

  // 2. On liste les noms des actions envoyées par le serveur
  const serverActions = data.actions.map((a) => a.name);

  // 3. On compare les deux listes
  const isDifferent = displayedActions.join(",") !== serverActions.join(",");

  // Si le tirage a changé (l'admin a cliqué sur Ouvrir), on FORCE la recréation des cartes
  if (isDifferent) {
    actionsContainer.innerHTML = "";
    data.actions.forEach((action) => {
      const card = createActionCard(action);
      actionsContainer.appendChild(card);
    });
  }
  // Sinon, on se contente de mettre à jour les prix de manière fluide
  else {
    data.actions.forEach((action) => {
      const card = document.querySelector(
        `.action-card[data-action-name="${action.name}"]`,
      );
      if (card) {
        const newPrice = action.currentPrice;

        let priceHistory = card.dataset.priceHistory
          ? JSON.parse(card.dataset.priceHistory)
          : [];
        const now = Date.now();
        priceHistory.push({ time: now, price: newPrice });
        const tenSecondsAgo = now - 10000;
        priceHistory = priceHistory.filter((p) => p.time >= tenSecondsAgo);
        card.dataset.priceHistory = JSON.stringify(priceHistory);

        const oldPriceDataPoint = priceHistory[0];
        const oldPrice = oldPriceDataPoint ? oldPriceDataPoint.price : newPrice;

        card.dataset.currentPrice = newPrice;

        card.querySelector(".action-value").textContent =
          `${newPrice.toLocaleString()} €`;
        card.querySelector(".action-price-reminder").textContent =
          `Current Price: ${newPrice.toLocaleString()} €`;

        const tendencyDiv = card.querySelector(".action-tendency");
        if (tendencyDiv) {
          const tendency =
            oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : 0;
          tendencyDiv.classList.remove("up", "down");
          let arrow = "";
          if (tendency > 0.01) {
            tendencyDiv.classList.add("up");
            arrow = " ▲";
          } else if (tendency < -0.01) {
            tendencyDiv.classList.add("down");
            arrow = " ▼";
          }
          tendencyDiv.textContent = `${tendency.toFixed(2)}%${arrow}`;
        }

        card.querySelectorAll('button[data-action="buy"]').forEach((button) => {
          const quantityToBuy = parseInt(button.dataset.quantity);
          button.disabled = newPrice * quantityToBuy > currentPlayerCash;
        });
      }
    });
  }

  //MISE À JOUR DU LEADERBOARD

  if (data.leaderboard) {
    renderLeaderboard(data.leaderboard);
    // On sauvegarde le classement pour calculer les flèches à la seconde suivante
    previousLeaderboard = data.leaderboard;
  }
});

// --- UI Creation and Interaction ---
function createActionCard(action) {
  const card = document.createElement("div");
  card.className = "action-card";
  card.dataset.actionName = action.name;
  card.dataset.currentPrice = action.currentPrice;
  card.dataset.priceHistory = JSON.stringify([]);

  card.innerHTML = `
        <div class="action-header">
            <div>
                <div class="action-name">
                    <span class="nom-long">${action.name}</span>
                    <span class="nom-court">(${action.shortName})</span>
                    
                </div>
                <div class="action-value">${action.currentPrice.toLocaleString()} €</div>
            </div>
            <div style="text-align: right;">
                <div class="action-total-value">0 €</div>
                <div class="action-tendency">0.00%</div>
            </div>
        </div>
        <div class="action-details">
            <div class="details-grid">
                <div class="details-item">
                    <div class="details-label">Owned</div>
                    <div class="details-value details-quantity">0</div>
                </div>
                <div class="details-item">
                    <div class="details-label">Invested</div>
                    <div class="details-value details-invested">0€</div>
                </div>
                <div class="details-item">
                    <div class="details-label">Gain/Loss</div>
                    <div class="details-value details-gain-loss">0.00€</div>
                </div>
            </div>
        </div>
        <div class="action-buttons">
            <div class="button-row">
                <button data-action="buy" data-quantity="1">Buy 1</button>
                <button data-action="buy" data-quantity="5">5</button>
                <button data-action="buy" data-quantity="25">25</button>
                <button data-action="buy" data-quantity="100">100</button>
                <button data-action="buy" data-quantity="1000">1000</button>
            </div>
            <div class="button-row">
                <button class="sell" data-action="sell" data-quantity="1">Sell 1</button>
                <button class="sell" data-action="sell" data-quantity="5">5</button>
                <button class="sell" data-action="sell" data-quantity="25">25</button>
                <button class="sell" data-action="sell" data-quantity="100">100</button>
                <button class="sell" data-action="sell" data-quantity="1000">1000</button>
            </div>
        </div>
        <div class="action-price-reminder">Current Price: ${action.currentPrice.toLocaleString()} €</div>
    `;

  card.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") {
      const wasExpanded = card.classList.contains("is-expanded");
      document.querySelectorAll(".action-card.is-expanded").forEach((c) => {
        c.classList.remove("is-expanded");
      });
      if (!wasExpanded) {
        card.classList.add("is-expanded");
      }
    }
  });

  card.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      if (button.disabled) return;
      const { action, quantity } = button.dataset;
      socket.emit(`player:${action}`, {
        actionName: card.dataset.actionName,
        quantity: parseInt(quantity),
      });
    });
  });

  return card;
}

// --- Initial Setup ---
document.addEventListener("DOMContentLoaded", () => {
  showState("join");

  joinButton.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      alert("Entre un pseudo.");
      return;
    }
    hasSubmittedName = true;
    socket.emit("player:join", name);
  });
});

function renderLeaderboard(currentLeaderboard) {
  const lbContainer = document.getElementById("leaderboard-container");
  if (!lbContainer) return;

  const myId = socket.id;
  let myIndex = currentLeaderboard.findIndex((p) => p.id === myId);

  if (myIndex === -1) return; // Joueur non trouvé dans le classement

  const totalPlayers = currentLeaderboard.length;
  const myRank = myIndex + 1;

  // Calcul de la tendance globale du joueur pour le header
  const myPrevIndex = previousLeaderboard.findIndex((p) => p.id === myId);
  let mainTrendIcon = "=";
  let mainTrendClass = "trend-eq";
  if (myPrevIndex !== -1) {
    if (myIndex < myPrevIndex) {
      mainTrendIcon = "▲";
      mainTrendClass = "trend-up";
    } else if (myIndex > myPrevIndex) {
      mainTrendIcon = "▼";
      mainTrendClass = "trend-down";
    }
  }

  let html = `<div class="lb-header">LEADERBOARD</div>`;
  html += `<div class="lb-subheader"><span class="${mainTrendClass}">${mainTrendIcon}</span> ${myRank}/${totalPlayers}</div>`;

  // Fonction utilitaire pour générer une ligne du tableau
  // Fonction utilitaire pour générer une ligne du tableau
  const generateRow = (player, index) => {
    const rank = index + 1;
    const isMe = player.id === myId;
    const nameDisplay = isMe ? "YOU" : player.name;
    const nameClass = isMe ? "lb-name is-me" : "lb-name";

    // Calcul de la tendance du joueur
    let trendIcon = "=";
    let trendClass = "trend-eq";
    const prevIdx = previousLeaderboard.findIndex((p) => p.id === player.id);

    if (prevIdx !== -1) {
      if (index < prevIdx) {
        trendIcon = "▲";
        trendClass = "trend-up";
      } else if (index > prevIdx) {
        trendIcon = "▼";
        trendClass = "trend-down";
      }
    } else {
      trendIcon = "▲";
      trendClass = "trend-up"; // Nouveau joueur entrant
    }

    const rankDisplay =
      rank === 1
        ? `<span class="crown">👑</span> 1`
        : `<span class="${trendClass}">${trendIcon}</span> ${rank}`;

    // 1. D'ABORD on fait le calcul mathématique sans décimales
    const formattedScore = Math.round(player.totalValue).toLocaleString(
      "fr-FR",
      { maximumFractionDigits: 0 },
    );

    // 2. ENSUITE on renvoie proprement le bloc HTML avec les variables
    return `
            <div class="lb-row">
                <div class="lb-rank">${rankDisplay}</div>
                <div class="${nameClass}">${nameDisplay}</div>
                <div class="lb-score">$${formattedScore}</div>
            </div>
        `;
  };

  // 1. On affiche toujours le TOP 1
  if (currentLeaderboard.length > 0) {
    html += generateRow(currentLeaderboard[0], 0);
  }

  // 2. Les joueurs autour de nous
  // On prend 2 rangs au-dessus, et 2 rangs en-dessous
  let startIdx = Math.max(1, myIndex - 2); // On ne redessine pas le Top 1
  let endIdx = Math.min(totalPlayers - 1, myIndex + 2);

  // Si on est loin du Top 1, on met des pointillés
  if (startIdx > 1) {
    html += `<div class="lb-ellipses">...</div>`;
  }

  for (let i = startIdx; i <= endIdx; i++) {
    html += generateRow(currentLeaderboard[i], i);
  }

  // Si on est loin du dernier joueur, on met des pointillés en bas
  if (endIdx < totalPlayers - 1) {
    html += `<div class="lb-ellipses">...</div>`;
  }

  lbContainer.innerHTML = html;
}
