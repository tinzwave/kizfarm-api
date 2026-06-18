import mongoose from "mongoose";

const { Schema, model } = mongoose;

const OtpSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  codeHash: { type: String, required: true },
  purpose: { type: String, default: "verify" },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default model("Otp", OtpSchema);
