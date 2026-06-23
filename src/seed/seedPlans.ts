import { AppDataSource } from "../data-source";
import { Plan } from "../entity/Plan";

export async function seedPlans() {
    const planRepo = AppDataSource.getMongoRepository(Plan);

    const plans = [
        {
            title: "Basic",
            description: "Basic Trusted Network Plan",
            amount: 4999,
            status: "active",
            billingType: "basic",
            billingCycle: "yearly",
            trialDays: 30,
            modules: [
                { moduleName: "Post", countLimit: 1, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Ask", countLimit: 1, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Give", countLimit: 5, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Requirement", countLimit: 1, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Milestone", countLimit: 1, frequency: "daily", frequencyValue: 1 }
            ],

            features: {
                monthlyMeeting: false,
                eventVisitor: true,
                eventStall: false,
                spotlights: false
            },

            benefits: {
                marketplaceProductLimit: 0,
                pointMultiplier: 1,
                trainingDiscountPercentage: 0,
                referralBonusMonths: 0
            }
        },

        {
            title: "Advance",
            description: "Advance Trusted Network Plan",
            amount: 9999,
            status: "active",
            billingType: "advance",
            billingCycle: "yearly",
            trialDays: 30,
            modules: [
                { moduleName: "Post", countLimit: 3, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Ask", countLimit: 3, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Give", countLimit: 5, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Requirement", countLimit: 5, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Milestone", countLimit: 3, frequency: "daily", frequencyValue: 1 }
            ],

            features: {
                monthlyMeeting: true,
                eventVisitor: true,
                eventStall: false,
                spotlights: false
            },

            benefits: {
                marketplaceProductLimit: 3,
                pointMultiplier: 1,
                trainingDiscountPercentage: 10,
                referralBonusMonths: 1
            }
        },

        {
            title: "Ultimate",
            description: "Ultimate Trusted Network Plan",
            amount: 19999,
            status: "active",
            billingType: "ultimate",
            billingCycle: "yearly",
            trialDays: 30,
            modules: [
                { moduleName: "Post", countLimit: 10, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Ask", countLimit: 10, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Give", countLimit: 10, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Requirement", countLimit: 10, frequency: "daily", frequencyValue: 1 },
                { moduleName: "Milestone", countLimit: 10, frequency: "daily", frequencyValue: 1 }
            ],

            features: {
                monthlyMeeting: true,
                eventVisitor: true,
                eventStall: true,
                spotlights: true
            },

            benefits: {
                marketplaceProductLimit: 5,
                pointMultiplier: 2,
                trainingDiscountPercentage: 25,
                referralBonusMonths: 2
            }
        }
    ];

    for (const plan of plans) {
        const exists = await planRepo.findOne({
            where: {
                title: plan.title,
                isDeleted: false
            }
        });

        if (!exists) {
            await planRepo.save(plan as unknown as Plan);
            console.log(`✅ Created Plan: ${plan.title}`);
        } else {
            console.log(`ℹ️ Plan already exists: ${plan.title}`);
        }
    }
}