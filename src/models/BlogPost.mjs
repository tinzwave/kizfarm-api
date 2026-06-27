import mongoose from "mongoose";

const { Schema, model } = mongoose;

const BlogPostSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    summary: { type: String, trim: true },
    content: { type: String, required: true }, // Serialized JSON string of blocks
    coverImage: { type: String, default: null },
    category: { type: String, default: "General" },
    readTime: { type: Number, default: 5 },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "published",
      index: true,
    },
    author: { type: String, default: "KizFarm Admin" },
  },
  { timestamps: true }
);

export default model("BlogPost", BlogPostSchema);
