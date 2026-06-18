import "dotenv/config";
import http from "http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import app from "./src/app.mjs";

const PORT = process.env.PORT || 4000;

async function start() {
  const mongoUri = "mongodb+srv://webmaster:webmaster@cluster0.octxyt3.mongodb.net/?appName=Cluster0";
  if (!mongoUri) {
    console.error("MONGODB_URI not set in environment");
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri, { dbName: "kizfarm" });
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }

  const server = http.createServer(app);
  
  // Initialize Socket.io
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST"],
    },
  });

  // Store active users
  const activeUsers = new Map();

  io.on("connection", (socket) => {
    console.log("New user connected:", socket.id);

    // User joins socket room with their ID
    socket.on("user_online", (userId) => {
      activeUsers.set(userId, socket.id);
      socket.join(`user_${userId}`);
      io.emit("user_status", { userId, status: "online" });
    });

    // Send message event
    socket.on("send_message", async (data) => {
      const { chatId, message } = data;
      io.to(`chat_${chatId}`).emit("new_message", message);
    });

    // Read receipt event
    socket.on("messages_read", (data) => {
      const { chatId, messageIds, readerId } = data;
      socket.to(`chat_${chatId}`).emit("messages_read", { chatId, messageIds, readerId });
    });

    // User typing
    socket.on("typing", (data) => {
      const { chatId, userId, userName } = data;
      socket.to(`chat_${chatId}`).emit("user_typing", { userId, userName });
    });

    // Stop typing
    socket.on("stop_typing", (data) => {
      const { chatId, userId } = data;
      socket.to(`chat_${chatId}`).emit("user_stop_typing", { userId });
    });

    // Join chat room
    socket.on("join_chat", (chatId) => {
      socket.join(`chat_${chatId}`);
    });

    // Leave chat room
    socket.on("leave_chat", (chatId) => {
      socket.leave(`chat_${chatId}`);
    });

    // User disconnects
    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Find and remove user from active users
      for (const [userId, socketId] of activeUsers.entries()) {
        if (socketId === socket.id) {
          activeUsers.delete(userId);
          io.emit("user_status", { userId, status: "offline" });
          break;
        }
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

start();
