import { AppDataSource } from "../data-source";
import { NotifyBy, Reminder, ReminderStatus, RepeatType } from "../entity/Reminder";
import { CreateReminderDto } from "../dto/mobile/CreateReminderDto";
import { UpdateReminderDto } from "../dto/mobile/UpdateReminderDto";
import { ReminderListDto } from "../dto/mobile/ReminderListDto";
import { ObjectId } from "mongodb";
import { BadRequestError, NotFoundError } from "routing-controllers";

export class ReminderService {
  private reminderRepo = AppDataSource.getMongoRepository(Reminder);

  private validateObjectId(id: string, fieldName: string): ObjectId {
    if (!id || !ObjectId.isValid(id)) {
      throw new BadRequestError(`Invalid ObjectId format for field: ${fieldName}`);
    }
    return new ObjectId(id);
  }

  async createReminder(data: CreateReminderDto, userId: string): Promise<Reminder> {
    const creatorId = this.validateObjectId(userId, "userId");

    const reminder = new Reminder();
    reminder.title = data.title;
    reminder.description = data.description;

    reminder.reminderDate = new Date(data.reminderDate);
    if (isNaN(reminder.reminderDate.getTime())) {
      throw new BadRequestError("Invalid reminderDate format.");
    }

    reminder.reminderTime = data.reminderTime;
    reminder.repeatType = RepeatType.ONCE;
    reminder.repeatInterval = data.repeatInterval || 1;
    reminder.status = ReminderStatus.PENDING;
    reminder.isActive = true;
    reminder.isDeleted = false;
    reminder.nextReminderDate = new Date(reminder.reminderDate);
    reminder.createdBy = creatorId;
    reminder.updatedBy = creatorId;
    reminder.notifyBy = NotifyBy.PUSH as any;
    reminder.recipients = [creatorId];

    return await this.reminderRepo.save(reminder);
  }

  async updateReminder(id: string, data: UpdateReminderDto, userId: string): Promise<Reminder> {
    const reminderId = this.validateObjectId(id, "id");
    const updaterId = this.validateObjectId(userId, "userId");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    if (data.title !== undefined) reminder.title = data.title;
    if (data.description !== undefined) reminder.description = data.description;

    if (data.reminderDate !== undefined) {
      reminder.reminderDate = new Date(data.reminderDate);
      if (isNaN(reminder.reminderDate.getTime())) {
        throw new BadRequestError("Invalid reminderDate format.");
      }
      reminder.nextReminderDate = new Date(reminder.reminderDate);
    }

    if (data.reminderTime !== undefined) reminder.reminderTime = data.reminderTime;
    if (data.repeatType !== undefined) reminder.repeatType = data.repeatType;
    if (data.repeatInterval !== undefined) reminder.repeatInterval = data.repeatInterval;
    if (data.status !== undefined) reminder.status = data.status;
    if (data.isActive !== undefined) reminder.isActive = data.isActive;

    if (data.notifyBy !== undefined) reminder.notifyBy = data.notifyBy;
    reminder.recipients = [updaterId];
    reminder.updatedBy = updaterId;

    return await this.reminderRepo.save(reminder);
  }

  async deleteReminder(id: string, userId: string): Promise<void> {
    const reminderId = this.validateObjectId(id, "id");
    const updaterId = this.validateObjectId(userId, "userId");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    reminder.isDeleted = true;
    reminder.updatedBy = updaterId;
    await this.reminderRepo.save(reminder);
  }

  async getReminder(id: string): Promise<Reminder> {
    const reminderId = this.validateObjectId(id, "id");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    return reminder;
  }

  async getReminderList(filters: ReminderListDto): Promise<{ total: number; data: Reminder[] }> {
    const page = Number(filters.page) || 0;
    const limit = Number(filters.limit) || 10;

    const where: any = { isDeleted: false };

    if (filters.module) {
      where.module = filters.module.toUpperCase();
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.fromDate || filters.toDate) {
      where.reminderDate = {};
      if (filters.fromDate) {
        const from = new Date(filters.fromDate);
        if (!isNaN(from.getTime())) {
          where.reminderDate.$gte = from;
        }
      }
      if (filters.toDate) {
        const to = new Date(filters.toDate);
        if (!isNaN(to.getTime())) {
          where.reminderDate.$lte = to;
        }
      }
    }

    if (filters.search) {
      where.$or = [
        { title: { $regex: filters.search, $options: "i" } },
        { description: { $regex: filters.search, $options: "i" } }
      ];
    }

    const [reminders, total] = await this.reminderRepo.findAndCount({
      where,
      skip: page * limit,
      take: limit,
      order: { createdAt: "DESC" }
    });

    return { total, data: reminders };
  }

  async toggleReminder(id: string, userId: string): Promise<Reminder> {
    const reminderId = this.validateObjectId(id, "id");
    const updaterId = this.validateObjectId(userId, "userId");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    reminder.isActive = !reminder.isActive;
    reminder.updatedBy = updaterId;

    return await this.reminderRepo.save(reminder);
  }

  async sendReminderNow(id: string): Promise<void> {
    const reminderId = this.validateObjectId(id, "id");

    const reminder = await this.reminderRepo.findOneBy({ _id: reminderId, isDeleted: false });
    if (!reminder) {
      throw new NotFoundError("Reminder not found.");
    }

    console.log(`[ReminderTrigger] Sending notification manually for reminder: "${reminder.title}"`);
    console.log(`Recipients: ${reminder.recipients.map(r => r.toString()).join(", ")}`);
    console.log(`Channels: ${reminder.notifyBy.join(", ")}`);

    // Simulate sending notification
    reminder.lastTriggeredAt = new Date();
    await this.reminderRepo.save(reminder);
  }
}
