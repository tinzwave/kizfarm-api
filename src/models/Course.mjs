import mongoose from "mongoose";

const { Schema, model } = mongoose;

const CourseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    commission: { type: Number, default: 0, min: 0 },
    finalPrice: { type: Number, default: null, min: 0 },
    content: { type: String, required: true },
    tutor: { type: Schema.Types.ObjectId, ref: "Tutor", default: null },
    creator: { type: Schema.Types.ObjectId, ref: "User", default: null },
    source: {
      type: String,
      enum: ["admin", "buyer"],
      default: "admin",
      index: true,
    },
    audience: {
      type: String,
      enum: ["farmers", "all"],
      default: "farmers",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },
    rejectionReason: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    isPublished: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export default model("Course", CourseSchema);
