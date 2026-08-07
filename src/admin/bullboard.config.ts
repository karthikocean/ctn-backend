import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { personalNotificationQueue, broadcastNotificationQueue, dlqNotificationQueue } from "../queues/notification.queue";

export function setupBullBoard() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [
      new BullMQAdapter(personalNotificationQueue as any) as any,
      new BullMQAdapter(broadcastNotificationQueue as any) as any,
      new BullMQAdapter(dlqNotificationQueue as any) as any,
    ],
    serverAdapter,
  });

  return serverAdapter;
}
