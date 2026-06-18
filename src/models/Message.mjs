import mongoose from "mongoose";

const { Schema, model } = mongoose;

const MessageSchema = new Schema({
  chatId: {
    type: Schema.Types.ObjectId,
    ref: "Chat",
    required: true,
    index: true,
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  receiverId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  messageType: {
    type: String,
    enum: ["text", "image", "file"],
    default: "text",
  },
  attachmentUrl: {
    type: String,
  },
  attachmentType: {
    type: String, // "image/jpeg", "image/png", "application/pdf", etc.
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  readAt: {
    type: Date,
  },
  deliveryStatus: {
    type: String,
    enum: ["sent", "delivered", "read"],
    default: "sent",
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

// Index for efficient message queries
MessageSchema.index({ chatId: 1, createdAt: -1 });

export default model("Message", MessageSchema);
