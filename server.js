const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({
  origin: "https://chatyou-pi.vercel.app"
}));
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "https://chatyou-pi.vercel.app", // ✅ Replace with your actual Vercel URL
    methods: ["GET", "POST"],
  },
});

let waitingUser = null;
const pairs = {}; // socketId -> partnerId

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // ─── Find a stranger ───────────────────────────────────────────────
  socket.on("find-stranger", () => {
    console.log("Find stranger:", socket.id);

    if (pairs[socket.id]) {
      console.log("Already paired, ignoring:", socket.id);
      return;
    }

    if (waitingUser === socket.id) {
      console.log("Already waiting:", socket.id);
      return;
    }

    if (waitingUser) {
      const partner = waitingUser;
      waitingUser = null; // clear BEFORE emitting to avoid race condition

      pairs[socket.id] = partner;
      pairs[partner] = socket.id;

      // The user who waited longest is the WebRTC initiator (creates offer)
      io.to(partner).emit("stranger-found", { strangerId: socket.id, initiator: true });
      io.to(socket.id).emit("stranger-found", { strangerId: partner, initiator: false });

      console.log("Matched:", socket.id, "<->", partner);
    } else {
      waitingUser = socket.id;
      socket.emit("waiting");
      console.log("Waiting:", socket.id);
    }
  });

  // ─── WebRTC signaling relay ────────────────────────────────────────
  socket.on("webrtc-offer", (offer) => {
    const partner = pairs[socket.id];
    if (partner) io.to(partner).emit("webrtc-offer", offer);
  });

  socket.on("webrtc-answer", (answer) => {
    const partner = pairs[socket.id];
    if (partner) io.to(partner).emit("webrtc-answer", answer);
  });

  socket.on("webrtc-ice-candidate", (candidate) => {
    const partner = pairs[socket.id];
    if (partner) io.to(partner).emit("webrtc-ice-candidate", candidate);
  });

  // ─── Chat ──────────────────────────────────────────────────────────
  socket.on("chat-message", (message) => {
    const partner = pairs[socket.id];
    if (partner) {
      io.to(partner).emit("chat-message", { sender: "Stranger", text: message });
    }
  });

  // ─── Skip to next stranger ─────────────────────────────────────────
  socket.on("next-stranger", () => {
    console.log("Next stranger:", socket.id);

    const partner = pairs[socket.id];
    if (partner) {
      io.to(partner).emit("partner-disconnected");
      delete pairs[partner];
      delete pairs[socket.id];
    }

    if (waitingUser === socket.id) waitingUser = null;

    socket.emit("next-ready");
  });

  // ─── Disconnect ────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Clean up waiting queue if this user was still waiting
    if (waitingUser === socket.id) {
      waitingUser = null;
    }

    const partner = pairs[socket.id];
    if (partner) {
      io.to(partner).emit("partner-disconnected");
      delete pairs[partner];
      delete pairs[socket.id];
    }
  });
});

server.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});