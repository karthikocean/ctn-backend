import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../data-source";
import { Training } from "../entity/Training";
import { MemberTraining } from "../entity/MemberTraining";
import { LessonProgress } from "../entity/LessonProgress";
import { ObjectId } from "mongodb";
import { Member } from "../entity/Member";
import { Conversation } from "../entity/Conversation";

let io: SocketServer;

export const initSocket = (server: HttpServer) => {
  io = new SocketServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    pingInterval: 10000, // Send ping every 10 seconds
    pingTimeout: 20000   // Wait 20 seconds for pong before disconnecting
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
      if (!conversationId) return;
      const convIdStr = conversationId.toString();
      console.log(`👤 User ${userId} joining conversation room: conversation_${convIdStr}`);
      socket.join(`conversation_${convIdStr}`);

    });

    socket.on("leave_conversation", (conversationId: string) => {
      if (!conversationId) return;
      const convIdStr = conversationId.toString();
      console.log(`👤 User ${userId} leaving conversation room: conversation_${convIdStr}`);
      socket.leave(`conversation_${convIdStr}`);
    });

    // ✅ Video Lesson Progress Update
    socket.on("update_lesson_progress", async (data: { trainingId: string, lessonId: string, position: number, isCompleted?: boolean }) => {
      try {
        const { trainingId, lessonId, position, isCompleted = false } = data;
        const userId = socket.data.userId;

        if (!ObjectId.isValid(trainingId) || !ObjectId.isValid(lessonId)) return;

        const trainingOid = new ObjectId(trainingId);
        const lessonOid = new ObjectId(lessonId);
        const userOid = new ObjectId(userId);

        const enrollmentRepo = AppDataSource.getMongoRepository(MemberTraining);
        const trainingRepo = AppDataSource.getMongoRepository(Training);
        const progressRepo = AppDataSource.getMongoRepository(LessonProgress);

        // 1. Check if user is enrolled
        let enrollment = await enrollmentRepo.findOneBy({
          memberId: userOid,
          trainingId: trainingOid
        });

        if (!enrollment) {
          const training = await trainingRepo.findOneBy({ _id: trainingOid });
          if (!training) return;

          // Auto-enroll
          enrollment = new MemberTraining();
          enrollment.memberId = userOid;
          enrollment.trainingId = trainingOid;
          await enrollmentRepo.save(enrollment);
        } else {
          enrollment.lessonId = lessonOid;
          await enrollmentRepo.save(enrollment);
        }

        // 2. Update or Create progress
        let progress = await progressRepo.findOneBy({
          memberId: userOid,
          trainingId: trainingOid,
          lessonId: lessonOid
        });

        if (!progress) {
          progress = new LessonProgress();
          progress.memberId = userOid;
          progress.trainingId = trainingOid;
          progress.lessonId = lessonOid;
        }

        progress.lastWatchedPosition = position;
        progress.isCompleted = isCompleted || progress.isCompleted;

        await progressRepo.save(progress);

        // Optionally emit success back to user
        socket.emit("lesson_progress_saved", { lessonId, position, isCompleted: progress.isCompleted });

      } catch (error) {
        console.error("❌ Error updating lesson progress via socket:", error);
      }
    });

    socket.on("disconnect", async () => {
      console.log(`❌ User disconnected: ${userId}`);
      if (!userId) return;

      try {
        // Check if user has other active connections (e.g. from another device/tab)
        const activeSockets = await io.in(userId).fetchSockets();

        if (activeSockets.length === 0) {
          // No more active sockets, user is truly offline
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
        } else {
          console.log(`ℹ️ User ${userId} still has ${activeSockets.length} active connection(s).`);
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
  const conversationRoom = io.sockets.adapter.rooms.get(roomName);

  if (!conversationRoom) {
    console.log(`🔍 Room ${roomName} not found or empty.`);
    return false;
  }

  const userRoom = io.sockets.adapter.rooms.get(userId);
  if (!userRoom) {
    console.log(`🔍 User room ${userId} not found or empty.`);
    return false;
  }

  // Check intersection: if any socket ID of the user is in the conversation room
  for (const socketId of userRoom) {
    if (conversationRoom.has(socketId)) {
      console.log(`✅ User ${userId} is active in conversation ${conversationId} (via socket ${socketId})`);
      return true;
    }
  }

  console.log(`🔍 User ${userId} is connected but NOT in conversation ${conversationId}`);
  return false;
};
