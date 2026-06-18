import mongoose from "mongoose";

const { Schema, model } = mongoose;

const DriverSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    vehicleType: {
      type: String,
      enum: ["bike", "van", "truck", "refrigerated_van"],
      default: "bike",
    },
    vehiclePlate: { type: String, default: null },
    vehicleImages: [{ type: String }],
    currentLocation: { type: String, default: null },
    status: {
      type: String,
      enum: ["active", "busy", "offline"],
      default: "active",
    },
    // Current order being delivered (if busy)
    currentOrderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      default: null,
    },
    totalDeliveries: { type: Number, default: 0 },
    ratingTotal: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export default model("Driver", DriverSchema);
