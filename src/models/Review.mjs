import mongoose from "mongoose";

const { Schema, model } = mongoose;

const ReviewSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: "" },
    buyerName: { type: String, default: "Anonymous" }, // snapshot
  },
  { timestamps: true }
);

// One review per buyer per product
ReviewSchema.index({ productId: 1, buyerId: 1 }, { unique: true });

export default model("Review", ReviewSchema);
