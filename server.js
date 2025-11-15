const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// dossier JSON
const enigmesPath = path.join(__dirname, "data", "enigmes.json");

// Fonction utilitaires JSON
function loadEnigmes() {
  try {
    return JSON.parse(fs.readFileSync(enigmesPath, "utf8"));
  } catch (e) {
    return { rapide: [], enigme: [], question: [], musique: [], finale: [] };
  }
}

function saveEnigmes(data) {
  fs.writeFileSync(enigmesPath, JSON.stringify(data, null, 2));
}

// permettre POST JSON si nécessaire
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Fichiers statiques
app.use(express.static("public"));

// Routes HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "joueur.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// =========================
//  ÉTAT DE LA PARTIE
// =========================

const players = {};
let buzzerLocked = false;
let activeBuzz = null;
let buzzTimeout = null;

io.on("connection", (socket) => {
  console.log("🔗 Nouveau client :", socket.id);

  // =========================
  //  🔥 GESTION DES ÉNIGMES JSON
  // =========================

  // Admin demande les énigmes d’une catégorie
  socket.on("requestEnigmas", (category) => {
    const data = loadEnigmes();
    const list = data[category] || [];
    socket.emit("sendEnigmas", list);
  });

  // Admin sauvegarde une nouvelle énigme créée
  socket.on("saveEnigma", (newData) => {
    const data = loadEnigmes();

    if (!data[newData.category]) data[newData.category] = [];

    data[newData.category].push({
      theme: newData.theme,
      texte: newData.texte
    });

    saveEnigmes(data);

    console.log(`💾 Nouvelle énigme ajoutée dans ${newData.category}`);
  });

  // Admin demande à supprimer l’énigme jouée
  socket.on("removeEnigma", ({ category, texte }) => {
    const data = loadEnigmes();
    if (!data[category]) return;

    // filtre
    const before = data[category].length;
    data[category] = data[category].filter(e => e.texte !== texte);

    saveEnigmes(data);

    console.log(`🗑️ Énigme supprimée (${before} → ${data[category].length})`);
  });

  // =========================
  //  Plateau admin
  // =========================

  socket.on("updateBoard", (data) => {
    io.emit("boardUpdate", data);
  });

  socket.on("revealLetters", (letters) => io.emit("revealLetters", letters));
  socket.on("revealAll", () => io.emit("revealAll"));
  socket.on("playSound", (id) => io.emit("playSound", id));
  socket.on("letterError", () => io.emit("letterError"));

  socket.on("startCountdown", () => {
    io.emit("startCountdown");
  });

  // =========================
  //  INSCRIPTION JOUEUR
  // =========================

  socket.on("registerPlayer", ({ name, color, role }) => {
    if (role === "spectator") {
      players[socket.id] = { name, role: "spectator" };
    } else {
      if (!color) return;
      players[socket.id] = { name, color, role: "player" };
    }

    io.emit("playersUpdate", Object.values(players));
  });

  // =========================
  //  SYSTÈME DE BUZZER
  // =========================

  socket.on("buzz", () => {
    const p = players[socket.id];
    if (!p || p.role !== "player" || buzzerLocked) return;

    buzzerLocked = true;
    activeBuzz = socket.id;

    io.emit("buzzed", { playerName: p.name, color: p.color });
    io.emit("playSound", "buzz-sound");
    io.emit("lockOtherBuzzers", socket.id);

    clearTimeout(buzzTimeout);
    buzzTimeout = setTimeout(() => {
      io.emit("letterError");
      io.emit("reactivateBuzzers", { exclude: socket.id });
      buzzerLocked = false;
      activeBuzz = null;
    }, 5000);
  });

  socket.on("validateBuzz", () => {
    clearTimeout(buzzTimeout);
    buzzerLocked = false;
    activeBuzz = null;
    io.emit("resetBuzzers");
  });

  socket.on("invalidateBuzz", () => {
    io.emit("letterError");
    io.emit("reactivateBuzzers", { exclude: activeBuzz });
    clearTimeout(buzzTimeout);
    buzzerLocked = false;
    activeBuzz = null;
  });

  socket.on("resetBuzzers", () => {
    buzzerLocked = false;
    activeBuzz = null;
    clearTimeout(buzzTimeout);
    io.emit("resetBuzzers");
  });

  // =========================
  //  Déconnexion
  // =========================

  socket.on("disconnect", () => {
    const p = players[socket.id];
    if (p) {
      delete players[socket.id];
      io.emit("playersUpdate", Object.values(players));
    }
  });
});

// =========================
//  Lancement serveur
// =========================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur en ligne sur http://localhost:${PORT}`);
});
