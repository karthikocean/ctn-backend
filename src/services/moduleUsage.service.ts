import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError } from "routing-controllers";
import { AppDataSource } from "../data-source";
import { Member } from "../entity/Member";
import { Plan } from "../entity/Plan";
import { PostModel, PostType } from "../entity/Post";
import { Referral } from "../entity/Referral";
import { MemberTraining } from "../entity/MemberTraining";
import { Milestone } from "../entity/Milestone";
import { AnnouncementBooking } from "../entity/AnnouncementBooking";
import { OnlineStallProduct } from "../entity/OnlineStallProduct";
import { StallBooking } from "../entity/StallBooking";
import { OneToOne } from "../entity/OneToOne";
import { ThankYouSlip } from "../entity/ThankYouSlip";

export interface ModuleUsageConfigItem {
  entity: any;
  getFilter: (memberId: ObjectId) => Record<string, any>;
  dateField?: string;
}

export const MODULE_USAGE_CONFIG: Record<string, ModuleUsageConfigItem> = {
  "Thank you Slip": {
    entity: ThankYouSlip,
    getFilter: (memberId: ObjectId) => ({
      $or: [
        { senderId: memberId },
        { receiverId: memberId }
      ]
    }),
    dateField: "createdAt"
  },
  "One to One": {
    entity: OneToOne,
    getFilter: (memberId: ObjectId) => ({
      $or: [
        { senderId: memberId },
        { receiverId: memberId }
      ]
    }),
    dateField: "createdAt"
  },
  Ask: {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.ASK,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  Give: {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.GIVE,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  Promotion: {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.PROMOTION,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  Requirement: {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: PostType.REQUIREMENT,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  Post: {
    entity: PostModel,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      type: { $ne: PostType.ASK },
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  Referral: {
    entity: Referral,
    getFilter: (memberId: ObjectId) => ({
      senderId: memberId
    }),
    dateField: "createdAt"
  },
  Trainings: {
    entity: MemberTraining,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId
    }),
    dateField: "createdAt"
  },
  Milestones: {
    entity: Milestone,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  Milestone: {
    entity: Milestone,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  Event: {
    entity: AnnouncementBooking,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      status: "booked"
    }),
    dateField: "createdAt"
  },
  event: {
    entity: AnnouncementBooking,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      status: "booked"
    }),
    dateField: "createdAt"
  },
  "MarketPlace": {
    entity: OnlineStallProduct,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "online stall": {
    entity: OnlineStallProduct,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      isDeleted: false
    }),
    dateField: "createdAt"
  },
  "Offline Stall": {
    entity: StallBooking,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      status: "booked"
    }),
    dateField: "createdAt"
  },
  "offline stall": {
    entity: StallBooking,
    getFilter: (memberId: ObjectId) => ({
      memberId: memberId,
      status: "booked"
    }),
    dateField: "createdAt"
  }
};

/**
 * Calculates start and end dates based on frequency and frequencyValue.
 */
export function getDateRangeByFrequency(frequency: string, frequencyValue: number): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date();

  switch (frequency.toLowerCase()) {
  case "daily":
    startDate.setDate(endDate.getDate() - frequencyValue + 1);
    startDate.setHours(0, 0, 0, 0);
    break;

  case "weekly":
    // Start of the week (assuming Sunday as first day), going back frequencyValue - 1 weeks
    const dayOfWeek = endDate.getDay();
    startDate.setDate(endDate.getDate() - dayOfWeek - (7 * (frequencyValue - 1)));
    startDate.setHours(0, 0, 0, 0);
    break;

  case "monthly":
    // Start of the month, going back frequencyValue - 1 months
    startDate.setMonth(endDate.getMonth() - frequencyValue + 1);
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
    break;

  case "yearly":
    // Start of the year, going back frequencyValue - 1 years
    startDate.setFullYear(endDate.getFullYear() - frequencyValue + 1);
    startDate.setMonth(0, 1);
    startDate.setHours(0, 0, 0, 0);
    break;

  default:
    throw new BadRequestError(`Unsupported module limitation frequency: ${frequency}`);
  }

  return { startDate, endDate };
}

/**
 * Calculates current usage count dynamically from database for a specific module and date range.
 */
export async function getCurrentUsageCount(
  memberId: ObjectId,
  moduleName: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const config = MODULE_USAGE_CONFIG[moduleName];
  if (!config) {
    throw new BadRequestError(`No usage configuration found for module: ${moduleName}`);
  }

  const repository = AppDataSource.getMongoRepository(config.entity);
  const filter = config.getFilter(memberId);
  const dateField = config.dateField || "createdAt";

  const finalFilter = {
    ...filter,
    [dateField]: {
      $gte: startDate,
      $lte: endDate
    }
  };

  return repository.count(finalFilter as any);
}

/**
 * Validates whether a member is allowed to use a module based on active plan restrictions.
 * Throws BadRequestError if usage limit is reached or exceeded.
 */
export async function validateModuleUsage(memberId: ObjectId, moduleName: string): Promise<void> {
  const memberRepo = AppDataSource.getMongoRepository(Member);
  const planRepo = AppDataSource.getMongoRepository(Plan);

  const member = await memberRepo.findOneBy({ _id: memberId, isDeleted: false });
  if (!member) {
    throw new NotFoundError("Member not found");
  }

  const now = new Date();
  if (!member.planId) {
    throw new BadRequestError("No subscription plan is currently active for this member.");
  }

  if (member.subscriptionStartDate && member.subscriptionStartDate > now) {
    throw new BadRequestError("Subscription plan has not started yet.");
  }

  if (member.subscriptionEndDate && member.subscriptionEndDate < now) {
    throw new BadRequestError("Subscription plan has expired.");
  }

  const plan = await planRepo.findOneBy({ _id: member.planId, isDeleted: false });
  if (!plan) {
    throw new NotFoundError("Assigned subscription plan not found.");
  }

  // Find the module limit in the plan configuration
  const planModule = plan.modules?.find(
    (m) => m.moduleName.toLowerCase() === moduleName.toLowerCase()
  );

  if (!planModule) {
    throw new BadRequestError(`Access denied: Module "${moduleName}" is not included in your active plan.`);
  }

  // If the limit is unlimited, bypass check
  if (planModule.countLimit === -1) {
    return;
  }

  const { startDate, endDate } = getDateRangeByFrequency(planModule.frequency, planModule.frequencyValue);
  const currentUsage = await getCurrentUsageCount(memberId, moduleName, startDate, endDate);

  if (currentUsage >= planModule.countLimit) {
    throw new BadRequestError(
      `Usage limit exceeded for module "${moduleName}". You have used ${currentUsage}/${planModule.countLimit} allowance for this ${planModule.frequency}.`
    );
  }
}
