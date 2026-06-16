import { JsonController, Get, QueryParam, Res, UseBefore } from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { PostReport } from "../../entity/PostReport";
import { PostModel } from "../../entity/Post";
import { Member } from "../../entity/Member";
import { ObjectId } from "mongodb";
import { AuthMiddleware } from "../../middlewares/AuthMiddleware";
import handleErrorResponse from "../../utils/commonFunction";
import { pagination } from "../../utils";

@JsonController("/post-reports")
@UseBefore(AuthMiddleware)
export class PostReportController {
  private postReportRepo = AppDataSource.getMongoRepository(PostReport);
  private memberRepo = AppDataSource.getMongoRepository(Member);
  private postRepo = AppDataSource.getMongoRepository(PostModel);

  @Get("/")
  async getAllReports(
    @QueryParam("page") page: number = 0,
    @QueryParam("limit") limit: number = 20,
    @Res() res: any
  ) {
    try {
      // 1. Fetch reported history with pagination
      const [reports, total] = await this.postReportRepo.findAndCount({
        order: { createdAt: "DESC" },
        take: limit,
        skip: page * limit
      });

      // 2. Get unique member and post IDs
      const memberIds: ObjectId[] = [];
      const postIds: ObjectId[] = [];
      reports.forEach(r => {
        if (r.reporterId) memberIds.push(r.reporterId);
        if (r.postId) postIds.push(r.postId);
      });

      // 3. Fetch member details
      const members = memberIds.length > 0
        ? await this.memberRepo.find({
          where: { _id: { $in: memberIds } } as any,
          select: ["_id", "fullName", "profilePhoto", "mobileNumber"]
        })
        : [];

      // 4. Fetch post details and their owners
      const posts = postIds.length > 0
        ? await this.postRepo.find({
          where: { _id: { $in: postIds } } as any,
          select: ["_id", "title", "description", "type", "memberId"]
        })
        : [];

      // Add post owner IDs to memberIds query list
      const postOwnerIds: ObjectId[] = [];
      posts.forEach(p => {
        if (p.memberId) postOwnerIds.push(p.memberId);
      });

      const postOwners = postOwnerIds.length > 0
        ? await this.memberRepo.find({
          where: { _id: { $in: postOwnerIds } } as any,
          select: ["_id", "fullName", "mobileNumber"]
        })
        : [];

      // 5. Create maps for quick lookup
      const memberMap = new Map(members.map(m => [m._id.toString(), m]));
      const postMap = new Map(posts.map(p => [p._id.toString(), p]));
      const postOwnerMap = new Map(postOwners.map(m => [m._id.toString(), m]));

      // 6. Populate names in the result
      const results = reports.map(report => {
        const reporter = memberMap.get(report.reporterId?.toString());
        const post = report.postId ? postMap.get(report.postId.toString()) : null;
        const postOwner = post?.memberId ? postOwnerMap.get(post.memberId.toString()) : null;

        return {
          ...report,
          reporterName: reporter ? reporter.fullName : "Unknown",
          reporterMobile: reporter ? reporter.mobileNumber : null,
          post: post ? {
            _id: post._id,
            title: post.title,
            description: post.description,
            type: post.type,
            ownerName: postOwner ? postOwner.fullName : "Unknown",
            ownerMobile: postOwner ? postOwner.mobileNumber : null
          } : null
        };
      });

      return pagination(total, results, limit, page, res);
    } catch (error: any) {
      return handleErrorResponse(error, res);
    }
  }
}
