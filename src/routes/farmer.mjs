import express from "express";
import multer from "multer";
import Farmer from "../models/Farmer.mjs";
import User from "../models/User.mjs";
import Product from "../models/Product.mjs";
import { requireAuth } from "../middleware/auth.mjs";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import {
  notifyEmail,
  sendFarmerApplicationSubmittedEmail,
  sendFarmerApplicationReceivedEmail
} from "../lib/mailer.mjs";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUD_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUD_SECRET = process.env.CLOUDINARY_API_SECRET;

if (CLOUD_NAME && CLOUD_KEY && CLOUD_SECRET) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: CLOUD_KEY,
    api_secret: CLOUD_SECRET,
  });
} else {
  console.warn(
    "Cloudinary not configured — uploads will fail without credentials",
  );
}

router.get("/status", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    return res.json({ ok: true, farmer });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    const [
      products,
      recentOrders,
      totalOrders,
      activeOrders,
      deliveredOrders,
      revenueAgg,
    ] = await Promise.all([
      Product.find({ farmerId: farmer._id }).sort({ createdAt: -1 }).limit(6),
      Order.find({ farmerId: farmer._id })
        .populate("buyerId", "name email")
        .sort({ createdAt: -1 })
        .limit(5),
      Order.countDocuments({ farmerId: farmer._id }),
      Order.countDocuments({
        farmerId: farmer._id,
        status: { $nin: ["delivered", "receipt_confirmed", "cancelled"] },
      }),
      Order.countDocuments({
        farmerId: farmer._id,
        status: { $in: ["delivered", "receipt_confirmed"] },
      }),
      Order.aggregate([
        {
          $match: {
            farmerId: farmer._id,
            paymentStatus: "paid",
            status: { $ne: "cancelled" },
          },
        },
        { $group: { _id: null, total: { $sum: "$total" } } },
      ]),
    ]);

    return res.json({
      ok: true,
      farmer,
      stats: {
        totalSales: revenueAgg[0]?.total || 0,
        totalOrders,
        activeProducts: products.length,
        activeOrders,
        deliveredOrders,
      },
      products,
      recentOrders,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/register", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { fullName, farmName, phone, location, farmType } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });
    if (!/^\d+$/.test(String(phone))) {
      return res
        .status(400)
        .json({ error: "Phone number must contain numbers only" });
    }

    const existing = await Farmer.findOne({ userId });
    if (existing) return res.status(409).json({ error: "Already registered" });

    const farmer = await Farmer.create({
      userId,
      fullName,
      farmName,
      phone,
      location,
      farmType,
      status: "draft",
    });

    // link to user
    await User.findByIdAndUpdate(userId, { farmer: farmer._id });

    return res.json({ ok: true, farmer });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

async function uploadBuffer(buffer, path) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: path },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      },
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

router.post(
  "/verify",
  requireAuth,
  upload.fields([
    { name: "bvn", maxCount: 1 },
    { name: "govId", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
    { name: "farmerImage", maxCount: 1 },
    { name: "validIdImage", maxCount: 1 },
    { name: "farmImage", maxCount: 1 },
    { name: "farmImages", maxCount: 5 },
  ]),
  async (req, res) => {
    try {
      const userId = req.user.sub;
      const farmer = await Farmer.findOne({ userId });
      if (!farmer)
        return res.status(404).json({ error: "Farmer record not found" });

      const uploads = {};
      const basePath = `kizfarm/farmers/${userId}`;

      if (req.files && req.files.bvn && req.files.bvn[0]) {
        uploads.bvnUrl = await uploadBuffer(req.files.bvn[0].buffer, basePath);
      }
      if (req.files && req.files.govId && req.files.govId[0]) {
        uploads.govIdUrl = await uploadBuffer(
          req.files.govId[0].buffer,
          basePath,
        );
      }
      if (req.files && req.files.validIdImage && req.files.validIdImage[0]) {
        uploads.validIdImageUrl = await uploadBuffer(
          req.files.validIdImage[0].buffer,
          basePath,
        );
        uploads.govIdUrl = uploads.validIdImageUrl;
      }
      if (req.files && req.files.selfie && req.files.selfie[0]) {
        uploads.selfieUrl = await uploadBuffer(
          req.files.selfie[0].buffer,
          basePath,
        );
      }
      if (req.files && req.files.farmerImage && req.files.farmerImage[0]) {
        uploads.farmerImageUrl = await uploadBuffer(
          req.files.farmerImage[0].buffer,
          basePath,
        );
        uploads.selfieUrl = uploads.farmerImageUrl;
      }
      if (req.files && req.files.farmImage && req.files.farmImage[0]) {
        uploads.farmImageUrl = await uploadBuffer(
          req.files.farmImage[0].buffer,
          basePath,
        );
      }
      if (
        req.files &&
        req.files.farmImages &&
        req.files.farmImages.length > 0
      ) {
        if (req.files.farmImages.length !== 5) {
          return res
            .status(400)
            .json({ error: "Exactly 5 farm images are required" });
        }

        const farmImageUrls = [];
        for (const file of req.files.farmImages) {
          const imageUrl = await uploadBuffer(file.buffer, basePath);
          farmImageUrls.push(imageUrl);
        }
        uploads.farmImageUrls = farmImageUrls;
        uploads.farmImageUrl = farmImageUrls[0];
      }

      // accept text fields (multipart form) for current and legacy clients
      const { bvnNumber, nin, farmAddress } = req.body || {};
      if (bvnNumber) farmer.bvn = String(bvnNumber);
      if (nin) farmer.nin = String(nin);
      if (farmAddress) farmer.farmAddress = String(farmAddress);

      const hasExistingFarmImages =
        Array.isArray(farmer.farmImageUrls) &&
        farmer.farmImageUrls.length === 5;
      if (!uploads.farmImageUrls && !hasExistingFarmImages) {
        return res
          .status(400)
          .json({ error: "Exactly 5 farm images are required" });
      }

      Object.assign(farmer, uploads);
      farmer.status = "pending";
      // clear previous rejection reason when resubmitting
      farmer.rejectionReason = undefined;
      await farmer.save();

      const user = await User.findById(userId);
      if (user?.email) {
        notifyEmail(
          "Admin farmer application pending alert",
          sendFarmerApplicationSubmittedEmail(farmer)
        );
        notifyEmail(
          "Farmer application confirmation",
          sendFarmerApplicationReceivedEmail(farmer, user.email)
        );
      }

      return res.json({ ok: true, farmer });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// Product endpoints

// POST /farmer/products - Create a new product with image uploads
router.post(
  "/products",
  requireAuth,
  upload.array("images", 8),
  async (req, res) => {
    try {
      const userId = req.user.sub;
      const {
        name,
        description,
        price,
        category,
        unit,
        quantity,
        moistureCode,
      } = req.body;

      if (!name || !price) {
        return res.status(400).json({ error: "Name and price are required" });
      }

      const farmer = await Farmer.findOne({ userId });
      if (!farmer) {
        return res.status(404).json({ error: "Farmer record not found" });
      }

      // Upload images to Cloudinary
      const imageUrls = [];
      if (req.files && req.files.length > 0) {
        const basePath = `kizfarm/products/${farmer._id}`;
        for (const file of req.files) {
          const imageUrl = await uploadBuffer(file.buffer, basePath);
          imageUrls.push(imageUrl);
        }
      }

      // Create product
      const product = await Product.create({
        farmerId: farmer._id,
        userId,
        name,
        description,
        price: parseFloat(price),
        category,
        unit,
        quantity: quantity ? parseInt(quantity) : null,
        moistureCode,
        images: imageUrls,
      });

      return res.json({ ok: true, product });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// GET /farmer/products - Get all products for the logged-in farmer
router.get("/products", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    const products = await Product.find({ farmerId: farmer._id }).sort({
      createdAt: -1,
    });

    return res.json({ ok: true, products });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /farmer/products/:id - Get a specific product by ID
router.get("/products/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Check if the product belongs to the current farmer
    const farmer = await Farmer.findOne({ userId });
    if (!farmer || product.farmerId.toString() !== farmer._id.toString()) {
      return res
        .status(403)
        .json({ error: "Not authorized to view this product" });
    }

    return res.json({ ok: true, product });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /farmer/products/:id - Update a product owned by the logged-in farmer
router.patch("/products/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { id } = req.params;
    const { name, description, price, category, unit, quantity, moistureCode } =
      req.body || {};

    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (product.farmerId.toString() !== farmer._id.toString()) {
      return res
        .status(403)
        .json({ error: "Not authorized to update this product" });
    }

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ error: "Product name is required" });
      }
      product.name = String(name).trim();
    }

    if (description !== undefined)
      product.description = String(description).trim();
    if (category !== undefined) product.category = String(category).trim();
    if (unit !== undefined) product.unit = String(unit).trim();
    if (moistureCode !== undefined)
      product.moistureCode = String(moistureCode).trim();

    if (price !== undefined) {
      const nextPrice = Number(price);
      if (!Number.isFinite(nextPrice) || nextPrice < 0) {
        return res.status(400).json({ error: "Price must be a valid number" });
      }
      product.price = nextPrice;
    }

    if (quantity !== undefined) {
      if (quantity === "" || quantity === null) {
        product.quantity = null;
      } else {
        const nextQuantity = Number(quantity);
        if (!Number.isFinite(nextQuantity) || nextQuantity < 0) {
          return res
            .status(400)
            .json({ error: "Quantity must be a valid number" });
        }
        product.quantity = nextQuantity;
      }
    }

    await product.save();

    return res.json({ ok: true, product });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Payment History & Bank Details
// ═══════════════════════════════════════════════════════════════════

import Order from "../models/Order.mjs";

// GET /farmer/payment-history - Get accepted orders with payment status
router.get("/payment-history", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    // Get orders where farmer has accepted (status >= accepted_by_farmer) or are pending/completed
    const orders = await Order.find({
      farmerId: farmer._id,
      status: {
        $in: [
          "pending",
          "accepted_by_farmer",
          "confirmed",
          "packed",
          "assigned",
          "in_transit",
          "delivered",
          "receipt_confirmed",
          "completed",
        ],
      },
    })
      .populate("buyerId", "name email")
      .sort({ createdAt: -1 });

    // Enrich with payment info
    const payments = orders.map((order) => ({
      _id: order._id,
      masterOrderId: order.masterOrderId,
      buyerName: order.buyerId?.name,
      buyerEmail: order.buyerId?.email,
      total: order.total,
      paymentStatus: order.paymentStatus,
      escrowStatus: order.escrowStatus,
      acceptedAt: order.acceptedAt,
      createdAt: order.createdAt,
      status: order.status,
      items: order.items,
    }));

    res.json({
      success: true,
      payments,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /farmer/payment-history/:id - Get payment detail for specific order
router.get("/payment-history/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    const order = await Order.findById(req.params.id)
      .populate("buyerId", "name email phone")
      .populate("farmerId", "fullName");

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.farmerId._id.toString() !== farmer._id.toString()) {
      return res
        .status(403)
        .json({ error: "Not authorized to view this payment" });
    }

    res.json({
      success: true,
      payment: {
        orderId: order._id,
        masterOrderId: order.masterOrderId,
        buyer: order.buyerId,
        items: order.items,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        serviceFee: order.serviceFee,
        total: order.total,
        paymentStatus: order.paymentStatus,
        escrowStatus: order.escrowStatus,
        paymentMethod: order.paymentMethod,
        paymentReference: order.paymentReference,
        acceptedAt: order.acceptedAt,
        status: order.status,
        deliveryAddress: order.deliveryAddress,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /farmer/bank-details - Save or update bank details
router.post("/bank-details", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { bankName, accountHolderName, accountNumber, branchCode } = req.body;

    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    // Validate required fields
    if (!bankName || !accountHolderName || !accountNumber) {
      return res
        .status(400)
        .json({
          error:
            "Bank name, account holder name, and account number are required",
        });
    }

    // Update bank details
    farmer.bankDetails = {
      bankName,
      accountHolderName,
      accountNumber,
      branchCode: branchCode || null,
      isVerified: false, // Reset verification on update
    };

    await farmer.save();

    res.json({
      success: true,
      message: "Bank details saved successfully",
      bankDetails: farmer.bankDetails,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /farmer/bank-details - Get current bank details
router.get("/bank-details", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId });
    if (!farmer) {
      return res.status(404).json({ error: "Farmer record not found" });
    }

    res.json({
      success: true,
      bankDetails: farmer.bankDetails || {},
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /farmer/profile - Get farmer profile
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const user = await User.findById(userId);
    const farmer = await Farmer.findOne({ userId });

    res.json({
      success: true,
      profile: {
        user: {
          name: user.name,
          email: user.email,
          phone: user.phone,
          profileImage: user.profileImage,
          address: user.address,
          city: user.city,
          state: user.state,
          country: user.country,
        },
        farmer: farmer
          ? {
              fullName: farmer.fullName,
              farmName: farmer.farmName,
              phone: farmer.phone,
              location: farmer.location,
              farmType: farmer.farmType,
              farmAddress: farmer.farmAddress,
              farmerImageUrl: farmer.farmerImageUrl,
              validIdImageUrl: farmer.validIdImageUrl,
              farmImageUrl: farmer.farmImageUrl,
              farmImageUrls: farmer.farmImageUrls,
              status: farmer.status,
            }
          : null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /farmer/profile - Update farmer profile
router.put("/profile", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const {
      name,
      phone,
      address,
      city,
      state,
      country,
      fullName,
      farmName,
      farmType,
      location,
    } = req.body;

    const user = await User.findById(userId);
    const farmer = await Farmer.findOne({ userId });

    // Update user profile
    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (address) user.address = address;
    if (city) user.city = city;
    if (state) user.state = state;
    if (country) user.country = country;
    await user.save();

    // Update farmer profile
    if (farmer) {
      if (fullName) farmer.fullName = fullName;
      if (farmName) farmer.farmName = farmName;
      if (farmType) farmer.farmType = farmType;
      if (location) farmer.location = location;
      if (req.body.farmAddress) farmer.farmAddress = req.body.farmAddress;
      await farmer.save();
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      profile: {
        user: {
          name: user.name,
          email: user.email,
          phone: user.phone,
          address: user.address,
          city: user.city,
          state: user.state,
          country: user.country,
        },
        farmer: farmer
          ? {
              fullName: farmer.fullName,
              farmName: farmer.farmName,
              phone: farmer.phone,
              location: farmer.location,
              farmType: farmer.farmType,
              farmAddress: farmer.farmAddress,
            }
          : null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// Payout History & Earnings
// ═══════════════════════════════════════════════════════════════════

// GET /farmer/payout-history - Get released funds and earnings history
router.get("/payout-history", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const farmer = await Farmer.findOne({ userId }).select(
      "accountBalance releasedFundsLedger bankDetails",
    );

    if (!farmer) {
      return res.status(404).json({ error: "Farmer profile not found" });
    }

    const totalReleased = (farmer.releasedFundsLedger || []).reduce(
      (sum, entry) => sum + entry.amount,
      0,
    );

    return res.json({
      ok: true,
      accountBalance: farmer.accountBalance || 0,
      releasedFundsLedger: farmer.releasedFundsLedger || [],
      totalReleased,
      bankDetails: farmer.bankDetails || {},
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
