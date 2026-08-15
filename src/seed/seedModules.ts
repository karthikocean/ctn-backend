import { AppDataSource } from "../data-source";
import { Module } from "../entity/Module";

interface ModuleSeed {
  name: string;
  parentSlug?: string | null;
}

export async function seedModules() {
  console.log("🌱 Seeding modules...");
  const moduleRepo = AppDataSource.getMongoRepository(Module);

  const modules: ModuleSeed[] = [
    { name: "Dashboard" },
    { name: "Roles Permissions" },
    { name: "Admin Users" },
    { name: "Business Regions" },
    { name: "Franchises" },

    { name: "Categories" },
    { name: "Main Categories", parentSlug: "categories" },
    { name: "Sub Categories", parentSlug: "categories" },
    { name: "Referral Categories", parentSlug: "categories" },

    { name: "Announcements" },
    { name: "Events" },
    { name: "Blogs" },

    { name: "Trainings" },
    { name: "Training Categories", parentSlug: "trainings" },

    { name: "Points" },
    { name: "Points Management", parentSlug: "points" },
    { name: "Allocate Points", parentSlug: "points" },

    { name: "Members" },

    { name: "Activities" },
    { name: "Asks", parentSlug: "activities" },
    { name: "Gives", parentSlug: "activities" },
    { name: "Posts", parentSlug: "activities" },
    { name: "Requirements", parentSlug: "activities" },

    { name: "Spotlight" },
    { name: "Spotlight Request", parentSlug: "spotlight" },
    { name: "Spotlight Creation", parentSlug: "spotlight" },

    { name: "Connections" },
    { name: "Contributions" },

    { name: "Reports" },
    { name: "Subscription Renewal Report", parentSlug: "reports" },
    { name: "Free Subscription Ending Report", parentSlug: "reports" },
    { name: "Franchise Commission Report", parentSlug: "reports" },
    { name: "Report History", parentSlug: "reports" },

    { name: "Plans" },
    { name: "Referral" },
    { name: "Billings" },
    { name: "Coupons" },
    { name: "Help Center" },

    { name: "Modules" },
  ];

  // Remove deprecated modules from database
  await moduleRepo.updateMany(
    { slugName: "marketplace_category" } as any,
    { $set: { isDelete: 1, isActive: 0 } } as any
  );

  let sortOrder = 0;

  for (const mod of modules) {
    const slugName = mod.name.replace(/\s+/g, "_").toLowerCase();

    const existing = await moduleRepo.findOne({
      where: { slugName, isDelete: 0 }
    });

    if (!existing) {
      const newModule = moduleRepo.create({
        name: mod.name,
        slugName,
        parentSlug: mod.parentSlug ?? null,
        sortOrder: sortOrder,
        isActive: 1,
        isDelete: 0
      });
      await moduleRepo.save(newModule);
      console.log(`✅ Seeded module: ${mod.name}`);
    } else {
      existing.sortOrder = sortOrder;
      existing.parentSlug = mod.parentSlug ?? null;
      await moduleRepo.save(existing);
      console.log(`🔄 Updated module sortOrder: ${mod.name} -> ${sortOrder}`);
    }

    sortOrder++;
  }

  console.log("✅ Module Seeding Completed.");
}
