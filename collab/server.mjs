import http from "node:http";
import express from "express";
import { Server as SocketIO } from "socket.io";

const app = express();
const port = Number(process.env.PORT) || 3002;
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : true;

app.get("/", (_req, res) => {
  res.type("text").send("Peerboard canvas sync is up");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new SocketIO(server, {
  transports: ["websocket", "polling"],
  cors: {
    allowedHeaders: ["Content-Type", "Authorization"],
    origin: corsOrigin,
    credentials: true,
  },
  allowEIO3: true,
});

io.on("connection", (socket) => {
  socket.emit("init-room");

  socket.on("join-room", async (roomID) => {
    if (typeof roomID !== "string" || !roomID) {
      return;
    }
    await socket.join(roomID);
    const sockets = await io.in(roomID).fetchSockets();
    if (sockets.length <= 1) {
      socket.emit("first-in-room");
    } else {
      socket.broadcast.to(roomID).emit("new-user", socket.id);
    }
    io.in(roomID).emit(
      "room-user-change",
      sockets.map((item) => item.id),
    );
  });

  socket.on("server-broadcast", (roomID, encryptedData, iv) => {
    if (typeof roomID !== "string") {
      return;
    }
    socket.broadcast.to(roomID).emit("client-broadcast", encryptedData, iv);
  });

  socket.on("server-volatile-broadcast", (roomID, encryptedData, iv) => {
    if (typeof roomID !== "string") {
      return;
    }
    socket.volatile.broadcast
      .to(roomID)
      .emit("client-broadcast", encryptedData, iv);
  });

  socket.on("disconnecting", async () => {
    for (const roomID of socket.rooms) {
      if (roomID === socket.id) {
        continue;
      }
      const others = (await io.in(roomID).fetchSockets()).filter(
        (item) => item.id !== socket.id,
      );
      if (others.length > 0) {
        socket.broadcast.to(roomID).emit(
          "room-user-change",
          others.map((item) => item.id),
        );
      }
    }
  });
});

server.listen(port, () => {
  console.log(`Canvas sync listening on ${port}`);
});
