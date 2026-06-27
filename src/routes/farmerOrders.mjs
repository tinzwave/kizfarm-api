import express from "express";
import mongoose from "mongoose";
import Order from "../models/Order.mjs";
import Farmer from "../models/Farmer.mjs";
import { requireAuth } from "../middleware/auth.mjs";
import { refundEscrowForOrder } from "../lib/escrowLedger.mjs";
import User from "../models/User.mjs";
import {
  notifyEmail,
  sendOrderStatusEmail,
  sendAdminOrderStatusEmail
} from "../lib/mailer.mjs";

const router = express.Router();

// GET /farmer-orders/  — all orders for the logged-in farmer
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    const { status } = req.query;
    const filter = { farmerId: farmer._id };
    if (status) filter.status = status;

    const orders = await Order.find(filter)
      .populate("buyerId", "name email phone")
      .populate("driverId", "name phone vehicleType")
      .sort({ createdAt: -1 });

    return res.json({ ok: true, orders });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /farmer-orders/:id  — single order detail
router.get("/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      farmerId: farmer._id,
    })
      .populate("buyerId", "name email phone")
      .populate("driverId", "name phone vehicleType currentLocation");

    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /farmer-orders/:id/accept  — farmer accepts the order (pending → accepted_by_farmer)
router.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer)
      return res.status(404).json({ error: "Farmer record not found" });

    const order = await Order.findOne({
      _id: req.params.id,
      farmerId: farmer._id,
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Only pending orders can be accepted" });
    }

    order.status = "accepted_by_farmer";
    order.acceptedAt = new Date();
    if (req.body.notes) order.farmerNotes = req.body.notes;
    await order.save();

    const buyer = await User.findById(order.buyerId);
    if (buyer?.email) {
      notifyEmail(
        "Buyer order accepted notification",
        sendOrderStatusEmail(order, buyer.email, "Farmer accepted your order", "The farmer has accepted your order, and it is now awaiting confirmation from our admin team.")
      );
    }
    notifyEmail(
      "Admin order accepted notification",
      sendAdminOrderStatusEmail(order, "Farmer accepted", "Farmer has accepted the order. It is now ready for admin confirmation.")
    );

    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /farmer-orders/:id/reject  — farmer rejects the order (pending → rejected)
router.post("/:id/reject", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer)
      return res.status(404).json({ error: "Farmer record not found" });

    const order = await Order.findOne({
      _id: req.params.id,
      farmerId: farmer._id,
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Only pending orders can be rejected" });
    }

    order.status = "rejected";
    order.cancelledAt = new Date();
    order.cancellationReason = req.body.reason || "Rejected by farmer";
    await order.save();
    await refundEscrowForOrder(order, {
      reason: order.cancellationReason,
      actorUserId: req.user.sub,
    });

    const buyer = await User.findById(order.buyerId);
    if (buyer?.email) {
      notifyEmail(
        "Buyer order rejected notification",
        sendOrderStatusEmail(order, buyer.email, "Order rejected and refund pending", `We regret to inform you that the farmer rejected your order. A refund has been initiated to your balance. Reason: ${order.cancellationReason || "Rejected by farmer"}`)
      );
    }
    notifyEmail(
      "Admin order rejected notification",
      sendAdminOrderStatusEmail(order, "Farmer rejected order", `Farmer rejected the order. A refund has been initiated. Reason: ${order.cancellationReason || "Rejected by farmer"}`)
    );

    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /farmer-orders/:id/pack  — farmer marks as packed (ready for pickup)
// Only allowed after admin confirms the order
router.post("/:id/pack", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer)
      return res.status(404).json({ error: "Farmer record not found" });

    const order = await Order.findOne({
      _id: req.params.id,
      farmerId: farmer._id,
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "confirmed") {
      return res
        .status(400)
        .json({
          error:
            "Order must be confirmed by admin before packing. Current status: " +
            order.status,
        });
    }

    order.status = "packed";
    order.packedAt = new Date();
    await order.save();

    const buyer = await User.findById(order.buyerId);
    if (buyer?.email) {
      notifyEmail(
        "Buyer order packed notification",
        sendOrderStatusEmail(order, buyer.email, "Your order has been packed", "The farmer has packed your order. It is now ready for pickup.")
      );
    }
    notifyEmail(
      "Admin order packed notification",
      sendAdminOrderStatusEmail(order, "Order is packed and ready for driver/logistics", "The farmer has marked the order as packed. You can now assign a driver.")
    );

    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
