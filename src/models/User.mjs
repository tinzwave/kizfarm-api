import mongoose from "mongoose";

const { Schema, model } = mongoose;

const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  phone: { type: String },
  passwordHash: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  role: { type: String, enum: ["user", "admin", "farmer"], default: "user" },
  farmer: { type: Schema.Types.ObjectId, ref: "Farmer", default: null },
  
  // Account Status & Suspension
  status: {
    type: String,
    enum: ["active", "suspended", "deactivated"],
    default: "active",
  },
  suspensionReason: { type: String, default: null },
  suspendedAt: { type: Date, default: null },
  
  // Profile Information
  profileImage: { type: String, default: null },
  address: { type: String, default: null },
  city: { type: String, default: null },
  state: { type: String, default: null },
  country: { type: String, default: null },

  // Buyer refund ledger
  accountBalance: { type: Number, default: 0 },
  refundLedger: [
    {
      orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
      escrowId: { type: Schema.Types.ObjectId, ref: "Escrow", default: null },
      amount: { type: Number, required: true },
      reason: { type: String, default: null },
      refundedAt: { type: Date, default: Date.now },
    },
  ],
  coursePayoutLedger: [
    {
      subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription", required: true },
      courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
      amount: { type: Number, required: true },
      releasedAt: { type: Date, default: Date.now },
      releasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
  ],
  
  createdAt: { type: Date, default: Date.now },
});

export default model("User", UserSchema);
