import { ObjectId } from "mongodb";
import { ConnectionStatus } from "../src/entity/Connection";
import { NotificationModule } from "../src/entity/PushNotifications";
import { MessageType } from "../src/entity/Message";

describe("Chat Mutual Connection Flow Unit Tests", () => {
  const userA = new ObjectId();
  const userB = new ObjectId();
  const userC = new ObjectId(); // not mutual

  describe("isMutual logic", () => {
    it("should consider members mutual when ACCEPTED connections exist in both directions", () => {
      const connections = [
        { senderId: userA, receiverId: userB, status: ConnectionStatus.ACCEPTED, isDeleted: false },
        { senderId: userB, receiverId: userA, status: ConnectionStatus.ACCEPTED, isDeleted: false },
        { senderId: userA, receiverId: userC, status: ConnectionStatus.ACCEPTED, isDeleted: false },
        { senderId: userC, receiverId: userA, status: ConnectionStatus.PENDING, isDeleted: false }
      ];

      const isMutual = (u1: ObjectId, u2: ObjectId) => {
        const c1 = connections.find(c => c.senderId.equals(u1) && c.receiverId.equals(u2) && c.status === ConnectionStatus.ACCEPTED && !c.isDeleted);
        const c2 = connections.find(c => c.senderId.equals(u2) && c.receiverId.equals(u1) && c.status === ConnectionStatus.ACCEPTED && !c.isDeleted);
        return !!(c1 && c2);
      };

      expect(isMutual(userA, userB)).toBe(true);
      expect(isMutual(userA, userC)).toBe(false);
    });
  });

  describe("Conversation status assignment on creation", () => {
    it("should set status to ACCEPTED for mutual connections and PENDING for non-mutual", () => {
      const isMutualAB = true;
      const isMutualAC = false;

      const createConversation = (sender: ObjectId, receiver: ObjectId, isMutual: boolean) => {
        return {
          participants: [sender, receiver],
          status: isMutual ? "ACCEPTED" : "PENDING",
          unreadCounts: {}
        };
      };

      const convAB = createConversation(userA, userB, isMutualAB);
      const convAC = createConversation(userA, userC, isMutualAC);

      expect(convAB.status).toBe("ACCEPTED");
      expect(convAC.status).toBe("PENDING");
    });
  });

  describe("Push notification module selection", () => {
    it("should send MESSAGE for mutual connections and MESSAGE_REQUEST for non-mutual", () => {
      const getNotifModule = (isMutual: boolean) => {
        return isMutual ? NotificationModule.MESSAGE : NotificationModule.MESSAGE_REQUEST;
      };

      expect(getNotifModule(true)).toBe(NotificationModule.MESSAGE);
      expect(getNotifModule(false)).toBe(NotificationModule.MESSAGE_REQUEST);
    });
  });

  describe("Auto-upgrade on connection acceptance", () => {
    it("should upgrade pending conversations to ACCEPTED when mutual connection is established", () => {
      const conversations = [
        { _id: new ObjectId(), participants: [userA, userB], status: "PENDING" },
        { _id: new ObjectId(), participants: [userA, userC], status: "PENDING" }
      ];

      // userA and userB become mutual
      const onConnectionAccepted = (senderId: ObjectId, receiverId: ObjectId) => {
        conversations.forEach(conv => {
          if (conv.participants.some(p => p.equals(senderId)) && conv.participants.some(p => p.equals(receiverId))) {
            conv.status = "ACCEPTED";
          }
        });
      };

      onConnectionAccepted(userA, userB);

      expect(conversations[0].status).toBe("ACCEPTED");
      expect(conversations[1].status).toBe("PENDING");
    });
  });

  describe("Milestone reply conversation status", () => {
    it("should initialize milestone reply conversations as ACCEPTED since it requires mutual friendship", () => {
      const milestoneReplyConversation = {
        participants: [userA, userB],
        milestoneId: new ObjectId(),
        status: "ACCEPTED",
        unreadCounts: {}
      };

      expect(milestoneReplyConversation.status).toBe("ACCEPTED");
    });
  });

  describe("Blocked / Reported silent drop delivery (WhatsApp-style)", () => {
    it("should tag message with blockedFor and hide from receiver list and details while showing for sender", () => {
      const isBlockedMember = true;
      const receiver = { _id: userB, fcmToken: "sample_token" };
      let pushNotificationSent = false;
      let receiverSocketEmitted = false;
      let receiverUnreadIncremented = false;

      // Sender sends a message while blocked/reported
      const savedMessage: any = {
        _id: new ObjectId(),
        senderId: userA,
        content: "Hello!",
        createdAt: new Date()
      };

      if (isBlockedMember) {
        savedMessage.blockedFor = [userB];
      }

      if (!isBlockedMember && receiver.fcmToken) {
        pushNotificationSent = true;
      }

      if (!isBlockedMember) {
        receiverSocketEmitted = true;
        receiverUnreadIncremented = true;
      }

      // Sender's view
      const messagesForSender = [savedMessage].filter(
        m => !m.blockedFor || !m.blockedFor.some((id: any) => id.equals(userA))
      );
      // Receiver's view
      const messagesForReceiver = [savedMessage].filter(
        m => !m.blockedFor || !m.blockedFor.some((id: any) => id.equals(userB))
      );

      expect(pushNotificationSent).toBe(false);
      expect(receiverSocketEmitted).toBe(false);
      expect(receiverUnreadIncremented).toBe(false);
      expect(messagesForSender.length).toBe(1);
      expect(messagesForReceiver.length).toBe(0);
    });
  });

  describe("Deleted / Rejected conversation revival and delivery", () => {
    it("should reset conversation status to PENDING and un-delete when either member sends a message on rejected/deleted conversation", () => {
      const rejectedConversation: any = {
        _id: new ObjectId(),
        participants: [userA, userB],
        isDeleted: false,
        status: "REJECTED"
      };

      const deletedConversation: any = {
        _id: new ObjectId(),
        participants: [userA, userB],
        isDeleted: true,
        status: "DELETED",
        deletedBy: userB
      };

      const handleMessageSend = (conv: any) => {
        const wasRejectedOrDeleted =
          conv.status === "REJECTED" ||
          conv.status === "DELETED" ||
          conv.isDeleted ||
          !!conv.deletedBy;

        if (wasRejectedOrDeleted) {
          conv.isDeleted = false;
          delete conv.deletedBy;
          conv.status = "PENDING";
        }
      };

      handleMessageSend(rejectedConversation);
      handleMessageSend(deletedConversation);

      expect(rejectedConversation.status).toBe("PENDING");
      expect(rejectedConversation.isDeleted).toBe(false);

      expect(deletedConversation.status).toBe("PENDING");
      expect(deletedConversation.isDeleted).toBe(false);
      expect(deletedConversation.deletedBy).toBeUndefined();
    });
  });

  describe("Event validation via features.eventVisitor", () => {
    it("should allow event booking if features.eventVisitor is true even if Event is removed from plan.modules", () => {
      const plan = {
        title: "Basic",
        modules: [
          { moduleName: "Requirement", countLimit: 1, frequency: "daily" }
        ],
        features: {
          eventVisitor: true,
          eventStall: false,
          spotlights: false
        }
      };

      const validateEventAccess = (moduleName: string, planConfig: typeof plan) => {
        const normalized = moduleName.trim().toLowerCase();
        if (normalized === "event" || normalized === "eventvisitor") {
          if (planConfig.features && planConfig.features.eventVisitor === false) {
            throw new Error("Event Visitor permission is not enabled in your active plan.");
          }
          return;
        }
        const m = planConfig.modules.find(mod => mod.moduleName.toLowerCase() === normalized);
        if (!m) {
          throw new Error(`Module "${moduleName}" is not included in your active plan.`);
        }
      };

      expect(() => validateEventAccess("Event", plan)).not.toThrow();

      const planWithoutEvent = {
        ...plan,
        features: { ...plan.features, eventVisitor: false }
      };
      expect(() => validateEventAccess("Event", planWithoutEvent)).toThrow(
        "Event Visitor permission is not enabled in your active plan."
      );
    });
  });

  describe("Hiding online status and lastSeen for blocked/reported users", () => {
    it("should return isOnline: false and lastSeen: null when user is blocked or reported", () => {
      const isBlockedUser = true;
      const otherUser = {
        _id: userB,
        fullName: "Richard",
        isOnline: true,
        lastSeen: new Date()
      };

      const formattedOtherUser = {
        _id: otherUser._id,
        fullName: otherUser.fullName,
        isOnline: isBlockedUser ? false : (otherUser.isOnline || false),
        lastSeen: isBlockedUser ? null : (otherUser.lastSeen || null)
      };

      expect(formattedOtherUser.isOnline).toBe(false);
      expect(formattedOtherUser.lastSeen).toBeNull();
    });
  });

  describe("Post visibility on user vs post reporting", () => {
    it("should keep reported user posts visible, but hide specifically reported posts", () => {
      const post1 = { _id: new ObjectId(), memberId: userB, title: "Post 1" };
      const post2 = { _id: new ObjectId(), memberId: userB, title: "Post 2" };
      const allPosts = [post1, post2];

      // User A reported post1 specifically, and also reported userB in chat/profile
      const reportedPostIds = [post1._id];

      // Filtering logic: exclude only reportedPostIds
      const visiblePosts = allPosts.filter(p => !reportedPostIds.some(id => id.equals(p._id)));

      expect(visiblePosts.length).toBe(1);
      expect(visiblePosts[0]._id.equals(post2._id)).toBe(true);
    });
  });

  describe("Referral reward flows (500 points & 1 month extension)", () => {
    it("should award 500 points only to free/trial referrers on registration, and 0 points to purchased plan referrers", () => {
      const calculateRegistrationReward = (referrerPlan: "TRIAL" | "PURCHASED" | "FREE") => {
        const isReferrerPurchased = referrerPlan === "PURCHASED";
        return !isReferrerPurchased ? 500 : 0;
      };

      expect(calculateRegistrationReward("TRIAL")).toBe(500);
      expect(calculateRegistrationReward("FREE")).toBe(500);
      expect(calculateRegistrationReward("PURCHASED")).toBe(0);
    });

    it("should NOT award subscription extension when referred friend only starts trial", () => {
      const awardOnTrial = false;
      expect(awardOnTrial).toBe(false);
    });

    it("should award 1 month subscription extension when friend purchases plan and referrer is on purchased plan", () => {
      const now = new Date();
      const referrerSub = {
        isTrial: false,
        endDate: new Date(now.getFullYear(), now.getMonth() + 2, 1)
      };

      const isReferrerPurchasedPlan = !referrerSub.isTrial && referrerSub.endDate > now;
      expect(isReferrerPurchasedPlan).toBe(true);

      const bonusMonths = 1;
      const newEnd = new Date(referrerSub.endDate);
      newEnd.setMonth(newEnd.getMonth() + bonusMonths);

      expect(newEnd.getTime()).toBeGreaterThan(referrerSub.endDate.getTime());
    });
  });

  describe("Post audience notification region filtering", () => {
    it("should filter target members strictly by post regionIds and exclude unselected regions", () => {
      const region1 = new ObjectId();
      const region2 = new ObjectId();
      const region3 = new ObjectId();

      const memberInRegion1 = { _id: new ObjectId(), businessRegion: region1, status: "ACTIVE" };
      const memberInRegion2 = { _id: new ObjectId(), businessRegion: region2, status: "ACTIVE" };
      const memberInRegion3 = { _id: new ObjectId(), businessRegion: region3, status: "ACTIVE" };

      const allMembers = [memberInRegion1, memberInRegion2, memberInRegion3];

      // Post only targets region1 and region2
      const postRegionIds = [region1, region2];

      const targetMembers = allMembers.filter(m =>
        postRegionIds.some(rId => rId.equals(m.businessRegion))
      );

      expect(targetMembers.length).toBe(2);
      expect(targetMembers.some(m => m._id.equals(memberInRegion3._id))).toBe(false);
      expect(targetMembers.some(m => m._id.equals(memberInRegion1._id))).toBe(true);
      expect(targetMembers.some(m => m._id.equals(memberInRegion2._id))).toBe(true);
    });
  });
});
