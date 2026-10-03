import {
  Entity,
  ObjectIdColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from "typeorm";
import { ObjectId } from "mongodb";

@Entity("oauth_grants")
@Index(["userId", "clientId"])
@Index(["userId", "isRevoked"])
@Index(["authorizationCodeHash"])
@Index(["accessTokenHash"])
@Index(["refreshTokenHash"])
@Index(["expiresAt"])
export class OAuthGrant {
  @ObjectIdColumn()
    _id!: ObjectId;

  @Column()
    userId!: ObjectId;

  @Column({ default: "chatgpt-mcp" })
    clientId!: string;

  @Column("json")
    scopes!: string[];

  @Column({ nullable: true })
    authorizationCodeHash?: string;

  @Column({ nullable: true })
    accessTokenHash?: string;

  @Column({ nullable: true })
    refreshTokenHash?: string;

  @Column({ default: false })
    isRevoked!: boolean;

  @Column({ nullable: true })
    revokedAt?: Date;

  @Column({ default: "https://mcp.trustednetwork.in" })
    resource!: string;

  @Column({ nullable: true })
    lastUsedAt?: Date;

  @Column()
    expiresAt!: Date;

  @CreateDateColumn()
    createdAt!: Date;

  @UpdateDateColumn()
    updatedAt!: Date;
}
