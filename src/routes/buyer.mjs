import express from "express";
import mongoose from "mongoose";
import Order from "../models/Order.mjs";
import Product from "../models/Product.mjs";
import Farmer from "../models/Farmer.mjs";
import Address from "../models/Address.mjs";
import User from "../models/User.mjs";
import Review from "../models/Review.mjs";
import Cart from "../models/Cart.mjs";
import Escrow from "../models/Escrow.mjs";
import Driver from "../models/Driver.mjs";
import { requireAuth } from "../middleware/auth.mjs";
import { refundEscrowForOrder } from "../lib/escrowLedger.mjs";
import { verifyPaystackPayment } from "../lib/paystack.mjs";
import { decrementStockForOrder } from "../lib/inventory.mjs";
import {
  notifyEmail,
  sendAdminTransportQuoteNeededEmail,
  sendBuyerOrderSubmittedEmail,
  sendBuyerPaymentSuccessfulEmail,
  sendFarmerNewPaidOrderEmail,
  sendAdminOrderPaidEmail,
  sendOrderStatusEmail,
  sendAdminOrderStatusEmail
} from "../lib/mailer.mjs";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const [products, recentOrders, orderCount, cart] = await Promise.all([
      Product.find({ quantity: { $ne: 0 } })
        .populate("farmerId", "_id farmName location")
        .sort({ createdAt: -1 })
        .limit(8),
      Order.find({ buyerId: userId })
        .populate("farmerId", "farmName location")
        .sort({ createdAt: -1 })
        .limit(4),
      Order.countDocuments({ buyerId: userId }),
      Cart.findOne({ userId }),
    ]);

    return res.json({
      ok: true,
      products,
      recentOrders,
      stats: {
        totalOrders: orderCount,
        cartItems: cart?.items?.length || 0,
        availableProducts: products.length,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =============================================================
// ADDRESSES
// =============================================================

// GET /buyer/addresses
router.get("/addresses", requireAuth, async (req, res) => {
  try {
    const addresses = await Address.find({ userId: req.user.sub }).sort({
      isDefault: -1,
      createdAt: -1,
    });
    return res.json({ ok: true, addresses });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /buyer/addresses
router.post("/addresses", requireAuth, async (req, res) => {
  try {
    const { label, street, city, state, country, phone, isDefault } = req.body;
    if (!street || !city || !state) {
      return res
        .status(400)
        .json({ error: "street, city and state are required" });
    }

    // If marking as default, unset all others first
    if (isDefault) {
      await Address.updateMany({ userId: req.user.sub }, { isDefault: false });
    }

    const address = await Address.create({
      userId: req.user.sub,
      label: label || "Home",
      street,
      city,
      state,
      country: country || "Nigeria",
      phone,
      isDefault: !!isDefault,
    });

    return res.json({ ok: true, address });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// PUT /buyer/addresses/:id
router.put("/addresses/:id", requireAuth, async (req, res) => {
  try {
    const { label, street, city, state, country, phone, isDefault } = req.body;
    const address = await Address.findOne({
      _id: req.params.id,
      userId: req.user.sub,
    });
    if (!address) return res.status(404).json({ error: "Address not found" });

    if (isDefault) {
      await Address.updateMany(
        { userId: req.user.sub, _id: { $ne: address._id } },
        { isDefault: false },
      );
    }

    Object.assign(address, {
      label: label ?? address.label,
      street: street ?? address.street,
      city: city ?? address.city,
      state: state ?? address.state,
      country: country ?? address.country,
      phone: phone ?? address.phone,
      isDefault: isDefault !== undefined ? !!isDefault : address.isDefault,
    });

    await address.save();
    return res.json({ ok: true, address });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE /buyer/addresses/:id
router.delete("/addresses/:id", requireAuth, async (req, res) => {
  try {
    const address = await Address.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.sub,
    });
    if (!address) return res.status(404).json({ error: "Address not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =============================================================
// CART → ORDER (Checkout / Place Order)
// =============================================================

/**
 * POST /buyer/orders
 *
 * Body: {
 *   items: [{ productId, quantity }],
 *   addressId: string,        // saved address OR inline address object
 *   address: { label, street, city, state, phone },  // alternative to addressId
 *   paymentMethod: string,
 * }
 *
 * This handler splits a cart into one unpaid Order per farmer.
 * Admin adds transport fare before the buyer can pay.
 */
router.post("/orders", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const {
      items,
      addressId,
      address: inlineAddress,
      paymentMethod,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    // Resolve delivery address
    let deliveryAddress = null;
    if (addressId) {
      const saved = await Address.findOne({
        _id: addressId,
        userId,
      });
      if (!saved) return res.status(404).json({ error: "Address not found" });
      deliveryAddress = {
        label: saved.label,
        street: saved.street,
        city: saved.city,
        state: saved.state,
        phone: saved.phone,
      };
    } else if (inlineAddress) {
      deliveryAddress = inlineAddress;
    } else {
      return res
        .status(400)
        .json({ error: "Delivery address is required to place an order" });
    }

    // Fetch all products in the cart
    const productIds = items.map((i) => i.productId);
    const products = await Product.find({ _id: { $in: productIds } });

    if (products.length === 0) {
      return res.status(404).json({ error: "No valid products found" });
    }

    // Group items by farmerId (split-order logic)
    const farmerMap = new Map(); // farmerId (string) → [{ product, quantity }]
    for (const cartItem of items) {
      const product = products.find(
        (p) => p._id.toString() === cartItem.productId,
      );
      if (!product) continue;
      const requestedQuantity = Math.max(1, Number(cartItem.quantity || 1));
      if (
        product.quantity !== undefined &&
        requestedQuantity > product.quantity
      ) {
        return res.status(400).json({
          error: `${product.name} only has ${product.quantity} ${product.unit || "units"} in stock`,
        });
      }

      const farmerKey = product.farmerId.toString();
      if (!farmerMap.has(farmerKey)) {
        farmerMap.set(farmerKey, []);
      }
      farmerMap.get(farmerKey).push({ product, quantity: requestedQuantity });
    }

    const SERVICE_FEE = 1200;
    const masterOrderId = `KFM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const subOrderCount = farmerMap.size;

    const tempSubOrders = [];
    for (const [farmerIdStr, farmerItems] of farmerMap.entries()) {
      const subtotal = farmerItems.reduce(
        (sum, { product, quantity }) => sum + product.price * quantity,
        0,
      );
      const serviceShare = Math.ceil(SERVICE_FEE / subOrderCount);
      const total = subtotal + serviceShare;
      tempSubOrders.push({ farmerIdStr, farmerItems, subtotal, serviceShare, total });
    }

    // Create one Order per farmer
    const createdOrders = [];
    let subOrderIndex = 1;
    for (const subOrder of tempSubOrders) {
      const { farmerIdStr, farmerItems, subtotal, serviceShare, total } = subOrder;

      const orderDoc = await Order.create({
        masterOrderId,
        subOrderIndex,
        subOrderCount,
        buyerId: userId,
        farmerId: farmerIdStr,
        items: farmerItems.map(({ product, quantity }) => ({
          productId: product._id,
          name: product.name,
          price: product.price,
          quantity,
          unit: product.unit,
          image: product.images?.[0] || null,
        })),
        subtotal,
        deliveryFee: 0,
        serviceFee: serviceShare,
        total,
        paymentMethod: paymentMethod || "card",
        paymentReference: null,
        paymentStatus: "pending",
        deliveryAddress,
        status: "awaiting_transport_quote",
        adminNotes: "Transport fare request submitted. Admin should add the transport fare before payment.",
        statusNotes: [
          {
            status: "awaiting_transport_quote",
            note: "Buyer requested transport fare review.",
            createdAt: new Date(),
          },
        ],
      });

      createdOrders.push(orderDoc);
      subOrderIndex += 1;
    }

    // Send notifications to Admin and Buyer
    const buyer = await User.findById(userId);
    if (buyer) {
      notifyEmail(
        "Admin transport quote notification",
        sendAdminTransportQuoteNeededEmail(createdOrders, buyer)
      );
      for (const order of createdOrders) {
        notifyEmail(
          `Buyer order submitted notification for ${order._id}`,
          sendBuyerOrderSubmittedEmail(order, buyer.email)
        );
      }
    }

    return res.json({ ok: true, orders: createdOrders });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /buyer/orders/:id/pay - pay after admin adds transport fare
router.post("/orders/:id/pay", requireAuth, async (req, res) => {
  try {
    const { paymentReference, paymentMethod } = req.body;
    if (!paymentReference) {
      return res.status(400).json({ error: "Payment reference is required." });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user.sub,
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "awaiting_payment") {
      return res.status(400).json({ error: "Order is not ready for payment." });
    }
    if (order.deliveryFee <= 0) {
      return res.status(400).json({ error: "Transport fare has not been added yet." });
    }
    if (order.paymentStatus === "paid") {
      return res.status(400).json({ error: "Order has already been paid." });
    }

    const verification = await verifyPaystackPayment(paymentReference);
    if (!verification.success) {
      return res.status(400).json({ error: verification.message || "Payment verification failed." });
    }

    if (Math.abs(verification.amount - order.total) > 10) {
      return res.status(400).json({
        error: `Payment amount mismatch. Expected: ₦${order.total}, Paid: ₦${verification.amount}`,
      });
    }

    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        buyerId: req.user.sub,
        paymentStatus: { $ne: "paid" },
      },
      {
        $set: {
          paymentMethod: paymentMethod || order.paymentMethod || "card",
          paymentReference,
          paymentStatus: "paid",
          paidAt: new Date(),
          status: "pending",
          adminNotes: "Payment completed. Order is now awaiting farmer confirmation."
        },
        $push: {
          statusNotes: {
            status: "pending",
            note: "Buyer paid after transport fare was added.",
            createdAt: new Date(),
          }
        }
      },
      { new: true }
    );

    if (!updatedOrder) {
      return res.status(400).json({ error: "Order has already been paid." });
    }

    await decrementStockForOrder(updatedOrder);

    const existingEscrow = await Escrow.findOne({ orderId: updatedOrder._id });
    if (!existingEscrow) {
      await Escrow.create({
        orderId: updatedOrder._id,
        masterOrderId: updatedOrder.masterOrderId,
        buyerId: updatedOrder.buyerId,
        farmerId: updatedOrder.farmerId,
        amount: updatedOrder.total,
        status: "pending",
      });
    }

    // Trigger emails non-blockingly
    const buyer = await User.findById(updatedOrder.buyerId);
    const farmer = await Farmer.findById(updatedOrder.farmerId).populate("userId", "email");
    if (buyer?.email) {
      notifyEmail(
        "Buyer payment successful notification",
        sendBuyerPaymentSuccessfulEmail(updatedOrder, buyer.email)
      );
    }
    if (farmer?.userId?.email) {
      notifyEmail(
        "Farmer new paid order notification",
        sendFarmerNewPaidOrderEmail(updatedOrder, farmer.userId.email)
      );
    }
    notifyEmail(
      "Admin order paid notification",
      sendAdminOrderPaidEmail(updatedOrder)
    );

    return res.json({ ok: true, order: updatedOrder });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.message || "Server error" });
  }
});

// GET /buyer/orders  — list all orders for the logged-in buyer
router.get("/orders", requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { buyerId: req.user.sub };
    if (status) filter.status = status;

    const orders = await Order.find(filter)
      .populate("farmerId", "farmName location")
      .populate("driverId", "name phone vehicleType")
      .sort({ createdAt: -1 });

    return res.json({ ok: true, orders });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /buyer/orders/:id  — single order detail
router.get("/orders/:id", requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user.sub,
    })
      .populate("farmerId", "farmName location phone")
      .populate("driverId", "name phone vehicleType currentLocation");

    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /buyer/orders/:id/confirm-receipt  — buyer confirms delivery
router.post("/orders/:id/confirm-receipt", requireAuth, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user.sub,
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "delivered") {
      return res
        .status(400)
        .json({ error: "Order has not been marked as delivered yet" });
    }

    order.status = "completed";
    order.receiptConfirmedAt = new Date();
    await order.save();

    // Notify admin and farmer
    const farmer = await Farmer.findById(order.farmerId).populate("userId", "email");
    notifyEmail(
      "Admin escrow release alert",
      sendAdminOrderStatusEmail(order, "Buyer confirmed receipt", "The buyer has confirmed receipt of the order. Escrow can now be released.")
    );
    if (farmer?.userId?.email) {
      notifyEmail(
        "Farmer payout eligible alert",
        sendOrderStatusEmail(order, farmer.userId.email, "Buyer confirmed receipt", "The buyer has confirmed receipt of your order. Your payout is now eligible for release.")
      );
    }

    // Free up driver if assigned and currently processing this order
    if (order.driverId) {
      await Driver.updateOne(
        { _id: order.driverId, currentOrderId: order._id },
        {
          status: "active",
          currentOrderId: null,
          $inc: { totalDeliveries: 1 },
        }
      );
    }

    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /buyer/orders/:id/rate-driver - buyer rates the assigned delivery driver
router.post("/orders/:id/rate-driver", requireAuth, async (req, res) => {
  try {
    const rating = Number(req.body.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be between 1 and 5" });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user.sub,
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.driverId) {
      return res.status(400).json({ error: "No driver assigned to this order" });
    }
    if (!["receipt_confirmed", "completed"].includes(order.status)) {
      return res
        .status(400)
        .json({ error: "You can rate the driver after confirming receipt" });
    }
    if (order.driverRatedAt) {
      return res.status(400).json({ error: "Driver already rated for this order" });
    }

    const driver = await Driver.findById(order.driverId);
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    driver.ratingTotal = (driver.ratingTotal || 0) + rating;
    driver.ratingCount = (driver.ratingCount || 0) + 1;
    driver.averageRating = Number(
      (driver.ratingTotal / driver.ratingCount).toFixed(1),
    );

    order.driverRating = rating;
    order.driverRatedAt = new Date();

    await Promise.all([driver.save(), order.save()]);

    return res.json({ ok: true, rating, driver });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /buyer/orders/:id/cancel  — buyer cancels (only if still pending)
router.post("/orders/:id/cancel", requireAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user.sub,
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!["awaiting_transport_quote", "awaiting_payment", "pending", "confirmed"].includes(order.status)) {
      return res
        .status(400)
        .json({ error: "Order cannot be cancelled at this stage" });
    }

    order.status = "cancelled";
    order.cancellationReason = reason || "Cancelled by buyer";
    order.cancelledAt = new Date();
    await order.save();
    await refundEscrowForOrder(order, {
      reason: order.cancellationReason,
      actorUserId: req.user.sub,
    });

    const buyer = await User.findById(order.buyerId);
    const farmer = await Farmer.findById(order.farmerId).populate("userId", "email");
    if (buyer?.email) {
      notifyEmail(
        "Buyer order cancelled notification",
        sendOrderStatusEmail(order, buyer.email, "Order cancelled", `Your order has been cancelled. Reason: ${order.cancellationReason || "Cancelled by buyer"}`)
      );
    }
    if (farmer?.userId?.email) {
      notifyEmail(
        "Farmer order cancelled notification",
        sendOrderStatusEmail(order, farmer.userId.email, "Order cancelled", `The order has been cancelled. Reason: ${order.cancellationReason || "Cancelled by buyer"}`)
      );
    }
    notifyEmail(
      "Admin order cancelled notification",
      sendAdminOrderStatusEmail(order, "Order cancelled record", `Order was cancelled. Reason: ${order.cancellationReason || "Cancelled by buyer"}`)
    );

    // Free up driver if assigned and currently processing this order
    if (order.driverId) {
      await Driver.updateOne(
        { _id: order.driverId, currentOrderId: order._id },
        {
          status: "active",
          currentOrderId: null,
        }
      );
    }

    return res.json({ ok: true, order });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =============================================================
// REVIEWS
// =============================================================

// GET /buyer/reviews/:productId  — list all reviews for a product (public-ish, just requires auth)
router.get("/reviews/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const reviews = await Review.find({ productId })
      .sort({ createdAt: -1 })
      .limit(50);

    const count = reviews.length;
    const avg =
      count > 0
        ? parseFloat(
            (reviews.reduce((s, r) => s + r.rating, 0) / count).toFixed(1),
          )
        : 0;

    return res.json({ ok: true, reviews, count, avg });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /buyer/reviews/:productId  — submit a review
router.post("/reviews/:productId", requireAuth, async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user.sub;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "rating must be between 1 and 5" });
    }

    // Fetch user's name for snapshot
    const user = await User.findById(userId).select("name");
    const buyerName = user?.name || "Anonymous";

    // Upsert — one review per buyer per product
    const review = await Review.findOneAndUpdate(
      { productId, buyerId: userId },
      {
        productId,
        buyerId: userId,
        rating,
        comment: comment || "",
        buyerName,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return res.json({ ok: true, review });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =============================================================
// CART PERSISTENCE (Optional database backup)
// =============================================================

/**
 * GET /buyer/cart
 * Retrieve saved cart from database
 */
router.get("/cart", requireAuth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user.sub }).populate(
      "items.productId",
      "name price quantity",
    );
    return res.json({ ok: true, cart: cart || { items: [] } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /buyer/cart/save
 * Save cart to database (backup from localStorage)
 * Body: { items: [{ productId, quantity, ... }] }
 */
router.post("/cart/save", requireAuth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: "items must be an array" });
    }

    const cart = await Cart.findOneAndUpdate(
      { userId: req.user.sub },
      { items, lastModified: new Date() },
      { upsert: true, new: true },
    );

    return res.json({ ok: true, cart });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

/**
 * DELETE /buyer/cart
 * Clear cart from database
 */
router.delete("/cart", requireAuth, async (req, res) => {
  try {
    await Cart.deleteOne({ userId: req.user.sub });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =============================================================
// REFUNDS TAB - Cancelled Orders
// =============================================================

// GET /buyer/refunds - Get all cancelled orders (refund history)
router.get("/refunds", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    
    // Get user to check account balance
    const user = await User.findById(userId);
    const accountBalance = user?.accountBalance || 0;

    // Get all refunded orders
    const refunds = await Order.find({
      buyerId: userId,
      status: { $in: ["cancelled", "rejected"] },
      escrowStatus: "refunded",
    })
      .populate("farmerId", "farmName")
      .sort({ cancelledAt: -1 });

    res.json({
      ok: true,
      accountBalance,
      refundLedger: refunds.map((order) => ({
        orderId: order._id,
        escrowId: order.escrowId || undefined,
        amount: order.total,
        reason: order.cancellationReason || "Order cancelled",
        refundedAt: order.cancelledAt || order.updatedAt,
      })),
      totalRefunded: refunds.reduce((sum, order) => sum + order.total, 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /buyer/refunds/:id - Get refund detail
router.get("/refunds/:id", requireAuth, async (req, res) => {
  try {
    const refund = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user.sub,
      status: { $in: ["cancelled", "rejected"] },
      escrowStatus: "refunded",
    })
      .populate("farmerId", "fullName farmName phone")
      .populate("driverId", "name phone");

    if (!refund) {
      return res.status(404).json({ error: "Refund not found" });
    }

    res.json({
      success: true,
      refund: {
        _id: refund._id,
        masterOrderId: refund.masterOrderId,
        farmer: refund.farmerId,
        items: refund.items,
        subtotal: refund.subtotal,
        deliveryFee: refund.deliveryFee,
        serviceFee: refund.serviceFee,
        total: refund.total,
        cancellationReason: refund.cancellationReason,
        cancelledAt: refund.cancelledAt,
        refundStatus:
          refund.paymentStatus === "refunded" ? "refunded" : "pending",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================================
// PROFILE MANAGEMENT
// =============================================================

// GET /buyer/profile - Get buyer profile
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.sub);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      profile: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        profileImage: user.profileImage,
        address: user.address,
        city: user.city,
        state: user.state,
        country: user.country,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /buyer/profile - Update buyer profile
router.put("/profile", requireAuth, async (req, res) => {
  try {
    const { name, phone, address, city, state, country, profileImage } =
      req.body;
    const user = await User.findById(req.user.sub);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update profile fields
    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (address) user.address = address;
    if (city) user.city = city;
    if (state) user.state = state;
    if (country) user.country = country;
    if (profileImage) user.profileImage = profileImage;

    await user.save();

    res.json({
      success: true,
      message: "Profile updated successfully",
      profile: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        profileImage: user.profileImage,
        address: user.address,
        city: user.city,
        state: user.state,
        country: user.country,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /buyer/refunds - Get buyer's refund history and account balance
router.get("/refunds", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const user = await User.findById(userId).select(
      "accountBalance refundLedger",
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const totalRefunded = (user.refundLedger || []).reduce(
      (sum, entry) => sum + entry.amount,
      0,
    );

    return res.json({
      ok: true,
      accountBalance: user.accountBalance || 0,
      refundLedger: user.refundLedger || [],
      totalRefunded,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
