import Escrow from "../models/Escrow.mjs";
import Farmer from "../models/Farmer.mjs";
import Order from "../models/Order.mjs";
import User from "../models/User.mjs";
import { restoreStockForOrder } from "./inventory.mjs";

export async function releaseEscrowToFarmer(escrow, { adminUserId, releaseNotes } = {}) {
  const order = await Order.findById(escrow.orderId);
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }

  const releaseReadyStatuses = ["receipt_confirmed", "completed"];
  if (!releaseReadyStatuses.includes(order.status)) {
    const error = new Error("Order must be receipt confirmed before escrow can be released");
    error.status = 400;
    throw error;
  }

  if (escrow.status !== "pending") {
    const error = new Error(`Cannot release escrow with status: ${escrow.status}`);
    error.status = 400;
    throw error;
  }

  escrow.status = "released";
  escrow.releasedAt = new Date();
  escrow.releasedBy = adminUserId || null;
  escrow.releaseNotes = releaseNotes || null;
  await escrow.save();

  order.paymentStatus = "paid";
  order.escrowStatus = "released";
  order.escrowReleasedAt = escrow.releasedAt;
  await order.save();

  await Farmer.updateOne(
    {
      _id: escrow.farmerId,
      "releasedFundsLedger.escrowId": { $ne: escrow._id },
    },
    {
      $inc: { accountBalance: escrow.amount },
      $push: {
        releasedFundsLedger: {
          orderId: escrow.orderId,
          escrowId: escrow._id,
          amount: escrow.amount,
          releasedAt: escrow.releasedAt,
          releasedBy: adminUserId || null,
          notes: releaseNotes || null,
        },
      },
    },
  );

  return { escrow, order };
}

export async function refundEscrowForOrder(order, { reason, actorUserId } = {}) {
  const escrow = await Escrow.findOne({ orderId: order._id });
  if (!escrow || escrow.status === "refunded") {
    if (order.paymentStatus === "paid") {
      order.paymentStatus = "refunded";
      order.escrowStatus = "refunded";
      await order.save();
    }
    await restoreStockForOrder(order);
    return { escrow, order };
  }

  if (escrow.status === "released") {
    const error = new Error("Funds have already been released");
    error.status = 400;
    throw error;
  }

  escrow.status = "refunded";
  escrow.refundedAt = new Date();
  escrow.refundedBy = actorUserId || null;
  escrow.refundReason = reason || "Order cancelled";
  await escrow.save();

  order.paymentStatus = "refunded";
  order.escrowStatus = "refunded";
  await order.save();
  await restoreStockForOrder(order);

  await User.updateOne(
    {
      _id: order.buyerId,
      "refundLedger.escrowId": { $ne: escrow._id },
    },
    {
      $inc: { accountBalance: escrow.amount },
      $push: {
        refundLedger: {
          orderId: order._id,
          escrowId: escrow._id,
          amount: escrow.amount,
          reason: escrow.refundReason,
          refundedAt: escrow.refundedAt,
        },
      },
    },
  );

  return { escrow, order };
}
