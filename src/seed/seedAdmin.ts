import "reflect-metadata";
import * as dotenv from "dotenv";
dotenv.config();

import bcrypt from "bcryptjs";
import { AppDataSource } from "../data-source";

import { AdminUser } from "../entity/AdminUser";
import { Role } from "../entity/Role.Permission";
import { Module } from "../entity/Module";

export async function seedAdmin() {

  const roleRepo = AppDataSource.getMongoRepository(Role);
  const userRepo = AppDataSource.getMongoRepository(AdminUser);
  const moduleRepo = AppDataSource.getMongoRepository(Module);

  // ✅ Pull live module slugs instead of a hardcoded list,
  // so Super Admin always has every permissionable module —
  // including children like main_categories, sub_categories,
  // referral_categories, spotlight_request, spotlight_creation, etc.
  const activeModules = await moduleRepo.find({
    where: { isDelete: 0, isActive: 1 }
  });

  const actions = ["view", "create", "edit", "delete"];

  const fullPermissions = activeModules.map((module) => ({
    moduleId: module._id as any,
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
    console.log("✅ Super Admin role created");
  } else {
    adminRole.permissions = fullPermissions;
    await roleRepo.save(adminRole);
    console.log("✅ Super Admin role permissions synced");
  }

  // ✅ USER
  let adminUser = await userRepo.findOne({
    where: { phoneNumber: "9999999999" }
  });

  if (!adminUser) {
    const pin = process.env.SUPER_ADMIN_INITIAL_PIN;
    if (!pin) {
      throw new Error("SUPER_ADMIN_INITIAL_PIN is not defined");
    }
    const hashedPin = await bcrypt.hash(pin, 10);

    adminUser = userRepo.create({
      name: "Super Admin",
      email: "admin@trustednetwork.in",
      phoneNumber: "9999999999",
      pin: hashedPin,
      userId: "US001",
      roleId: adminRole._id,
      createdBy: adminRole._id,
      updatedBy: adminRole._id,
      isActive: true,
      isDeleted: false
    });

    await userRepo.save(adminUser);
    console.log("✅ Super Admin user created");
  } else {
    // keep existing user in sync with the canonical role
    adminUser.roleId = adminRole._id;
    adminUser.isActive = true;
    adminUser.isDeleted = false;
    await userRepo.save(adminUser);
    console.log("✅ Super Admin user already exists — synced roleId/status");
  }

  console.log("✅ Seed Completed");
}
