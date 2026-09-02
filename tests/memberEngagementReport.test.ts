/**
 * Tests for Member Connection & Engagement Activity Summary and Drilldown APIs
 */

import { ObjectId } from "mongodb";
import { ConnectionController } from "../src/controllers/admin/ConnectionController";
import { Connection, ConnectionStatus } from "../src/entity/Connection";
import { Member } from "../src/entity/Member";

describe("Admin Member Connection & Engagement Report API", () => {
  let controller: ConnectionController;

  beforeEach(() => {
    controller = new ConnectionController();
  });

  test("1. Controller has getEngagementSummary and getDrilldownList methods defined", () => {
    expect(typeof controller.getEngagementSummary).toBe("function");
    expect(typeof controller.getDrilldownList).toBe("function");
    expect(typeof controller.getConnectionsList).toBe("function");
  });

  test("2. getDrilldownList rejects missing memberId or type", async () => {
    const mockRes: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    const res1 = await controller.getDrilldownList("", "sent_accepted", 0, 10, "", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);

    const res2 = await controller.getDrilldownList(new ObjectId().toString(), "", 0, 10, "", mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });
});
