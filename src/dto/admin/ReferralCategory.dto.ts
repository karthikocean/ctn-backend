import { IsString, IsNotEmpty } from "class-validator";

export class CreateReferralCategoryDto {
  /**
   * Comma separated IDs of sub-categories
   * @example "69fd7c490b0852278dae9238,69f474c21188ef37999c2339"
   */
  @IsString()
  @IsNotEmpty()
    subCategory!: string;

  /**
   * The ID of the referral parent category
   */
  @IsString()
  @IsNotEmpty()
    refferalCategory!: string;
}
