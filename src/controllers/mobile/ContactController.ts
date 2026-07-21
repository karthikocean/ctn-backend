import {
  JsonController,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  QueryParam,
  NotFoundError,
  BadRequestError,
  HttpCode,
  Res,
  Req,
  UseBefore
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { Contact, ContactType } from "../../entity/Contact";
import { Member } from "../../entity/Member";
import { CreateContactDto, UpdateContactDto } from "../../dto/mobile/Contact.dto";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import pagination from "../../utils/pagination";
import handleErrorResponse from "../../utils/commonFunction";
import { MobileAuthMiddleware } from "../../middlewares/MobileAuthMiddleware";

@JsonController("/contacts")
@UseBefore(MobileAuthMiddleware)
export class MobileContactController {
  private contactRepo = AppDataSource.getMongoRepository(Contact);
  private memberRepo = AppDataSource.getMongoRepository(Member);

  /**
   * @swagger
   * /mobile-api/contacts:
   *   post:
   *     summary: Create a new contact
   *     tags: [Mobile Contacts]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CreateContactDto'
   */
  @Post("/")
  @HttpCode(StatusCodes.CREATED)
  async createContact(@Req() req: any, @Body() data: CreateContactDto, @Res() res: any) {
    try {
      const userId = req.user.userId;

      // Validate referredBy only when type is "referred"
      if (data.type === ContactType.REFERRED) {
        if (!data.referredBy) {
          throw new BadRequestError("referredBy is required when type is 'referred'");
        }
        if (!ObjectId.isValid(data.referredBy)) {
          throw new BadRequestError("Invalid referredBy ID");
        }
      }
      const contactData = await this.contactRepo.findOne({ where: { phoneNumber: data.phoneNumber, createdBy: userId, isDeleted: false } });
      if (contactData) {
        throw new BadRequestError("Contact already exists");
      }
      const contact = new Contact();
      contact.name = data.name;
      contact.phoneNumber = data.phoneNumber;
      contact.type = data.type ?? ContactType.MYSELF;
      contact.createdBy = new ObjectId(userId);
      contact.modifiedBy = new ObjectId(userId);
      contact.isActive = true;
      contact.isDeleted = false;

      if (data.referredBy && ObjectId.isValid(data.referredBy)) {
        contact.referredBy = new ObjectId(data.referredBy);
      }

      const saved = await this.contactRepo.save(contact);

      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: "Contact created successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/contacts:
   *   get:
   *     summary: Get all contacts of the logged-in user
   *     tags: [Mobile Contacts]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [myself, referred]
   *       - in: query
   *         name: isActive
   *         schema:
   *           type: boolean
   */
  @Get("/")
  async getContacts(
    @Req() req: any,
    @QueryParam("page") page: number,
    @QueryParam("limit") limit: number,
    @QueryParam("search") search: string,
    @QueryParam("type") type: ContactType,
    @QueryParam("isActive") isActive: string,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId;
      page = Number(page) || 0;
      limit = Number(limit) || 10;

      const where: any = {
        createdBy: new ObjectId(userId),
        isDeleted: false
      };

      if (type) {
        where.type = type;
      }

      if (isActive !== undefined && isActive !== "") {
        where.isActive = isActive === "true";
      }

      if (search) {
        where.$or = [
          { name: { $regex: search, $options: "i" } },
          { phoneNumber: { $regex: search, $options: "i" } }
        ];
      }

      const [contacts, total] = await this.contactRepo.findAndCount({
        where,
        skip: page * limit,
        take: limit,
        order: { createdAt: "DESC" }
      });

      return pagination(total, contacts, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/contacts/all:
   *   get:
   *     summary: Get all contacts without pagination (with createdBy member name)
   *     tags: [Mobile Contacts]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema:
   *           type: string
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [myself, referred]
   *       - in: query
   *         name: isActive
   *         schema:
   *           type: boolean
   */
  @Get("/all")
  async getAllContacts(
    @Req() req: any,
    @QueryParam("search") search: string,
    @QueryParam("isActive") isActive: string,
    @Res() res: any
  ) {
    try {
      const userId = req.user.userId;

      // Rule:
      //  - Own contacts (createdBy = me): only type "myself" (hide "referred")
      //  - Received contacts (referredBy = me): both types included
      const ownCondition: any = {
        createdBy: new ObjectId(userId),
        type: ContactType.MYSELF,
        isDeleted: false
      };

      const receivedCondition: any = {
        referredBy: new ObjectId(userId),
        isDeleted: false
      };

      if (isActive !== undefined && isActive !== "") {
        const activeVal = isActive === "true";
        ownCondition.isActive = activeVal;
        receivedCondition.isActive = activeVal;
      }

      const baseOr: any = { $or: [ownCondition, receivedCondition] };

      let where: any;

      if (search) {
        where = {
          $and: [
            baseOr,
            {
              $or: [
                { name: { $regex: search, $options: "i" } },
                { phoneNumber: { $regex: search, $options: "i" } }
              ]
            }
          ]
        };
      } else {
        where = baseOr;
      }

      const contacts = await this.contactRepo.find({
        where,
        order: { name: "ASC" }
      });

      // Collect unique createdBy member IDs to populate names
      const creatorIds = [...new Set(contacts.map(c => c.createdBy.toString()))]
        .map(id => new ObjectId(id));

      const members = creatorIds.length > 0
        ? await this.memberRepo.find({
          where: { _id: { $in: creatorIds } } as any,
          select: ["_id", "fullName", "profilePhoto"] as any
        })
        : [];

      const memberMap = new Map(
        members.map(m => [m._id.toString(), { fullName: m.fullName, profilePhoto: m.profilePhoto ?? null }])
      );

      const data = contacts.map(c => ({
        ...c,
        createdByInfo: memberMap.get(c.createdBy.toString()) ?? null
      }));

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Contacts fetched successfully",
        total: data.length,
        data
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/contacts/{id}:
   *   get:
   *     summary: Get a single contact by ID
   *     tags: [Mobile Contacts]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Get("/:id")
  async getContact(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid contact ID");

      const userId = req.user.userId;

      const contact = await this.contactRepo.findOneBy({
        _id: new ObjectId(id),
        createdBy: new ObjectId(userId),
        isDeleted: false
      });

      if (!contact) throw new NotFoundError("Contact not found");

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Contact fetched successfully",
        data: contact
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/contacts/{id}:
   *   put:
   *     summary: Update a contact
   *     tags: [Mobile Contacts]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/UpdateContactDto'
   */
  @Put("/:id")
  async updateContact(
    @Req() req: any,
    @Param("id") id: string,
    @Body() data: UpdateContactDto,
    @Res() res: any
  ) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid contact ID");

      const userId = req.user.userId;

      const contact = await this.contactRepo.findOneBy({
        _id: new ObjectId(id),
        createdBy: new ObjectId(userId),
        isDeleted: false
      });
      if (!contact) throw new NotFoundError("Contact not found");

      const contactData = await this.contactRepo.findOne({ where: { _id: { $ne: contact._id }, phoneNumber: data.phoneNumber, createdBy: userId, isDeleted: false } });
      if (contactData) {
        throw new BadRequestError("Contact already exists");
      }

      // Validate referredBy when type is being changed to "referred"
      const effectiveType = data.type ?? contact.type;
      if (effectiveType === ContactType.REFERRED) {
        const effectiveReferredBy = data.referredBy ?? contact.referredBy?.toString();
        if (!effectiveReferredBy) {
          throw new BadRequestError("referredBy is required when type is 'referred'");
        }
        if (!ObjectId.isValid(effectiveReferredBy)) {
          throw new BadRequestError("Invalid referredBy ID");
        }
      }

      if (data.name !== undefined) contact.name = data.name;
      if (data.phoneNumber !== undefined) contact.phoneNumber = data.phoneNumber;
      if (data.type !== undefined) contact.type = data.type;
      if (data.isActive !== undefined) contact.isActive = data.isActive;

      if (data.referredBy !== undefined) {
        if (data.referredBy && ObjectId.isValid(data.referredBy)) {
          contact.referredBy = new ObjectId(data.referredBy);
        } else {
          contact.referredBy = undefined;
        }
      }

      contact.modifiedBy = new ObjectId(userId);

      const saved = await this.contactRepo.save(contact);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Contact updated successfully",
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/contacts/{id}:
   *   delete:
   *     summary: Soft-delete a contact
   *     tags: [Mobile Contacts]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Delete("/:id")
  async deleteContact(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid contact ID");

      const userId = req.user.userId;

      const contact = await this.contactRepo.findOneBy({
        _id: new ObjectId(id),
        createdBy: new ObjectId(userId),
        isDeleted: false
      });

      if (!contact) throw new NotFoundError("Contact not found");

      contact.isDeleted = true;
      contact.isActive = false;
      contact.modifiedBy = new ObjectId(userId);

      await this.contactRepo.save(contact);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Contact deleted successfully"
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }

  /**
   * @swagger
   * /mobile-api/contacts/{id}/toggle-active:
   *   put:
   *     summary: Toggle isActive status of a contact
   *     tags: [Mobile Contacts]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   */
  @Put("/:id/toggle-active")
  async toggleActive(@Req() req: any, @Param("id") id: string, @Res() res: any) {
    try {
      if (!ObjectId.isValid(id)) throw new BadRequestError("Invalid contact ID");

      const userId = req.user.userId;

      const contact = await this.contactRepo.findOneBy({
        _id: new ObjectId(id),
        createdBy: new ObjectId(userId),
        isDeleted: false
      });

      if (!contact) throw new NotFoundError("Contact not found");

      contact.isActive = !contact.isActive;
      contact.modifiedBy = new ObjectId(userId);

      const saved = await this.contactRepo.save(contact);

      return res.status(StatusCodes.OK).json({
        success: true,
        message: `Contact ${saved.isActive ? "activated" : "deactivated"} successfully`,
        data: saved
      });
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
