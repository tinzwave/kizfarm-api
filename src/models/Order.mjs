import mongoose from "mongoose";

const { Schema, model } = mongoose;

const OrderItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  unit: { type: String },
  image: { type: String },
});

const OrderSchema = new Schema(
  {
    masterOrderId: { type: String, index: true, default: null },
    subOrderIndex: { type: Number, default: 1 },
    subOrderCount: { type: Number, default: 1 },

    // Parties
    buyerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    farmerId: { type: Schema.Types.ObjectId, ref: "Farmer", required: true },
    driverId: { type: Schema.Types.ObjectId, ref: "Driver", default: null },

    // Items
    items: [OrderItemSchema],

    // Financials
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, default: 0 },
    serviceFee: { type: Number, default: 0 },
    total: { type: Number, required: true },

    // Payment — we store reference/method only, NO card details
    paymentMethod: {
      type: String,
      enum: ["card", "bank_transfer", "mpesa", "cash_on_delivery"],
      default: "card",
    },
    paymentReference: { type: String, default: null }, // e.g. Paystack ref
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    paidAt: { type: Date, default: null },
    stockAdjusted: { type: Boolean, default: false },
    stockAdjustedAt: { type: Date, default: null },

    // Escrow Management
    escrowStatus: {
      type: String,
      enum: ["pending", "released", "refunded"],
      default: "pending",
    },
    escrowReleasedAt: { type: Date, default: null },

    // Delivery address (snapshot at time of order)
    deliveryAddress: {
      label: { type: String },
      street: { type: String },
      city: { type: String },
      state: { type: String },
      phone: { type: String },
    },

    // Order lifecycle
    status: {
      type: String,
      enum: [
        "awaiting_transport_quote", // placed, awaiting admin transport fare
        "awaiting_payment", // transport fare added, awaiting buyer payment
        "pending",       // placed, awaiting farmer confirmation
        "accepted_by_farmer", // farmer accepted; awaiting admin confirmation
        "confirmed",     // farmer confirmed
        "packed",        // farmer has packed the goods
        "assigned",      // driver assigned
        "in_transit",    // driver picked up
        "delivered",     // driver delivered to buyer
        "receipt_confirmed", // buyer confirmed receipt
        "completed",     // completed and eligible for escrow release
        "rejected",      // farmer rejected before fulfillment
        "cancelled",
      ],
      default: "pending",
    },

    // Timestamps for key events
    acceptedAt: { type: Date, default: null },
    confirmedAt: { type: Date, default: null },
    packedAt: { type: Date, default: null },
    assignedAt: { type: Date, default: null },
    pickedUpAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    receiptConfirmedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    driverRating: { type: Number, min: 1, max: 5, default: null },
    driverRatedAt: { type: Date, default: null },

    // Notes
    cancellationReason: { type: String, default: null },
    farmerNotes: { type: String, default: null },
    adminNotes: { type: String, default: null },
    statusNotes: [
      {
        status: { type: String, required: true },
        note: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export default model("Order", OrderSchema);
