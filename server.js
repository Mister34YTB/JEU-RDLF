const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Routes HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "joueur.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// --- ÉTAT DE LA PARTIE ---
const players = {}; // { socket.id: { name, color?, role } }
let buzzerLocked = false;
let activeBuzz = null;
let buzzTimeout = null;

io.on("connection", (socket) => {
  console.log("🔗 Nouveau client :", socket.id);

  // ======== ADMIN : Mise à jour du plateau ========
  socket.on("updateBoard", (data) => {
    console.log(`📢 Thème: ${data.theme}`);
    io.emit("boardUpdate", data);
  });

  // === Relais des actions globales ===
  socket.on("revealLetters", (letters) => io.emit("revealLetters", letters));
  socket.on("revealAll", () => io.emit("revealAll"));
  socket.on("playSound", (id) => io.emit("playSound", id));
  socket.on("letterError", () => io.emit("letterError"));

  // === Compte à rebours global ===
  socket.on("startCountdown", () => {
    console.log("⏱️ Début du compte à rebours");
    io.emit("startCountdown");
  });

  // === JOUEUR ou spectateur -> serveur : inscription ===
  socket.on("registerPlayer", ({ name, color, role }) => {
    if (role === "spectator") {
      players[socket.id] = { name, role: "spectator" };
      console.log(`👀 Spectateur inscrit : ${name}`);
    } else {
      if (!color) return;
      players[socket.id] = { name, color, role: "player" };
      console.log(`✅ Joueur inscrit : ${name} (${color})`);
    }

    io.emit("playersUpdate", Object.values(players));
  });

  // === Buzz ===
  socket.on("buzz", () => {
    const p = players[socket.id];
    if (!p || p.role !== "player" || buzzerLocked) return;

    buzzerLocked = true;
    activeBuzz = socket.id;

    console.log(`🚨 ${p.name} a buzzé (${p.color}) !`);
    io.emit("buzzed", { playerName: p.name, color: p.color });
    io.emit("playSound", "buzz-sound");
    io.emit("lockOtherBuzzers", socket.id);

    clearTimeout(buzzTimeout);
    buzzTimeout = setTimeout(() => {
      console.log(`⏱ Temps écoulé pour ${p.name}, mauvaise réponse auto`);
      io.emit("letterError");
      io.emit("reactivateBuzzers", { exclude: socket.id });
      buzzerLocked = false;
      activeBuzz = null;
    }, 5000);
  });

  // === ADMIN : Validation du buzz ===
  socket.on("validateBuzz", () => {
    if (activeBuzz) console.log(`✅ Bonne réponse pour ${players[activeBuzz]?.name}`);
    clearTimeout(buzzTimeout);
    buzzerLocked = false;
    activeBuzz = null;
    io.emit("resetBuzzers");
  });

  // === ADMIN : Mauvaise réponse ===
  socket.on("invalidateBuzz", () => {
    if (activeBuzz) {
      console.log(`❌ Mauvaise réponse pour ${players[activeBuzz]?.name}`);
      io.emit("letterError");
      io.emit("reactivateBuzzers", { exclude: activeBuzz });
    }
    clearTimeout(buzzTimeout);
    buzzerLocked = false;
    activeBuzz = null;
  });

  // === ADMIN : Reset des buzzers ===
  socket.on("resetBuzzers", () => {
    buzzerLocked = false;
    activeBuzz = null;
    clearTimeout(buzzTimeout);
    io.emit("resetBuzzers");
    console.log("🔄 Reset des buzzers");
  });

  // === Déconnexion ===
  socket.on("disconnect", () => {
    const p = players[socket.id];
    if (p) {
      console.log(`❌ ${p.name} (${p.role}) s’est déconnecté`);
      delete players[socket.id];
      io.emit("playersUpdate", Object.values(players));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur en ligne sur http://localhost:${PORT}`);
});
