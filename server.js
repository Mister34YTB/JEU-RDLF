const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Sert les fichiers statiques
app.use(express.static("public"));

// Routes HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "joueur.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// --- ETAT PARTIE ---
const players = {};          // { socket.id: { name, color } }
let buzzerLocked = false;    // un seul buzz actif à la fois
let activeBuzz = null;       // socket.id du joueur qui a buzzé
let buzzTimeout = null;      // timer 5s

io.on("connection", (socket) => {
  console.log("🔗 Un client s’est connecté", socket.id);

  // === ADMIN -> tous : mise à jour du tableau ===
  socket.on("updateBoard", (data) => {
    console.log("📢 Mise à jour du tableau :", data.theme);
    io.emit("boardUpdate", data);
  });

  // === Relais events généraux ===
  socket.on("revealLetters", (letters) => io.emit("revealLetters", letters));
  socket.on("revealAll", () => io.emit("revealAll"));
  socket.on("playSound", (id) => io.emit("playSound", id));
  socket.on("letterError", () => io.emit("letterError"));
  socket.on("startCountdown", () => io.emit("startCountdown"));

  // === JOUEUR -> serveur : inscription ===
  socket.on("registerPlayer", ({ name, color }) => {
    if (!name || !color) return;
    players[socket.id] = { name, color };
    console.log(`✅ Joueur inscrit : ${name} (${color})`);
    io.emit("playersUpdate", Object.values(players));
  });

  // === JOUEUR -> serveur : buzz ===
  socket.on("buzz", () => {
    const p = players[socket.id];
    if (!p) return;
    if (buzzerLocked) return;

    buzzerLocked = true;
    activeBuzz = socket.id;

    console.log(`🚨 ${p.name} a buzzé (${p.color}) !`);

    // Envoi à tout le monde
    io.emit("buzzed", { playerName: p.name, color: p.color });

    // 🔊 Son buzz
    io.emit("playSound", "buzz-sound");

    // 🔒 Désactiver les autres
    io.emit("lockOtherBuzzers", socket.id);

    // Timer 5s
    clearTimeout(buzzTimeout);
    buzzTimeout = setTimeout(() => {
      console.log(`⏱ Temps écoulé pour ${p.name}, mauvaise réponse auto`);
      io.emit("letterError");
      io.emit("reactivateBuzzers", { exclude: socket.id });
      buzzerLocked = false;
      activeBuzz = null;
    }, 5000);
  });

  // === ADMIN -> valide le buzz ===
  socket.on("validateBuzz", () => {
    if (activeBuzz) {
      console.log(`✅ Réponse validée pour ${players[activeBuzz]?.name}`);
    }
    clearTimeout(buzzTimeout);
    buzzerLocked = false;
    activeBuzz = null;
    io.emit("resetBuzzers"); // tout le monde réactivé
  });

  // === ADMIN -> invalide le buzz ===
  socket.on("invalidateBuzz", () => {
    if (activeBuzz) {
      console.log(`❌ Mauvaise réponse forcée pour ${players[activeBuzz]?.name}`);
      io.emit("letterError");
      io.emit("reactivateBuzzers", { exclude: activeBuzz }); // réactiver sauf le fautif
    }
    clearTimeout(buzzTimeout);
    buzzerLocked = false;
    activeBuzz = null;
  });

  // === ADMIN -> reset buzzers ===
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
      console.log(`❌ ${p.name} s’est déconnecté`);
      delete players[socket.id];
      io.emit("playersUpdate", Object.values(players));
    }
  });
});

// ✅ Compatible Render (PORT dynamique)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
