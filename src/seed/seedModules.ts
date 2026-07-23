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
    { name: "Admin Users" },
    { name: "Roles Permissions" },
    { name: "Business Regions" },

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
    // { name: "Awards" },
    { name: "Members" },

    { name: "Activities" },

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
    { name: "Franchises" },
    { name: "Referral" },
    { name: "Billings" },
    { name: "Coupons" },
    { name: "Marketplace Category" },
    { name: "Help Center" },

    { name: "Modules" },
  ];

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
      console.log(`⏭️  Skipped (already exists): ${mod.name}`);
    }

    sortOrder++;
  }

  console.log("✅ Module Seeding Completed.");
}
