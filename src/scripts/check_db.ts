import { MongoClient } from "mongodb";

const uri = "mongodb://anbuelumalai952002_db_user:YkZhHmUVGRxKqR4x@ac-1xqza85-shard-00-00.ldulaup.mongodb.net:27017,ac-1xqza85-shard-00-01.ldulaup.mongodb.net:27017,ac-1xqza85-shard-00-02.ldulaup.mongodb.net:27017/CTN_Dev?ssl=true&replicaSet=atlas-q3mmqs-shard-0&authSource=admin&appName=Cluster0";

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('CTN_Dev');

  // Query premium member subscriptions from member_subscriptions
  const premiumSubs = await db.collection('member_subscriptions').find({
    status: { $in: ["ACTIVE", "Active", "EXPIRED", "Expired"] },
    isTrial: { $ne: true },
    isDeleted: false
  }).toArray();

  const subMap = new Map();
  premiumSubs.forEach(sub => {
    const mId = sub.memberId.toString();
    const existing = subMap.get(mId);
    if (!existing || new Date(sub.endDate) > new Date(existing.endDate)) {
      subMap.set(mId, sub);
    }
  });

  const latestPremiumSubs = Array.from(subMap.values());
  const memberIds = latestPremiumSubs.map(s => s.memberId);

  const members = await db.collection('members').find({
    _id: { $in: memberIds },
    isDeleted: false
  }).toArray();

  console.log("Renewals API Members list output:");
  members.forEach(m => {
    console.log(`Name: ${m.fullName}, profilePhoto: ${m.profilePhoto}`);
  });

  await client.close();
}

main().catch(console.error);
