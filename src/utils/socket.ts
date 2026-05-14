import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";

let io: SocketServer;

export const initSocket = (server: HttpServer) => {
  io = new SocketServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // ✅ JWT Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization;

    if (!token) {
      return next(new Error("Authentication error: Token missing"));
    }

    try {
      const cleanToken = token.replace("Bearer ", "");
      const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET as string) as any;
      socket.data.userId = decoded.userId || decoded.id;
      next();
    } catch {
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    console.log(`🔌 User connected: ${userId} (Socket ID: ${socket.id})`);

    // ✅ Join user to a private room based on their userId
    socket.join(userId);

    socket.on("join_conversation", (conversationId: string) => {
      console.log(`👤 User ${userId} joined conversation: ${conversationId}`);
      socket.join(`conversation_${conversationId}`);
    });

    socket.on("leave_conversation", (conversationId: string) => {
      console.log(`👤 User ${userId} left conversation: ${conversationId}`);
      socket.leave(`conversation_${conversationId}`);
    });

    socket.on("disconnect", () => {
      console.log(`❌ User disconnected: ${userId}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

/**
 * Emit an event to all users with a specific role
 * @param userIds List of user IDs to notify
 * @param event Event name
 * @param data Payload
 */
export const emitToUsers = (userIds: string[], event: string, data: any) => {
  if (!io) return;
  userIds.forEach((id) => {
    io.to(id).emit(event, data);
  });
};
/**
 * Check if a user is currently in a specific conversation room
 */
export const isUserInConversation = (userId: string, conversationId: string): boolean => {
  if (!io) return false;
  const roomName = `conversation_${conversationId}`;
  const room = io.sockets.adapter.rooms.get(roomName);
  if (!room) return false;

  const userSockets = io.sockets.adapter.rooms.get(userId);
  if (!userSockets) return false;

  for (const socketId of userSockets) {
    if (room.has(socketId)) return true;
  }
  return false;
};
