import "dotenv/config";
import mongoose from "mongoose";
import Order from "../src/models/Order.mjs";
import Product from "../src/models/Product.mjs";
import { decrementStockForOrder } from "../src/lib/inventory.mjs";

const mongoUri =
  process.env.MONGODB_URI ||
  "mongodb+srv://webmaster:webmaster@cluster0.octxyt3.mongodb.net/?appName=Cluster0";
const apply = process.argv.includes("--apply");
const forceZero = process.argv.includes("--force-zero");

async function forceReconcileOrder(order) {
  for (const item of order.items || []) {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const product = await Product.findById(item.productId).select("name quantity unit");
    if (!product || product.quantity === null || product.quantity === undefined) {
      continue;
    }

    const nextQuantity = Math.max(0, product.quantity - quantity);
    await Product.updateOne(
      { _id: product._id },
      { $set: { quantity: nextQuantity } },
    );
    console.log(
      `- ${product.name}: ${product.quantity} -> ${nextQuantity} ${product.unit || "units"}`,
    );
  }

  order.stockAdjusted = true;
  order.stockAdjustedAt = new Date();
  await order.save();
}

async function main() {
  await mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB || "kizfarm" });

  const orders = await Order.find({
    paymentStatus: "paid",
    stockAdjusted: { $ne: true },
    status: { $nin: ["cancelled", "rejected"] },
  }).sort({ paidAt: 1, createdAt: 1 });

  console.log(`Found ${orders.length} paid order(s) without stock adjustment.`);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to update product quantities.");
    console.log("Use --force-zero with --apply to clamp old insufficient stock to 0 and continue.");
    for (const order of orders) {
      console.log(`- ${order._id} total=${order.total} items=${order.items.length}`);
    }
    return;
  }

  let adjusted = 0;
  let skipped = 0;
  for (const order of orders) {
    try {
      if (forceZero) {
        await forceReconcileOrder(order);
      } else {
        await decrementStockForOrder(order);
      }
      adjusted += 1;
      console.log(`Adjusted stock for order ${order._id}`);
    } catch (error) {
      skipped += 1;
      console.error(`Skipped order ${order._id}: ${error.message}`);
    }
  }

  console.log(`Done. Adjusted ${adjusted} order(s). Skipped ${skipped} order(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
