import { AppDataSource } from "../data-source";
import { Role } from "../entity/Role.Permission";
import { AdminUser } from "../entity/AdminUser";
import { RoleController } from "../controllers/admin/role.controller";
import * as socketUtils from "../utils/socket";
import { ObjectId } from "mongodb";

// Mock socket utils so we can assert on emitToUsers
jest.mock("../utils/socket", () => {
  const original = jest.requireActual("../utils/socket");
  return {
    ...original,
    emitToUsers: jest.fn()
  };
});

describe("Role Permissions Update Socket Notification Tests", () => {
  let roleRepo: any;
  let userRepo: any;
  let controller: RoleController;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    roleRepo = AppDataSource.getMongoRepository(Role);
    userRepo = AppDataSource.getMongoRepository(AdminUser);
    controller = new RoleController();
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  it("should trigger socket notification to affected users when role permissions are updated", async () => {
    // 1. Create a mock role
    const testRole = roleRepo.create({
      name: "TEST_ROLE_" + Date.now(),
      code: "TEST_ROLE_CODE_" + Date.now(),
      description: "Jest integration test role for socket update notifications",
      isActive: true,
      isDeleted: false,
      permissions: [
        {
          moduleId: new ObjectId(),
          actions: ["view"]
        }
      ]
    });
    const savedRole = await roleRepo.save(testRole);

    // 2. Create mock admin users assigned to this role
    const testUser1 = userRepo.create({
      name: "Test User 1",
      userId: "test_user_1",
      phoneNumber: "1111111111",
      pin: "hashed_pin",
      roleId: savedRole._id,
      isActive: true,
      isDeleted: false
    });

    const testUser2 = userRepo.create({
      name: "Test User 2",
      userId: "test_user_2",
      phoneNumber: "2222222222",
      pin: "hashed_pin",
      roleId: savedRole._id,
      isActive: true,
      isDeleted: false
    });

    await userRepo.save([testUser1, testUser2]);

    // 3. Setup mock response object for controller method
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((data) => data)
    };

    // 4. Update the role's permissions using the controller update endpoint
    const newModuleId = new ObjectId();
    const updateDto = {
      permissions: [
        {
          moduleId: newModuleId.toString(),
          actions: ["view", "create", "edit"]
        }
      ]
    };

    // Reset any calls to emitToUsers before calling controller
    (socketUtils.emitToUsers as jest.Mock).mockClear();

    await controller.update(savedRole._id.toString(), updateDto, mockRes);

    // 5. Assertions
    // Verify controller returns 200 OK status
    expect(mockRes.status).toHaveBeenCalledWith(200);

    // Verify emitToUsers was called to notify affected users
    expect(socketUtils.emitToUsers).toHaveBeenCalledTimes(1);

    // Verify correct user IDs were notified
    const expectedUserIds = [testUser1.id.toString(), testUser2.id.toString()];
    expect(socketUtils.emitToUsers).toHaveBeenCalledWith(
      expect.arrayContaining(expectedUserIds),
      "permissionsUpdated",
      expect.objectContaining({
        roleId: savedRole._id.toString(),
        permissions: expect.arrayContaining([
          expect.objectContaining({
            actions: expect.arrayContaining(["view", "create", "edit"])
          })
        ])
      })
    );

    // 6. Clean up database records
    await userRepo.delete({ _id: { $in: [testUser1.id, testUser2.id] } });
    await roleRepo.delete({ _id: savedRole._id });
  });
});
