import mongoose from "mongoose";

const { Schema, model } = mongoose;

const TutorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: String, required: true, trim: true },
    imageUrl: { type: String, required: true },
  },
  { timestamps: true },
);

export default model("Tutor", TutorSchema);
