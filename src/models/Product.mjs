import mongoose from "mongoose";

const { Schema, model } = mongoose;

const ProductSchema = new Schema({
  farmerId: {
    type: Schema.Types.ObjectId,
    ref: "Farmer",
    required: true,
  },
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  price: {
    type: Number,
    required: true,
  },
  category: {
    type: String,
  },
  unit: {
    type: String,
  },
  quantity: {
    type: Number,
  },
  moistureCode: {
    type: String,
  },
  images: [
    {
      type: String,
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

ProductSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default model("Product", ProductSchema);
