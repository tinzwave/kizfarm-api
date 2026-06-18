import express from "express";
import Farmer from "../models/Farmer.mjs";
import mongoose from "mongoose";
import User from "../models/User.mjs";
import Order from "../models/Order.mjs";
import Escrow from "../models/Escrow.mjs";
import Product from "../models/Product.mjs";
import Review from "../models/Review.mjs";
import { requireAdmin } from "../middleware/auth.mjs";
import { refundEscrowForOrder } from "../lib/escrowLedger.mjs";

const router = express.Router();

router.get("/dashboard", requireAdmin, async (req, res) => {
  try {
    const [
      totalUsers,
      totalFarmers,
      totalProducts,
      totalOrders,
      paidRevenue,
      pendingFarmers,
      recentOrders,
      recentProducts,
    ] = await Promise.all([
      User.countDocuments(),
      Farmer.countDocuments(),
      Product.countDocuments(),
      Order.countDocuments(),
      Order.aggregate([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
      Farmer.countDocuments({ status: "pending" }),
      Order.find()
        .populate("buyerId", "name email")
        .populate("farmerId", "farmName fullName")
        .sort({ createdAt: -1 })
        .limit(5),
      Product.find()
        .populate("farmerId", "farmName fullName")
        .sort({ createdAt: -1 })
        .limit(5),
    ]);

    return res.json({
      ok: true,
      stats: {
        totalUsers,
        totalFarmers,
        totalProducts,
        totalOrders,
        totalRevenue: paidRevenue[0]?.total || 0,
        pendingFarmers,
      },
      recentOrders,
      recentProducts,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/verify-farmers", requireAdmin, async (req, res) => {
  try {
    const list = await Farmer.find({ status: "pending" }).populate(
      "userId",
      "email name phone",
    );
    return res.json({ ok: true, list });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/verify-farmers/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const farmer = await Farmer.findById(id).populate(
      "userId",
      "email name phone",
    );
    if (!farmer) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true, farmer });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/verify-farmers/:id/approve", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const farmer = await Farmer.findById(id);
    if (!farmer) return res.status(404).json({ error: "Not found" });
    farmer.status = "approved";
    await farmer.save();
    // grant farmer role to user
    await User.findByIdAndUpdate(farmer.userId, { role: "farmer" });
    return res.json({ ok: true, farmer });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/verify-farmers/:id/reject", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { reason } = req.body;
    const farmer = await Farmer.findById(id);
    if (!farmer) return res.status(404).json({ error: "Not found" });
    farmer.status = "rejected";
    farmer.rejectionReason = reason || "No reason provided";
    await farmer.save();
    // optionally remove farmer role
    await User.findByIdAndUpdate(farmer.userId, { role: "user" });
    return res.json({ ok: true, farmer });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════
// User Management (Buyers)
// ═══════════════════════════════════════════════════════════════════

// GET /admin/users - List all users with filters
router.get("/users", requireAdmin, async (req, res) => {
  try {
    const {
      status = "active",
      role,
      search,
      limit = 10,
      offset = 0,
    } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select("-passwordHash")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({
      success: true,
      total,
      users,
    });
  } catch (error) {
    console.error("User list error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /admin/users/:id - Get user details
router.get("/users/:id", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-passwordHash")
      .populate("farmer");

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get active orders for this user
    const activeOrders = await Order.countDocuments({
      buyerId: user._id,
      status: { $nin: ["delivered", "receipt_confirmed", "cancelled"] },
    });

    res.json({
      success: true,
      user,
      activeOrdersCount: activeOrders,
    });
  } catch (error) {
    console.error("User detail error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /admin/users/:id/suspend - Suspend a user account
router.post("/users/:id/suspend", requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "admin") {
      return res.status(400).json({ error: "Cannot suspend admin accounts" });
    }

    // Check if user has active orders
    const activeOrders = await Order.countDocuments({
      buyerId: user._id,
      status: { $nin: ["delivered", "receipt_confirmed", "cancelled"] },
    });

    if (activeOrders > 0) {
      return res.status(400).json({
        error: "Cannot suspend user with active orders",
        activeOrdersCount: activeOrders,
      });
    }

    // Suspend the user
    user.status = "suspended";
    user.suspensionReason = reason || null;
    user.suspendedAt = new Date();
    await user.save();

    res.json({
      success: true,
      message: "User suspended successfully",
      user,
    });
  } catch (error) {
    console.error("Suspend user error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /admin/users/:id/unsuspend - Unsuspend a user account
router.post("/users/:id/unsuspend", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.status = "active";
    user.suspensionReason = null;
    user.suspendedAt = null;
    await user.save();

    res.json({
      success: true,
      message: "User unsuspended successfully",
      user,
    });
  } catch (error) {
    console.error("Unsuspend user error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Farmer Management
// ═══════════════════════════════════════════════════════════════════

// GET /admin/farmers - List all farmers with filters
router.get("/farmers", requireAdmin, async (req, res) => {
  try {
    const { status = "approved", search, limit = 10, offset = 0 } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { farmName: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }

    const total = await Farmer.countDocuments(filter);
    const farmers = await Farmer.find(filter)
      .populate("userId", "email phone status")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({
      success: true,
      total,
      farmers,
    });
  } catch (error) {
    console.error("Farmer list error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /admin/farmers/:id - Get farmer details
router.get("/farmers/:id", requireAdmin, async (req, res) => {
  try {
    const farmer = await Farmer.findById(req.params.id).populate(
      "userId",
      "email phone status",
    );

    if (!farmer) {
      return res.status(404).json({ error: "Farmer not found" });
    }

    // Get active orders
    const activeOrders = await Order.countDocuments({
      farmerId: farmer._id,
      status: { $nin: ["delivered", "receipt_confirmed", "cancelled"] },
    });

    // Get pending escrow
    const pendingEscrow = await Escrow.findOne({
      farmerId: farmer._id,
      status: "pending",
    });

    res.json({
      success: true,
      farmer,
      activeOrdersCount: activeOrders,
      hasPendingEscrow: !!pendingEscrow,
    });
  } catch (error) {
    console.error("Farmer detail error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /admin/farmers/:id/suspend - Suspend a farmer account
router.post("/farmers/:id/suspend", requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const farmer = await Farmer.findById(req.params.id);

    if (!farmer) {
      return res.status(404).json({ error: "Farmer not found" });
    }

    // Check if farmer has active orders
    const activeOrders = await Order.countDocuments({
      farmerId: farmer._id,
      status: { $nin: ["delivered", "receipt_confirmed", "cancelled"] },
    });

    if (activeOrders > 0) {
      return res.status(400).json({
        error: "Cannot suspend farmer with active orders",
        activeOrdersCount: activeOrders,
      });
    }

    // Check if farmer has pending escrow
    const pendingEscrow = await Escrow.countDocuments({
      farmerId: farmer._id,
      status: "pending",
    });

    if (pendingEscrow > 0) {
      return res.status(400).json({
        error: "Cannot suspend farmer with pending escrow payments",
        pendingEscrowCount: pendingEscrow,
      });
    }

    // Suspend the user account
    const user = await User.findById(farmer.userId);
    if (user) {
      user.status = "suspended";
      user.suspensionReason = reason || "Farmer account suspended";
      user.suspendedAt = new Date();
      await user.save();
    }

    res.json({
      success: true,
      message: "Farmer account suspended successfully",
      farmer,
    });
  } catch (error) {
    console.error("Suspend farmer error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /admin/farmers/:id/unsuspend - Unsuspend a farmer account
router.post("/farmers/:id/unsuspend", requireAdmin, async (req, res) => {
  try {
    const farmer = await Farmer.findById(req.params.id);

    if (!farmer) {
      return res.status(404).json({ error: "Farmer not found" });
    }

    const user = await User.findById(farmer.userId);
    if (user) {
      user.status = "active";
      user.suspensionReason = null;
      user.suspendedAt = null;
      await user.save();
    }

    res.json({
      success: true,
      message: "Farmer account unsuspended successfully",
      farmer,
    });
  } catch (error) {
    console.error("Unsuspend farmer error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Order Management Guards
// ═══════════════════════════════════════════════════════════════════

// GET /admin/orders/:id/can-cancel - Check if order can be cancelled
router.get("/orders/:id/can-cancel", requireAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Can only cancel if not assigned to driver
    const canCancel =
      !order.driverId &&
      order.status !== "in_transit" &&
      order.status !== "delivered";

    res.json({
      ok: true,
      canCancel,
      currentStatus: order.status,
      driverId: order.driverId,
      reason: !canCancel ? "Order has been assigned to a driver" : null,
    });
  } catch (error) {
    console.error("Can cancel check error:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /admin/users/:id - Hard-delete a buyer/user with cascade
router.delete("/users/:id", requireAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Block deletion of admin accounts
    if (user.role === "admin")
      return res.status(400).json({ error: "Cannot delete admin accounts" });

    // Cascade: remove associated Farmer record if exists
    if (user.role === "farmer") {
      const farmer = await Farmer.findOne({ userId: user._id });
      if (farmer) {
        await Product.deleteMany({ farmerId: farmer._id });
        await Farmer.findByIdAndDelete(farmer._id);
      }
    }

    await User.findByIdAndDelete(user._id);
    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /admin/farmers/:id - Hard-delete a farmer with cascade
router.delete("/farmers/:id", requireAdmin, async (req, res) => {
  try {
    const farmer = await Farmer.findById(req.params.id);
    if (!farmer) return res.status(404).json({ error: "Farmer not found" });

    // Cascade: remove their products
    await Product.deleteMany({ farmerId: farmer._id });

    // Remove the linked User document
    await User.findByIdAndDelete(farmer.userId);

    await Farmer.findByIdAndDelete(farmer._id);
    res.json({ success: true, message: "Farmer deleted successfully" });
  } catch (error) {
    console.error("Delete farmer error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Platform-Wide Product Management
// ═══════════════════════════════════════════════════════════════════

// GET /admin/products - List all products across the entire platform
router.get("/products", requireAdmin, async (req, res) => {
  try {
    const { search, limit = 20, offset = 0 } = req.query;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
      ];
    }

    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate("farmerId", "fullName farmName")
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({ success: true, total, products });
  } catch (error) {
    console.error("Admin products error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /admin/refunds - List cancelled orders for refund management
router.get("/refunds", requireAdmin, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const filter = { status: "cancelled" };
    if (status && status !== "all") filter.paymentStatus = status;

    const [total, orders] = await Promise.all([
      Order.countDocuments(filter),
      Order.find(filter)
        .populate("buyerId", "name email")
        .populate("farmerId", "fullName farmName")
        .sort({ cancelledAt: -1, updatedAt: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(offset)),
    ]);

    return res.json({
      success: true,
      total,
      refunds: orders.map((order) => ({
        _id: order._id,
        masterOrderId: order.masterOrderId,
        buyerId: order.buyerId,
        farmerId: order.farmerId,
        total: order.total,
        items: order.items,
        cancelledAt: order.cancelledAt || order.updatedAt,
        cancellationReason: order.cancellationReason,
        paymentStatus: order.paymentStatus,
        escrowStatus: order.escrowStatus,
        status: order.status,
      })),
    });
  } catch (err) {
    console.error("Admin refunds error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE /admin/products/:id - Remove any product from the platform
router.delete("/products/:id", requireAdmin, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });

    // Cascade: remove all reviews for this product
    await Review.deleteMany({ productId: product._id });

    await Product.findByIdAndDelete(product._id);
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Platform-Wide Review Management
// ═══════════════════════════════════════════════════════════════════

// GET /admin/reviews - Aggregate all reviews across the platform
router.get("/reviews", requireAdmin, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const total = await Review.countDocuments();
    const reviews = await Review.find()
      .populate("productId", "name images")
      .populate("buyerId", "name email")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({ success: true, total, reviews });
  } catch (error) {
    console.error("Admin reviews error:", error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /admin/reviews/:id - Remove/moderate a review
router.delete("/reviews/:id", requireAdmin, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: "Review not found" });

    await Review.findByIdAndDelete(review._id);
    res.json({ success: true, message: "Review deleted successfully" });
  } catch (error) {
    console.error("Delete review error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Order Cancellation Management
// ═══════════════════════════════════════════════════════════════════

// POST /admin/orders/:id/cancel - Cancel an order (Admin only)
// Rule: Can only cancel if driver has NOT been assigned yet
router.post("/orders/:id/cancel", requireAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Guard: Cannot cancel if driver is assigned
    if (order.driverId) {
      return res.status(400).json({
        error: "Cannot cancel order - driver has already been assigned",
        driverId: order.driverId,
        currentStatus: order.status,
      });
    }

    // Guard: Cannot cancel if already in transit or delivered
    if (
      ["in_transit", "delivered", "receipt_confirmed", "completed"].includes(
        order.status,
      )
    ) {
      return res.status(400).json({
        error: `Cannot cancel order with status: ${order.status}`,
        currentStatus: order.status,
      });
    }

    // Update order status
    order.status = "cancelled";
    order.cancelledAt = new Date();
    order.cancellationReason = reason || "Cancelled by admin";
    await order.save();

    // Refund the escrow (regardless of payment status)
    await refundEscrowForOrder(order, {
      reason: reason || "Order cancelled by admin",
      actorUserId: req.userId,
    });

    res.json({
      ok: true,
      message: "Order cancelled successfully and escrow refunded",
      order,
    });
  } catch (error) {
    console.error("Cancel order error:", error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// GET /admin/orders - List all orders with filters
router.get("/orders", requireAdmin, async (req, res) => {
  try {
    const {
      status,
      farmerId,
      buyerId,
      limit = 20,
      offset = 0,
      search,
    } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (farmerId) filter.farmerId = farmerId;
    if (buyerId) filter.buyerId = buyerId;
    if (search) {
      filter.$or = [{ masterOrderId: { $regex: search, $options: "i" } }];
    }

    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .populate("buyerId", "name email")
      .populate("farmerId", "farmName fullName")
      .populate("driverId", "name phone status")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset));

    res.json({
      ok: true,
      total,
      orders,
    });
  } catch (error) {
    console.error("Orders list error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /admin/orders/:id - Get order details
router.get("/orders/:id", requireAdmin, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("buyerId", "name email phone address city state")
      .populate(
        "farmerId",
        "fullName farmName location farmAddress phone bankDetails",
      )
      .populate("driverId", "name phone vehicleType status");

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Get associated escrow
    const escrow = await Escrow.findOne({ orderId: order._id })
      .populate("releasedBy", "name email")
      .populate("refundedBy", "name email");

    res.json({
      ok: true,
      order,
      escrow,
    });
  } catch (error) {
    console.error("Order detail error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
