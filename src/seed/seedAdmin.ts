import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import { AppDataSource } from "../data-source";

import { AdminUser } from "../entity/AdminUser";
import { Role } from "../entity/Role.Permission";

export async function seedAdmin() {

  const roleRepo = AppDataSource.getMongoRepository(Role);
  const userRepo = AppDataSource.getMongoRepository(AdminUser);

  const modules = [
    "dashboard",
    "roles_permissions",
    "business_regions",
    "categories",
    "announcements",
    "events",
    "trainings",
    "points",
    "awards",
    "members",
    "activities",
    "connections",
    "contributions",
    "reports"
  ];

  const actions = ["view", "create", "edit", "delete"];

  const fullPermissions = modules.map((module) => ({
    moduleId: module,
    actions
  }));

  // ✅ ROLE
  let adminRole = await roleRepo.findOne({
    where: { code: "SUPER_ADMIN" }
  });

  if (!adminRole) {
    adminRole = roleRepo.create({
      name: "Super Admin",
      code: "SUPER_ADMIN",
      isActive: true,
      isDeleted: false,
      permissions: fullPermissions
    });

    adminRole = await roleRepo.save(adminRole);
  }

  // ✅ USER
  let adminUser = await userRepo.findOne({
    where: { phoneNumber: "9999999999" }
  });

  if (!adminUser) {
    const hashedPin = await bcrypt.hash("1234", 10);

    adminUser = userRepo.create({
      name: "Super Admin",
      email: "admin@test.com",
      phoneNumber: "9999999999",
      pin: hashedPin,

      userId: "USR001",

      roleId: adminRole._id, // ✅ FIXED

      createdBy: adminRole._id,
      updatedBy: adminRole._id,

      isActive: true,   // ✅ FIXED
      isDeleted: false  // ✅ FIXED
    });

    await userRepo.save(adminUser);
  }

  console.log("✅ Seed Completed");
}
