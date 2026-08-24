import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../data-source";
import { Training } from "../entity/Training";
import { MemberTraining } from "../entity/MemberTraining";
import { LessonProgress } from "../entity/LessonProgress";
import { Member, MemberStatus } from "../entity/Member";
import { UserToken } from "../entity/UserToken";
import { AdminUser } from "../entity/AdminUser";
import { Connection, ConnectionStatus } from "../entity/Connection";
import { ReportedHistory } from "../entity/ReportedHistory";
import { Conversation } from "../entity/Conversation";
import { ObjectId } from "mongodb";

let io: SocketServer;
let activeDisconnects = 0;

async function broadcastUserStatus(ioServer: any, userId: string, isOnline: boolean, lastSeen: Date): Promise<void> {
  try {
    if (!ioServer || !AppDataSource.isInitialized || !ObjectId.isValid(userId)) return;
    const userOid = new ObjectId(userId);
    const connectionRepo = AppDataSource.getMongoRepository(Connection);
    const reportedHistoryRepo = AppDataSource.getMongoRepository(ReportedHistory);
    const conversationRepo = AppDataSource.getMongoRepository(Conversation);

    const [blockedConns, reportedHistories, reportedConvs] = await Promise.all([
      connectionRepo.find({
        where: {
          $or: [
            { senderId: userOid, status: ConnectionStatus.BLOCKED },
            { receiverId: userOid, status: ConnectionStatus.BLOCKED }
          ],
          isDeleted: false
        } as any
      }),
      reportedHistoryRepo.find({
        where: {
          $or: [
            { reporterUserId: userOid },
            { targetUserId: userOid }
          ]
        } as any
      }),
      conversationRepo.find({
        where: {
          participants: { $all: [userOid] },
          status: "REPORTED"
        } as any
      })
    ]);

    const blockedSet = new Set<string>();
    for (const c of blockedConns) {
      blockedSet.add(c.senderId.equals(userOid) ? c.receiverId.toString() : c.senderId.toString());
    }
    for (const r of reportedHistories) {
      if (r.reporterUserId?.equals(userOid)) blockedSet.add(r.targetUserId.toString());
      if (r.targetUserId?.equals(userOid)) blockedSet.add(r.reporterUserId.toString());
    }
    for (const conv of reportedConvs) {
      const other = conv.participants.find(p => !p.equals(userOid));
      if (other) blockedSet.add(other.toString());
    }

    const sockets = await ioServer.fetchSockets();
    for (const s of sockets) {
      const targetUserId = s.data?.userId;
      if (!targetUserId || targetUserId === userId) continue;
      if (blockedSet.has(targetUserId)) {
        s.emit("user_status_changed", { userId, isOnline: false, lastSeen: null });
      } else {
        s.emit("user_status_changed", { userId, isOnline, lastSeen });
      }
    }
  } catch (err) {
    console.error("Failed to broadcast user status", err);
  }
}

const isDbClosedError = (err: any): boolean => {
  if (!err) return false;
  const name = err.name || "";
  const message = err.message || "";
  return (
    name === "MongoExpiredSessionError" ||
    name === "MongoNotConnectedError" ||
    name === "MongoTopologyClosedError" ||
    message.includes("session that has ended") ||
    message.includes("topology is closed") ||
    message.includes("connection is closed")
  );
};

export const waitForDisconnects = async (timeoutMs: number = 2000): Promise<void> => {
  const start = Date.now();
  while (activeDisconnects > 0 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

export const socketAuthMiddleware = async (socket: any, next: (err?: Error) => void) => {
  console.log(`[SocketAuth] Handshake started for socket: ${socket.id}`);

  // Reject early if DB is not ready yet (server still starting up)
  if (!AppDataSource.isInitialized) {
    console.log(`[SocketAuth] Rejecting: Database not ready for socket: ${socket.id}`);
    return next(new Error("Server is starting up, please retry in a moment"));
  }

  const token = socket.handshake.auth.token || socket.handshake.headers.authorization;

  if (!token) {
    console.log(`[SocketAuth] Rejecting: Token missing for socket: ${socket.id}`);
    return next(new Error("Authentication error: Token missing"));
  }

  try {
    const cleanToken = token.replace("Bearer ", "");
    console.log(`[SocketAuth] Clean token: ${cleanToken.substring(0, 15)}...`);
    let decoded: any;
    let isExpired = false;

    try {
      decoded = jwt.verify(cleanToken, process.env.JWT_SECRET as string) as any;
    } catch (error: any) {
      if (error.name === "TokenExpiredError") {
        isExpired = true;
        try {
          decoded = jwt.verify(cleanToken, process.env.JWT_SECRET as string, { ignoreExpiration: true }) as any;
        } catch {
          console.log(`[SocketAuth] Rejecting: Invalid expired token for socket: ${socket.id}`);
          return next(new Error("Authentication error: Invalid token"));
        }
      } else {
        console.log(`[SocketAuth] Rejecting: Invalid token verification for socket: ${socket.id}`, error.message);
        return next(new Error("Authentication error: Invalid token"));
      }
    }

    const userId = decoded.userId || decoded.id;
    if (!decoded || typeof decoded !== "object" || !userId || !ObjectId.isValid(userId)) {
      console.log(`[SocketAuth] Rejecting: Invalid payload for socket: ${socket.id}`);
      return next(new Error("Authentication error: Invalid token payload"));
    }

    console.log(`[SocketAuth] Token verified. Decoded user ID: ${userId}, isExpired: ${isExpired}`);

    // 1. Verify User exists and is active in database
    const userOid = new ObjectId(userId);
    let isMember = false;

    console.log(`[SocketAuth] Querying Member in DB for userOid: ${userOid}`);
    const memberRepo = AppDataSource.getMongoRepository(Member);
    const member = await memberRepo.findOneBy({ _id: userOid, isDeleted: false });

    if (member) {
      console.log(`[SocketAuth] User found in Member collection. Status: ${member.status}`);
      isMember = true;
      if (member.status !== MemberStatus.ACTIVE) {
        console.log("[SocketAuth] Rejecting: Member status inactive");
        return next(new Error("Authentication error: Account is inactive"));
      }
    } else {
      console.log("[SocketAuth] User not found in Member collection. Querying AdminUser in DB...");
      const adminRepo = AppDataSource.getMongoRepository(AdminUser);
      const admin = await adminRepo.findOneBy({ _id: userOid, isDeleted: false });
      if (!admin) {
        console.log("[SocketAuth] Rejecting: User not found in Member or AdminUser collection");
        return next(new Error("Authentication error: User not found"));
      }
      if (!admin.isActive) {
        console.log("[SocketAuth] Rejecting: Admin status inactive");
        return next(new Error("Authentication error: Account is inactive"));
      }
      console.log("[SocketAuth] User is Admin");
    }

    // 2. Verify Session (UserToken) in database
    console.log(`[SocketAuth] Querying UserToken in DB for userOid: ${userOid}`);
    const tokenRepo = AppDataSource.getMongoRepository(UserToken);
    let activeTokenRecord = await tokenRepo.findOneBy({
      userId: userOid,
      token: cleanToken
    });

    if (!activeTokenRecord) {
      console.log("[SocketAuth] Token not found in DB. Checking older token...");
      // Handle concurrent/rotation grace period
      const dbRecord = await tokenRepo.findOneBy({ userId: userOid });
      if (dbRecord) {
        try {
          const decodedDb = jwt.decode(dbRecord.token) as any;
          const decodedClient = jwt.decode(cleanToken) as any;
          if (decodedDb && decodedClient && (decodedClient.iat || 0) <= (decodedDb.iat || 0)) {
            activeTokenRecord = dbRecord;
            socket.data.newToken = dbRecord.token;
            console.log("[SocketAuth] Accepted valid older token.");
          }
        } catch (e) {
          console.error("[SocketAuth] Error during older token verification:", e);
        }
      }
    }

    if (!activeTokenRecord) {
      console.log("[SocketAuth] Rejecting: Session expired (Token not found in DB)");
      return next(new Error("Authentication error: Session expired"));
    }

    // 3. Regenerate token if it was expired and database record was exact match
    if (isExpired && !socket.data.newToken) {
      console.log("[SocketAuth] Regenerating token...");
      const newToken = jwt.sign(
        isMember
          ? { userId: userId.toString(), userType: "MEMBER" }
          : { id: userId.toString(), roleId: decoded.roleId },
        process.env.JWT_SECRET as string,
        { expiresIn: (process.env.JWT_EXPIRES_IN || "30d") as any }
      );

      activeTokenRecord.token = newToken;
      await tokenRepo.save(activeTokenRecord);
      socket.data.newToken = newToken;
      console.log(`[SocketAuth] Regenerated expired socket token for user: ${userId}`);
    }

    socket.data.userId = userId;
    socket.data.isMember = isMember;
    console.log(`[SocketAuth] Authentication successful for user: ${userId}. Calling next().`);
    next();
  } catch (err: any) {
    console.error("[SocketAuth] Unexpected error during authentication:", err);
    return next(new Error("Authentication error: Internal error"));
  }
};

export const initSocket = (server: HttpServer) => {
  io = new SocketServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    pingInterval: 10000,
    pingTimeout: 20000,
    allowEIO3: true
  });

  // ✅ JWT Authentication Middleware
  io.use(socketAuthMiddleware);

  io.on("connection", async (socket) => {
    const userId = socket.data.userId;
    console.log(`🔌 User connected: ${userId} (Socket ID: ${socket.id})`);

    if (socket.data.newToken) {
      socket.emit("token_regenerated", { token: socket.data.newToken });
      console.log(`[SocketAuth] Emitted regenerated token to client: ${userId}`);
    }

    if (socket.data.isMember && userId && ObjectId.isValid(userId)) {
      try {
        const memberRepo = AppDataSource.getMongoRepository(Member);
        await memberRepo.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { isOnline: true } }
        );
        await broadcastUserStatus(io, userId, true, new Date());
      } catch (err) {
        if (isDbClosedError(err)) {
          console.log(`🔌 Database is closed/closing. Skipping online status update for user ${userId}`);
        } else {
          console.error("Failed to update user online status", err);
        }
      }
    }

    // ✅ Join user to a private room based on their userId
    socket.join(userId);

    // If socket is an Admin (non-member), auto-join the admin_room
    if (!socket.data.isMember) {
      socket.join("admin_room");
      console.log(`👑 Admin socket ${socket.id} (user: ${userId}) joined 'admin_room'`);
    }

    socket.on("join_admin_room", () => {
      socket.join("admin_room");
      console.log(`👑 Socket ${socket.id} (user: ${userId}) explicitly joined 'admin_room'`);
    });

    socket.on("join_conversation", (conversationId: string) => {
      console.log(`👤 User ${userId} joined conversation: ${conversationId}`);

      // Leave any other conversation rooms the socket is currently in
      const currentRooms = Array.from(socket.rooms);
      for (const room of currentRooms) {
        if (room.startsWith("conversation_") && room !== `conversation_${conversationId}`) {
          socket.leave(room);
          console.log(`👤 User ${userId} left room: ${room}`);
        }
      }

      socket.join(`conversation_${conversationId}`);
    });

    socket.on("set_status", async (data: { isOnline: boolean }) => {
      if (!socket.data.isMember || !userId || !ObjectId.isValid(userId)) return;
      try {
        const memberRepo = AppDataSource.getMongoRepository(Member);
        const lastSeen = new Date();
        await memberRepo.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { isOnline: data.isOnline, lastSeen } }
        );
        await broadcastUserStatus(io, userId, data.isOnline, lastSeen);
      } catch (err) {
        if (isDbClosedError(err)) {
          console.log(`🔌 Database is closed/closing. Skipping manual user status update for user ${userId}`);
        } else {
          console.error("Failed to manual update user online status", err);
        }
      }
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

    socket.on("disconnect", async () => {
      console.log(`❌ User disconnected: ${userId}`);
      if (!socket.data.isMember || !userId || !ObjectId.isValid(userId)) return;

      activeDisconnects++;
      try {
        if (!AppDataSource.isInitialized) {
          console.log(`🔌 Database is closed. Skipping offline status update for user ${userId}`);
          return;
        }

        // Delay slightly to handle quick reconnects or multi-device behavior if needed,
        // but checking io.sockets.adapter.rooms should be immediate.
        const activeSockets = io.sockets.adapter.rooms.get(userId);
        if (!activeSockets || activeSockets.size === 0) {
          // No active sockets left, mark offline
          const memberRepo = AppDataSource.getMongoRepository(Member);
          const lastSeen = new Date();
          await memberRepo.updateOne(
            { _id: new ObjectId(userId) },
            { $set: { isOnline: false, lastSeen } }
          );

          // Emit to others that the user went offline
          await broadcastUserStatus(io, userId, false, lastSeen);
        }
      } catch (err) {
        if (isDbClosedError(err)) {
          console.log(`🔌 Database is closed/closing. Skipping offline status update for user ${userId}`);
        } else {
          console.error("Failed to update user offline status", err);
        }
      } finally {
        activeDisconnects--;
      }
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

/**
 * Emit the live unread notification count to a specific user via their private socket room.
 * Safe to call even when the user is offline — the emit is a no-op if nobody is in the room.
 */
export const emitUnreadCount = async (receiverId: string): Promise<void> => {
  if (!io) return;
  try {
    const { PushNotification } = await import("../entity/PushNotifications");
    const repo = AppDataSource.getMongoRepository(PushNotification);
    const count = await repo.count({
      receiverId: new ObjectId(receiverId),
      isRead: false,
      isDeleted: false
    } as any);
    io.to(receiverId).emit("unread_count_update", { unreadCount: count });
  } catch (err) {
    console.error("[emitUnreadCount] Failed to emit unread count:", err);
  }
};
