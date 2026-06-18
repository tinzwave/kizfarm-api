import mongoose from "mongoose";

const { Schema, model } = mongoose;

const ChatSchema = new Schema({
  buyerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  farmerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  productId: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  lastMessage: {
    type: String,
  },
  lastMessageTime: {
    type: Date,
  },
  lastMessageSenderId: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Ensure one chat per buyer-farmer pair for a product
ChatSchema.index({ buyerId: 1, farmerId: 1, productId: 1 }, { unique: true });

export default model("Chat", ChatSchema);
