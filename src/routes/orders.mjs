import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import Order from "../models/Order.mjs";
import Driver from "../models/Driver.mjs";
import Review from "../models/Review.mjs";
import Product from "../models/Product.mjs";
import Farmer from "../models/Farmer.mjs";
import User from "../models/User.mjs";
import { requireAdmin } from "../middleware/auth.mjs";
import { uploadBuffer } from "../lib/cloudinaryUpload.mjs";
import { refundEscrowForOrder } from "../lib/escrowLedger.mjs";
import {
  notifyEmail,
  sendBuyerTransportFareAddedEmail,
  sendOrderStatusEmail,
  sendAdminOrderStatusEmail
} from "../lib/mailer.mjs";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// =============================================================
// DRIVER MANAGEMENT (Admin)
// =============================================================

// GET /admin/drivers
router.get("/drivers", requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const drivers = await Driver.find(filter)
      .populate("currentOrderId", "status deliveryAddress")
      .sort({ createdAt: -1 });

    return res.json({ ok: true, drivers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /admin/drivers  — onboard a new driver
router.post("/drivers", requireAdmin, upload.single("vehicleImage"), async (req, res) => {
  try {
    const { name, phone, vehicleType, vehiclePlate, currentLocation } =
      req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: "name and phone are required" });
    }

    const vehicleImages = [];
    if (req.file) {
      const imageUrl = await uploadBuffer(req.file.buffer, "kizfarm/drivers");
      vehicleImages.push(imageUrl);
    }

    const driver = await Driver.create({
      name,
      phone,
      vehicleType: vehicleType || "bike",
      vehiclePlate,
      vehicleImages,
      currentLocation,
      status: "active",
    });

    return res.json({ ok: true, driver });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /admin/drivers/:id  — update driver info / status
router.patch("/drivers/:id", requireAdmin, async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const allowed = [
      "name",
      "phone",
      "vehicleType",
      "vehiclePlate",
      "vehicleImages",
      "currentLocation",
      "status",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) driver[key] = req.body[key];
    }

    await driver.save();
    return res.json({ ok: true, driver });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE /admin/drivers/:id
router.delete("/drivers/:id", requireAdmin, async (req, res) => {
  try {
    const driver = await Driver.findByIdAndDelete(req.params.id);
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =============================================================
// ORDER MANAGEMENT (Admin)
// =============================================================

// GET /admin/orders  — all orders with full population
router.get("/orders", requireAdmin, async (req, res) => {
  try {
    const { status, farmerId, buyerId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (farmerId) filter.farmerId = farmerId;
    if (buyerId) filter.buyerId = buyerId;

    const orders = await Order.find(filter)
      .populate("buyerId", "name email phone")
      .populate("farmerId", "farmName location phone")
      .populate("driverId", "name phone vehicleType currentLocation status")
      .sort({ createdAt: -1 });

    return res.json({ ok: true, orders });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /admin/orders/:id
router.get("/orders/:id", requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const order = await Order.findById(req.params.id)
      .populate("buyerId", "name email phone")
      .populate("farmerId", "farmName location phone fullName")
      .populate("driverId", "name phone vehicleType currentLocation");

    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /admin/orders/:id/assign-driver  — assign driver to an order
router.post("/orders/:id/assign-driver", requireAdmin, async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId)
      return res.status(400).json({ error: "driverId is required" });

    const [order, driver] = await Promise.all([
      Order.findById(req.params.id),
      Driver.findById(driverId),
    ]);

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!driver) return res.status(404).json({ error: "Driver not found" });
    if (driver.status !== "active") {
      return res
        .status(400)
        .json({ error: "Driver is not available (active)" });
    }

    // Unassign previous driver if any
    if (order.driverId) {
      await Driver.findByIdAndUpdate(order.driverId, {
        status: "active",
        currentOrderId: null,
      });
    }

    order.driverId = driverId;
    order.status = "assigned";
    order.assignedAt = new Date();
    await order.save();

    driver.status = "busy";
    driver.currentOrderId = order._id;
    await driver.save();

    const buyer = await User.findById(order.buyerId);
    const farmer = await Farmer.findById(order.farmerId).populate("userId", "email");
    if (buyer?.email) {
      notifyEmail(
        "Buyer driver assigned notification",
        sendOrderStatusEmail(order, buyer.email, "Driver assigned", "A driver has been assigned to your order.")
      );
    }
    if (farmer?.userId?.email) {
      notifyEmail(
        "Farmer driver assigned notification",
        sendOrderStatusEmail(order, farmer.userId.email, "Driver assigned for pickup", "A driver has been assigned to pick up your order.")
      );
    }

    const populated = await order.populate(
      "driverId",
      "name phone vehicleType",
    );
    return res.json({ ok: true, order: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /admin/orders/:id/status  — manually override order status
router.patch("/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const { status, notes } = req.body;

    const validStatuses = [
      "awaiting_transport_quote",
      "awaiting_payment",
      "pending",
      "accepted_by_farmer",
      "confirmed",
      "packed",
      "assigned",
      "in_transit",
      "delivered",
      "receipt_confirmed",
      "completed",
      "cancelled",
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    order.status = status;
    if (notes) {
      // Add to status notes timeline instead of just overwriting adminNotes
      if (!order.statusNotes) order.statusNotes = [];
      order.statusNotes.push({
        status,
        note: notes,
        createdAt: new Date(),
      });
      order.adminNotes = notes;
    }

    // Update relevant timestamps
    const now = new Date();
    if (status === "accepted_by_farmer") order.acceptedAt = now;
    else if (status === "confirmed") order.confirmedAt = now;
    else if (status === "packed") order.packedAt = now;
    else if (status === "assigned") order.assignedAt = now;
    else if (status === "in_transit") order.pickedUpAt = now;
    else if (status === "delivered") order.deliveredAt = now;
    else if (status === "receipt_confirmed") order.receiptConfirmedAt = now;
    else if (status === "cancelled") {
      order.cancelledAt = now;
      order.cancellationReason = notes || "Order cancelled";
      // Free up driver if assigned
      if (order.driverId) {
        await Driver.updateOne(
          { _id: order.driverId, currentOrderId: order._id },
          {
            status: "active",
            currentOrderId: null,
          }
        );
        order.driverId = null;
      }
    }

    // Free up driver if assigned and order is successfully completed or delivered
    if (["delivered", "receipt_confirmed", "completed"].includes(status) && order.driverId) {
      await Driver.updateOne(
        { _id: order.driverId, currentOrderId: order._id },
        {
          status: "active",
          currentOrderId: null,
          $inc: { totalDeliveries: 1 },
        }
      );
    }

    await order.save();

    // Trigger refund if order is being cancelled
    if (status === "cancelled") {
      await refundEscrowForOrder(order, {
        reason: notes || "Order cancelled by admin",
        actorUserId: req.userId,
      }).catch(err => console.error("Refund error:", err));
    }

    // Send status transition emails
    const buyer = await User.findById(order.buyerId);
    const farmer = await Farmer.findById(order.farmerId).populate("userId", "email");
    const buyerEmail = buyer?.email;
    const farmerEmail = farmer?.userId?.email;

    if (status === "confirmed") {
      if (buyerEmail) {
        notifyEmail(
          "Buyer order confirmed notification",
          sendOrderStatusEmail(order, buyerEmail, "Order confirmed", "Your order has been confirmed by admin.")
        );
      }
      if (farmerEmail) {
        notifyEmail(
          "Farmer order confirmed notification",
          sendOrderStatusEmail(order, farmerEmail, "Order confirmed", "The order has been confirmed by admin.")
        );
      }
    } else if (status === "in_transit") {
      if (buyerEmail) {
        notifyEmail(
          "Buyer order in transit notification",
          sendOrderStatusEmail(order, buyerEmail, "Order in transit", "Your order is now in transit and on its way to you.")
        );
      }
    } else if (status === "delivered") {
      if (buyerEmail) {
        notifyEmail(
          "Buyer order delivered notification",
          sendOrderStatusEmail(order, buyerEmail, "Order delivered", "Your order has been delivered. Please confirm receipt in the app.")
        );
      }
    } else if (status === "cancelled") {
      if (buyerEmail) {
        notifyEmail(
          "Buyer order cancelled notification",
          sendOrderStatusEmail(order, buyerEmail, "Order cancelled", `Your order was cancelled. Reason: ${order.cancellationReason || "No reason specified"}`)
        );
      }
      if (farmerEmail) {
        notifyEmail(
          "Farmer order cancelled notification",
          sendOrderStatusEmail(order, farmerEmail, "Order cancelled", `The order was cancelled. Reason: ${order.cancellationReason || "No reason specified"}`)
        );
      }
      notifyEmail(
        "Admin order cancelled notification",
        sendAdminOrderStatusEmail(order, "Order cancelled record", `Order was cancelled. Reason: ${order.cancellationReason || "No reason specified"}`)
      );
    }

    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /admin/orders/:id/transport-fare - add/update quoted transport fare
router.patch("/orders/:id/transport-fare", requireAdmin, async (req, res) => {
  try {
    const transportFare = Number(req.body.transportFare ?? req.body.deliveryFee);
    const notes = req.body.notes;

    if (!Number.isFinite(transportFare) || transportFare < 0) {
      return res.status(400).json({ error: "Transport fare must be a valid amount." });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (!["awaiting_transport_quote", "awaiting_payment"].includes(order.status)) {
      return res.status(400).json({
        error: `Transport fare can only be added before payment. Current status: ${order.status}`,
      });
    }

    order.deliveryFee = transportFare;
    order.total = order.subtotal + (order.serviceFee || 0) + transportFare;
    order.status = "awaiting_payment";
    order.adminNotes = notes || `Transport fare added: ₦${transportFare.toLocaleString("en-NG")}`;
    if (!order.statusNotes) order.statusNotes = [];
    order.statusNotes.push({
      status: "awaiting_payment",
      note: order.adminNotes,
      createdAt: new Date(),
    });

    await order.save();

    const buyer = await User.findById(order.buyerId);
    if (buyer?.email) {
      notifyEmail(
        "Buyer transport fare added notification",
        sendBuyerTransportFareAddedEmail(order, buyer.email)
      );
    }

    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /admin/stats  — quick summary stats for the dashboard
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const [
      totalOrders,
      pendingOrders,
      inTransitOrders,
      deliveredOrders,
      totalDrivers,
      activeDrivers,
      totalFarmers,
      totalProducts,
      totalUsers,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      Order.countDocuments({ status: "in_transit" }),
      Order.countDocuments({
        status: { $in: ["delivered", "receipt_confirmed"] },
      }),
      Driver.countDocuments(),
      Driver.countDocuments({ status: "active" }),
      Farmer.countDocuments(),
      Product.countDocuments(),
      User.countDocuments(),
    ]);

    return res.json({
      ok: true,
      stats: {
        totalOrders,
        pendingOrders,
        inTransitOrders,
        deliveredOrders,
        totalDrivers,
        activeDrivers,
        totalFarmers,
        totalProducts,
        totalUsers,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Existing farmer verification routes are already in admin.mjs — re-export them
// to keep this file focused on the new order/driver features.
// The original admin.mjs file handles /verify-farmers endpoints.

export default router;
