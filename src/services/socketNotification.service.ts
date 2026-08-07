import { ObjectId } from "mongodb";
import { getIO, emitUnreadCount } from "../utils/socket";

export class SocketNotificationService {
  /**
   * Check if a specific user currently has at least one active Socket.IO connection
   */
  public static isUserConnected(userId: string): boolean {
    try {
      const io = getIO();
      if (!io) return false;
      const room = io.sockets.adapter.rooms.get(userId);
      return !!(room && room.size > 0);
    } catch {
      return false; // Socket server not initialized or user offline
    }
  }

  /**
   * Emit live unread count to user ONLY if user is currently online/connected
   */
  public static async emitUnreadIfConnected(userId: string): Promise<boolean> {
    if (!userId || !ObjectId.isValid(userId)) return false;

    // Zero-overhead check: skip DB count & socket emission if user is offline
    if (!this.isUserConnected(userId)) {
      return false;
    }

    try {
      await emitUnreadCount(userId);
      return true;
    } catch (error: any) {
      console.error(`[SocketNotificationService] Error emitting unread to online user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Batch process online check & unread count emission for a list of member IDs
   */
  public static async emitUnreadToConnectedBatch(userArr: (string | ObjectId)[]): Promise<number> {
    let emittedCount = 0;
    const promises: Promise<void>[] = [];

    for (const rawId of userArr) {
      const userId = rawId.toString();
      if (this.isUserConnected(userId)) {
        emittedCount++;
        promises.push(emitUnreadCount(userId));
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }

    return emittedCount;
  }
}
