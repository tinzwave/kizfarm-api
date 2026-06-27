import express from "express";
import { requireAdmin } from "../middleware/auth.mjs";
import Order from "../models/Order.mjs";
import Escrow from "../models/Escrow.mjs";
import Farmer from "../models/Farmer.mjs";
import { refundEscrowForOrder, releaseEscrowToFarmer } from "../lib/escrowLedger.mjs";
import User from "../models/User.mjs";
import {
  notifyEmail,
  sendFarmerPayoutReleasedEmail,
  sendOrderStatusEmail,
  sendAdminOrderStatusEmail
} from "../lib/mailer.mjs";

const router = express.Router();

// Admin: List all escrow transactions
router.get("/", requireAdmin, async (req, res) => {
  try {
    const { status, farmerId, limit = 10, offset = 0 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (farmerId) filter.farmerId = farmerId;

    const total = await Escrow.countDocuments(filter);
    const escrows = await Escrow.find(filter)
      .populate("buyerId", "name email")
      .populate("farmerId", "fullName farmName location phone")
      .populate("orderId", "status items total createdAt deliveryAddress paymentStatus escrowStatus")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({
      success: true,
      total,
      escrows,
    });
  } catch (error) {
    console.error("Escrow list error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get summary stats
router.get("/stats/summary", requireAdmin, async (req, res) => {
  try {
    const totalPending = await Escrow.countDocuments({ status: "pending" });
    const totalReleased = await Escrow.countDocuments({ status: "released" });
    const totalRefunded = await Escrow.countDocuments({ status: "refunded" });

    const pendingAmount = await Escrow.aggregate([
      { $match: { status: "pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const releasedAmount = await Escrow.aggregate([
      { $match: { status: "released" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    res.json({
      success: true,
      stats: {
        totalPending,
        totalReleased,
        totalRefunded,
        pendingAmount: pendingAmount[0]?.total || 0,
        releasedAmount: releasedAmount[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get escrow detail
router.get("/:id", requireAdmin, async (req, res) => {
  try {
    const escrow = await Escrow.findById(req.params.id)
      .populate("orderId")
      .populate("buyerId", "name email phone")
      .populate("farmerId", "fullName farmName location farmAddress phone bankDetails")
      .populate("releasedBy", "name email")
      .populate("refundedBy", "name email");

    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }

    res.json({
      success: true,
      escrow,
    });
  } catch (error) {
    console.error("Escrow detail error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Admin: Release escrow funds
router.post("/:id/release", requireAdmin, async (req, res) => {
  try {
    const { releaseNotes } = req.body;
    const escrow = await Escrow.findById(req.params.id);

    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }

    const { order } = await releaseEscrowToFarmer(escrow, {
      adminUserId: req.userId,
      releaseNotes,
    });

    const farmer = await Farmer.findById(escrow.farmerId).populate("userId");
    if (farmer && farmer.userId && farmer.userId.email) {
      notifyEmail(
        "Farmer payout released notification",
        sendFarmerPayoutReleasedEmail(order, escrow, farmer.userId.email)
      );
    }
    const buyer = await User.findById(order.buyerId);
    if (buyer?.email) {
      notifyEmail(
        "Buyer payout released confirmation",
        sendOrderStatusEmail(order, buyer.email, "Escrow funds released to farmer", "The escrow funds for your order have been released to the farmer.")
      );
    }
    notifyEmail(
      "Admin payout released confirmation",
      sendAdminOrderStatusEmail(order, "Escrow funds released", `Escrow funds of NGN ${escrow.amount.toLocaleString()} have been released to the farmer.`)
    );

    res.json({
      success: true,
      message: "Escrow funds released successfully",
      escrow,
      order,
    });
  } catch (error) {
    console.error("Escrow release error:", error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Admin: Refund escrow (for cancelled orders)
router.post("/:id/refund", requireAdmin, async (req, res) => {
  try {
    const { refundReason } = req.body;
    const escrow = await Escrow.findById(req.params.id);

    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }

    if (escrow.status === "refunded") {
      return res.status(400).json({ error: "Escrow already refunded" });
    }

    const order = await Order.findById(escrow.orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    await refundEscrowForOrder(order, {
      reason: refundReason || "Refunded by admin",
      actorUserId: req.userId,
    });

    const buyer = await User.findById(order.buyerId);
    const farmer = await Farmer.findById(order.farmerId).populate("userId", "email");
    if (buyer?.email) {
      notifyEmail(
        "Buyer order refunded notification",
        sendOrderStatusEmail(order, buyer.email, "Order refunded", `Your payment for order has been refunded to your balance. Reason: ${refundReason || "Refunded by admin"}`)
      );
    }
    if (farmer?.userId?.email) {
      notifyEmail(
        "Farmer order refunded notification",
        sendOrderStatusEmail(order, farmer.userId.email, "Order refunded", `The order has been cancelled and refunded.`)
      );
    }
    notifyEmail(
      "Admin order refunded notification",
      sendAdminOrderStatusEmail(order, "Order refunded record", `Order was refunded. Reason: ${refundReason || "Refunded by admin"}`)
    );

    res.json({
      success: true,
      message: "Escrow refunded successfully",
      escrow,
    });
  } catch (error) {
    console.error("Escrow refund error:", error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

export default router;
