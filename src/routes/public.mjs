import express from "express";
import crypto from "crypto";
import Product from "../models/Product.mjs";
import Order from "../models/Order.mjs";
import Subscription from "../models/Subscription.mjs";
import Escrow from "../models/Escrow.mjs";

const router = express.Router();

// GET /marketplace/products - Get all products for the marketplace
router.get("/marketplace/products", async (req, res) => {
  try {
    const { category, q } = req.query;

    let query = {};
    if (category) {
      query.category = new RegExp(`^${String(category).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    }
    if (q) {
      const search = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: search }, { description: search }, { category: search }];
    }

    const products = await Product.find(query)
      .populate("farmerId", "_id farmName location")
      .sort({ createdAt: -1 });

    return res.json({ ok: true, products });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /marketplace/products/:id - Get a specific product for marketplace detail view
router.get("/marketplace/products/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id)
      .populate("farmerId", "_id farmName location");

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    return res.json({ ok: true, product });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /paystack-webhook
router.post("/paystack-webhook", async (req, res) => {
  try {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      console.warn("Paystack Secret Key is not set, webhook signature verification skipped.");
      return res.status(500).json({ error: "Paystack secret key is not set" });
    }

    const signature = req.headers["x-paystack-signature"];
    if (!signature) {
      return res.status(401).send("No signature header");
    }

    const hash = crypto
      .createHmac("sha512", secretKey)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== signature) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;
    if (event.event === "charge.success") {
      const { reference, amount, customer } = event.data;
      console.log(`Webhook: payment success for ref: ${reference}, amount: ${amount}, email: ${customer?.email}`);
      
      // Update matching pending orders
      const orders = await Order.find({ paymentReference: reference, paymentStatus: "pending" });
      if (orders.length > 0) {
        for (const order of orders) {
          order.paymentStatus = "paid";
          order.paidAt = new Date();
          await order.save();

          // Create Escrow entry if it doesn't exist yet
          const escrowExists = await Escrow.exists({ orderId: order._id });
          if (!escrowExists) {
            await Escrow.create({
              orderId: order._id,
              masterOrderId: order.masterOrderId,
              buyerId: order.buyerId,
              farmerId: order.farmerId,
              amount: order.total,
              status: "pending",
            });
          }
        }
      }

      // Update matching pending subscriptions
      const subscription = await Subscription.findOne({ paymentReference: reference, status: { $ne: "active" } });
      if (subscription) {
        subscription.status = "active";
        subscription.paidAt = new Date();
        await subscription.save();
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Paystack Webhook handling error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
