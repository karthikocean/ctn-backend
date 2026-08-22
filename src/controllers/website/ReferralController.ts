import {
    JsonController,
    Get,
    Param,
    QueryParam,
    Res,
    NotFoundError,
    BadRequestError,
    Req
} from "routing-controllers";
import { AppDataSource } from "../../data-source";
import { ObjectId } from "mongodb";
import { StatusCodes } from "http-status-codes";
import handleErrorResponse from "../../utils/commonFunction";
import { ApiError } from "../../utils";

/**
 * @swagger
 * tags:
 *   name: Website Blogs
 *   description: Public website blog list and detail APIs
 */

@JsonController("/ref")
export class WebsiteReferralController {
    @Get("/:code")
    async getBlogBySlugOrId(@Param("code") code: string, @Req() req: any, @Res() res: any) {
        try {
            if (!code) {
                throw new ApiError(400, 'Referral Code Required')
            }
            const userAgent = req.headers["user-agent"] || "";
            const isAndroid = /android/i.test(userAgent);
            const isIOS = /iPad|iPhone|iPod/.test(userAgent);
            if (isAndroid) {
                return res.redirect(`https://play.google.com/store/apps/details?id=com.oceansoftware.ctn_business_app&pcampaignid=web_share`);
            } else if (isIOS) {
                return res.redirect(`https://apps.apple.com/in/app/trusted-network/id6786537784`);
            }
            // Desktop: render landing page
            return res.render("referral-landing", { code });
        } catch (error: any) {
            return handleErrorResponse(error, res);
        }
    }
}
