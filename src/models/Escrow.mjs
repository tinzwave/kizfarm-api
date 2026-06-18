import mongoose from "mongoose";

const { Schema, model } = mongoose;

const EscrowSchema = new Schema(
  {
    // Reference to Order
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    masterOrderId: { type: String, index: true },
    
    // Parties
    buyerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    farmerId: { type: Schema.Types.ObjectId, ref: "Farmer", required: true },
    
    // Financial
    amount: { type: Number, required: true },
    currency: { type: String, default: "NGN" },
    
    // Status Tracking
    status: {
      type: String,
      enum: ["pending", "released", "refunded", "disputed"],
      default: "pending",
    },
    
    // Timeline
    createdAt: { type: Date, default: Date.now, index: true },
    releasedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    
    // Release Information
    releasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }, // Admin who released
    releaseNotes: { type: String, default: null },
    
    // Refund Information
    refundReason: { type: String, default: null },
    refundedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default model("Escrow", EscrowSchema);
