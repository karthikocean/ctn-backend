import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../data-source";
import { Training } from "../entity/Training";
import { MemberTraining } from "../entity/MemberTraining";
import { LessonProgress } from "../entity/LessonProgress";
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
