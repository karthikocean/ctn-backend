import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { Conversation } from "../entity/Conversation";
import { ObjectId } from "mongodb";

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
    console.log(`🔑 Socket Auth Attempt - Token present: ${!!token}`);

    if (!token) {
      console.error("❌ Socket Auth Failed: Token missing");
      return next(new Error("Authentication error: Token missing"));
    }

    try {
      const cleanToken = token.replace("Bearer ", "");
      const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET as string) as any;
      const userId = decoded.userId || decoded.id;

      if (!userId) {
        console.error("❌ Socket Auth Failed: No userId in token payload", decoded);
        return next(new Error("Authentication error: Invalid token payload"));
      }

      socket.data.userId = userId;
      console.log(`✅ Socket Auth Success for userId: ${userId}`);
      next();
    } catch (err: any) {
      console.error(`❌ Socket Auth Failed: ${err.message}`);
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId;
    console.log(`🔌 User connected: ${userId} (Socket ID: ${socket.id})`);

    if (!userId) {
      console.error("❌ Connection accepted but userId is missing in socket.data");
      return;
    }

    // ✅ Join user to a private room based on their userId
    socket.join(userId);

    // ✅ Update Online Status in DB
    try {
      if (ObjectId.isValid(userId)) {
        const memberRepo = AppDataSource.getMongoRepository(Member);
        await memberRepo.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { isOnline: true } }
        );
        // ✅ Broadcast to all users
        io.emit("user_online", { userId });
        console.log(`📡 Broadcasted user_online for ${userId}`);

        // ✅ Notify conversation partners
        await notifyStatusChange(userId, true);
      } else {
        console.error(`❌ Invalid ObjectId format for userId: ${userId}`);
      }
    } catch (error) {
      console.error(`❌ Error updating online status for ${userId}:`, error);
    }

    socket.on("join_conversation", (conversationId: string) => {
      console.log(`👤 User ${userId} joined conversation: ${conversationId}`);
      socket.join(`conversation_${conversationId}`);
    });

    socket.on("leave_conversation", (conversationId: string) => {
      console.log(`👤 User ${userId} left conversation: ${conversationId}`);
      socket.leave(`conversation_${conversationId}`);
    });

    socket.on("disconnect", async (reason) => {
      console.log(`❌ User disconnected: ${userId}, Reason: ${reason}`);

      try {
        // Check if user has other active connections
        const activeSockets = await io.in(userId).fetchSockets();
        console.log(`📉 Remaining active sockets for ${userId}: ${activeSockets.length}`);

        if (activeSockets.length === 0) {
          if (ObjectId.isValid(userId)) {
            const memberRepo = AppDataSource.getMongoRepository(Member);
            await memberRepo.updateOne(
              { _id: new ObjectId(userId) },
              { $set: { isOnline: false } }
            );
            // ✅ Broadcast to all users
            io.emit("user_offline", { userId });
            console.log(`📡 Broadcasted user_offline for ${userId}`);

            // ✅ Notify conversation partners
            await notifyStatusChange(userId, false);
          }
        }
      } catch (error) {
        console.error(`❌ Error updating offline status for ${userId}:`, error);
      }
    });
  });

  return io;
};

const notifyStatusChange = async (userId: string, isOnline: boolean) => {
  if (!io) return;
  try {
    const conversationRepo = AppDataSource.getMongoRepository(Conversation);
    const conversations = await conversationRepo.find({
      where: { participants: { $all: [new ObjectId(userId)] } } as any
    });

    conversations.forEach((conv) => {
      const otherParticipant = conv.participants.find((p) => !p.equals(new ObjectId(userId)));
      if (otherParticipant) {
        io.to(otherParticipant.toString()).emit("user_status_changed", {
          userId,
          isOnline
        });
      }
    });
  } catch (error) {
    console.error(`❌ Error notifying status change for ${userId}:`, error);
  }
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
