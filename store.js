const { MongoClient, Int32 } = require("mongodb");

const MONGODB_URI = "mongodb+srv://olaj39767:HasstpdmYQrCZztP@cluster0.ywktsea.mongodb.net/";
const DB_NAME = "test"; // replace with your actual db name
const COLLECTION = "users"; // replace with your actual collection name

const generateReferralCode = (userId) => {
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const suffix = userId.toString().slice(-4).toUpperCase();
  return `REF-${suffix}-${rand}`;
};

const migrate = async () => {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION);

    // Find all users missing referralCode or storeCredit
    const users = await collection
      .find({
        $or: [
          { referralCode: { $exists: false } },
          { storeCredit: { $exists: false } },
        ],
      })
      .toArray();

    console.log(`Found ${users.length} users to migrate`);

    let updated = 0;
    let skipped = 0;

    for (const user of users) {
      const updateFields = {};

      if (!user.referralCode) {
        let code = generateReferralCode(user._id);

        // Ensure uniqueness
        const existing = await collection.findOne({ referralCode: code });
        if (existing) {
          code =
            generateReferralCode(user._id) +
            Math.random().toString(36).substring(2, 4).toUpperCase();
        }

        updateFields.referralCode = code;
      }

      if (user.storeCredit === undefined || user.storeCredit === null) {
        updateFields.storeCredit = new Int32(0);
      }

      if (Object.keys(updateFields).length === 0) {
        skipped++;
        continue;
      }

      await collection.updateOne(
        { _id: user._id },
        { $set: updateFields }
      );

      console.log(`✓ Updated user ${user._id} →`, updateFields);
      updated++;
    }

    console.log(`\nMigration complete: ${updated} updated, ${skipped} skipped`);
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await client.close();
  }
};

migrate();