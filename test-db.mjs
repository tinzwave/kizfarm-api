import mongoose from "mongoose";

const mongoUri = "mongodb+srv://webmaster:webmaster@cluster0.octxyt3.mongodb.net/?appName=Cluster0";

async function main() {
  try {
    await mongoose.connect(mongoUri, { dbName: "kizfarm" });
    console.log("Connected successfully to MongoDB");
    
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log("Collections:", collections.map(c => c.name));

    for (const coll of collections) {
      const count = await mongoose.connection.db.collection(coll.name).countDocuments();
      console.log(`- ${coll.name}: ${count} documents`);
    }

    const db = mongoose.connection.db;
    
    const users = await db.collection("users").find().limit(3).toArray();
    console.log("\nSample Users:", JSON.stringify(users, null, 2));

    const farmers = await db.collection("farmers").find().limit(3).toArray();
    console.log("\nSample Farmers:", JSON.stringify(farmers, null, 2));

    const products = await db.collection("products").find().limit(3).toArray();
    console.log("\nSample Products:", JSON.stringify(products, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
