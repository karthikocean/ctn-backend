/**
 * Tests for UserToken Token Indexing & Metadata (P2-4)
 */

import { getMetadataArgsStorage } from "typeorm";
import { UserToken } from "../src/entity/UserToken";
import { ensureMongoIndexes } from "../src/utils/ensureIndexes";

describe("UserToken Indexing & Query Verification (P2-4)", () => {
  test("1. UserToken entity metadata contains indexes for token, userId, and (userId, token)", () => {
    const indices = getMetadataArgsStorage().indices.filter(
      (idx) => idx.target === UserToken
    );

    expect(indices.length).toBeGreaterThanOrEqual(3);

    const indexedFieldSets = indices.map((idx) => {
      if (idx.columns && Array.isArray(idx.columns)) {
        return (idx.columns as string[]).slice().sort().join(",");
      }
      return "";
    });

    // Verify presence of single-field token index
    expect(indexedFieldSets).toContain("token");
    // Verify presence of compound (token, userId) index
    expect(indexedFieldSets).toContain("token,userId");
    // Verify presence of userId index
    expect(indexedFieldSets).toContain("userId");
  });

  test("2. ensureMongoIndexes calls createCollectionIndex for UserToken indices", async () => {
    const mockCreateCollectionIndex = jest.fn().mockResolvedValue("index_created");

    const mockDataSource: any = {
      isInitialized: true,
      entityMetadatas: [
        {
          target: UserToken,
          tableName: "user_tokens",
          indices: [
            { givenColumnNames: ["token"], isUnique: false, isSparse: false },
            { givenColumnNames: ["userId", "token"], isUnique: false, isSparse: false },
            { givenColumnNames: ["userId"], isUnique: false, isSparse: false }
          ]
        }
      ],
      getMongoRepository: jest.fn().mockReturnValue({
        createCollectionIndex: mockCreateCollectionIndex
      })
    };

    const result = await ensureMongoIndexes(mockDataSource);

    expect(result.totalIndexes).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(mockCreateCollectionIndex).toHaveBeenCalledWith(
      { token: 1 },
      expect.objectContaining({ background: true })
    );
    expect(mockCreateCollectionIndex).toHaveBeenCalledWith(
      { userId: 1, token: 1 },
      expect.objectContaining({ background: true })
    );
    expect(mockCreateCollectionIndex).toHaveBeenCalledWith(
      { userId: 1 },
      expect.objectContaining({ background: true })
    );
  });
});
