import { AppDataSource } from "../data-source";
import { AdminUser } from "../entity/AdminUser";

export async function generateAdminUserId(): Promise<string> {
  try {
    const lastAdminUser = await AppDataSource.getMongoRepository(AdminUser).findOne({
      where: {},
      order: { createdAt: "DESC" as any }
    });

    const lastId = lastAdminUser?.userId?.replace("US", "") || "000";
    const numeric = parseInt(lastId) || 0;
    const newId = `US${(numeric + 1).toString().padStart(3, "0")}`;
    return newId;
  } catch (err) {
    throw err;
  }
}

// export async function generateVacancyRequestNumber(): Promise<string> {
//     try {
//         const lastVacancy = await AppDataSource.getMongoRepository(Vacancy).findOne({
//             where: {},
//             order: { createdAt: "DESC" as any }
//         });

//         // Format: REQ-YYYY-NNN
//         const year = new Date().getFullYear();
//         const prefix = `REQ-${year}-`;

//         let numeric = 0;
//         if (lastVacancy && lastVacancy.requestNumber && lastVacancy.requestNumber.startsWith(prefix)) {
//             const lastIdSequence = lastVacancy.requestNumber.replace(prefix, '');
//             numeric = parseInt(lastIdSequence) || 0;
//         }

//         const newId = `${prefix}${(numeric + 1).toString().padStart(3, '0')}`;
//         return newId;
//     } catch (err) {
//         throw err;
//     }
// }

// export async function generateProjectCode(): Promise<string> {
//     try {
//         const lastProject = await AppDataSource.getMongoRepository(Project).findOne({
//             where: {},
//             order: { createdAt: "DESC" as any }
//         });

//         // Format: PRJ-NNN
//         const prefix = `PRJ-`;

//         let numeric = 0;
//         if (lastProject && lastProject.code && lastProject.code.startsWith(prefix)) {
//             const lastIdSequence = lastProject.code.replace(prefix, '');
//             numeric = parseInt(lastIdSequence) || 0;
//         }

//         const newId = `${prefix}${(numeric + 1).toString().padStart(3, '0')}`;
//         return newId;
//     } catch (err) {
//         // Project entity might not be loaded when this first runs, similar to Vacancy
//         throw err;
//     }
// }

// export async function generateCandidateCode(): Promise<string> {
//     try {
//         const lastCandidate = await AppDataSource.getMongoRepository(Candidate).findOne({
//             where: {},
//             order: { createdAt: "DESC" as any }
//         });

//         const year = new Date().getFullYear();
//         const prefix = `CAN-${year}-`;

//         let numeric = 0;
//         if (lastCandidate && lastCandidate.candidateCode && lastCandidate.candidateCode.startsWith(prefix)) {
//             const lastIdSequence = lastCandidate.candidateCode.replace(prefix, '');
//             numeric = parseInt(lastIdSequence) || 0;
//         }

//         const newId = `${prefix}${(numeric + 1).toString().padStart(3, '0')}`;
//         return newId;
//     } catch (err) {
//         throw err;
//     }
// }

// export async function generateInterviewCode(): Promise<string> {
//     try {
//         const lastInterview = await AppDataSource.getMongoRepository(Interview).findOne({
//             where: { isDelete: 0 },
//             order: { createdAt: "DESC" as any }
//         });

//         // Format: INT-YYYY-NNN
//         const year = new Date().getFullYear();
//         const prefix = `INT-${year}-`;

//         let numeric = 0;
//         if (lastInterview && lastInterview.interviewCode && lastInterview.interviewCode.startsWith(prefix)) {
//             const lastIdSequence = lastInterview.interviewCode.replace(prefix, '');
//             numeric = parseInt(lastIdSequence) || 0;
//         }

//         const newId = `${prefix}${(numeric + 1).toString().padStart(3, '0')}`;
//         return newId;
//     } catch (err) {
//         throw err;
//     }
// }

// export async function generateOfferCode(): Promise<string> {
//     try {
//         const lastOffer = await AppDataSource.getMongoRepository(Offer).findOne({
//             where: { isDelete: 0 },
//             order: { createdAt: "DESC" as any }
//         });

//         const year = new Date().getFullYear();
//         const prefix = `OFF-${year}-`;

//         let numeric = 0;
//         if (lastOffer && lastOffer.offerCode && lastOffer.offerCode.startsWith(prefix)) {
//             const lastIdSequence = lastOffer.offerCode.replace(prefix, '');
//             numeric = parseInt(lastIdSequence) || 0;
//         }

//         const newId = `${prefix}${(numeric + 1).toString().padStart(3, '0')}`;
//         return newId;
//     } catch (err) {
//         throw err;
//     }
// }
