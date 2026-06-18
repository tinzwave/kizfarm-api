import mongoose from "mongoose";

const { Schema, model } = mongoose;

const SubscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    course: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    amount: { type: Number, required: true, min: 0 },
    creatorAmount: { type: Number, default: 0, min: 0 },
    commission: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["active", "cancelled"],
      default: "active",
    },
    source: {
      type: String,
      enum: ["admin", "buyer"],
      default: "admin",
      index: true,
    },
    payoutStatus: {
      type: String,
      enum: ["pending", "released", "not_applicable"],
      default: "not_applicable",
      index: true,
    },
    releasedAt: { type: Date, default: null },
    releasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    paymentReference: { type: String, required: true },
    paidAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

SubscriptionSchema.index({ user: 1, course: 1 }, { unique: true });

export default model("Subscription", SubscriptionSchema);
