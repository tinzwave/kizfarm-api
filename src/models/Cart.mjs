import mongoose from "mongoose";

const { Schema, model } = mongoose;

const CartItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  maxQuantity: { type: Number },
  unit: { type: String },
  image: { type: String },
  farmerId: { type: Schema.Types.ObjectId, ref: "Farmer" },
  farmerName: { type: String },
});

const CartSchema = new Schema(
  {
    // Buyer reference
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Cart items
    items: [CartItemSchema],

    // Metadata
    lastModified: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Update lastModified on save
CartSchema.pre("save", function (next) {
  this.lastModified = new Date();
  next();
});

export default model("Cart", CartSchema);
