import mongoose from "mongoose";

const { Schema, model } = mongoose;

const FarmerSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  fullName: { type: String },
  farmName: { type: String },
  phone: { type: String, required: true },
  location: { type: String },
  farmType: { type: String },
  farmAddress: { type: String },
  status: {
    type: String,
    enum: ["draft", "pending", "approved", "rejected"],
    default: "draft",
  },
  bvn: { type: String },
  nin: { type: String },
  bvnUrl: { type: String },
  govIdUrl: { type: String },
  selfieUrl: { type: String },
  farmerImageUrl: { type: String },
  validIdImageUrl: { type: String },
  farmImageUrl: { type: String },
  farmImageUrls: [{ type: String }],
  rejectionReason: { type: String },
  
  // Bank Details for Payouts
  bankDetails: {
    bankName: { type: String, default: null },
    accountHolderName: { type: String, default: null },
    accountNumber: { type: String, default: null },
    branchCode: { type: String, default: null },
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
  },

  // Farmer released funds ledger
  accountBalance: { type: Number, default: 0 },
  releasedFundsLedger: [
    {
      orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
      escrowId: { type: Schema.Types.ObjectId, ref: "Escrow", required: true },
      amount: { type: Number, required: true },
      releasedAt: { type: Date, default: Date.now },
      releasedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      notes: { type: String, default: null },
    },
  ],
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

FarmerSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default model("Farmer", FarmerSchema);
