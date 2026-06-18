import express from "express";
import Chat from "../models/Chat.mjs";
import Message from "../models/Message.mjs";
import User from "../models/User.mjs";
import Product from "../models/Product.mjs";
import { requireAuth } from "../middleware/auth.mjs";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";

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
}

async function uploadBuffer(buffer, path, resourceType = "auto") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: path, resource_type: resourceType },
      (err, result) => {
        if (err) return reject(err);
        resolve(result.secure_url);
      },
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// GET /chat/conversations - Get all conversations for current user
router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;

    const chats = await Chat.find({
      $or: [{ buyerId: userId }, { farmerId: userId }],
    })
      .populate("buyerId", "name email")
      .populate("farmerId", "name email")
      .populate("productId", "name images price")
      .sort({ updatedAt: -1 });

    return res.json({ ok: true, chats });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /chat/:chatId/messages - Get messages for a specific chat
router.get("/:chatId/messages", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { chatId } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    // Verify user is part of this chat
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    if (chat.buyerId.toString() !== userId && chat.farmerId.toString() !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const messages = await Message.find({ chatId })
      .populate("senderId", "name email")
      .populate("receiverId", "name email")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    return res.json({ ok: true, messages: messages.reverse() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /chat/start - Start or get existing chat with a farmer
router.post("/start", requireAuth, async (req, res) => {
  try {
    const buyerId = req.user.sub;
    const { farmerId, productId } = req.body;

    if (!farmerId || !productId) {
      return res.status(400).json({ error: "farmerId and productId required" });
    }

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const farmerUserId = product.userId?.toString();
    const submittedFarmerId = farmerId.toString();
    const submittedProductFarmerId = product.farmerId?.toString();

    if (
      submittedFarmerId !== farmerUserId &&
      submittedFarmerId !== submittedProductFarmerId
    ) {
      return res.status(400).json({ error: "Farmer does not own this product" });
    }

    // Chat.farmerId stores the farmer user id; Product.farmerId stores the Farmer profile id.
    const farmer = await User.findById(farmerUserId);
    if (!farmer) {
      return res.status(404).json({ error: "Farmer not found" });
    }

    // Create or get existing chat
    let chat = await Chat.findOne({ buyerId, farmerId: farmerUserId, productId });
    if (!chat) {
      chat = await Chat.create({ buyerId, farmerId: farmerUserId, productId });
    }

    return res.json({ ok: true, chat });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /chat/:chatId/send - Send a message
router.post("/:chatId/send", requireAuth, async (req, res) => {
  try {
    const senderId = req.user.sub;
    const { chatId } = req.params;
    const { content, messageType = "text" } = req.body;

    if (!content) {
      return res.status(400).json({ error: "Message content required" });
    }

    // Verify chat exists and user is part of it
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const isBuyer = chat.buyerId.toString() === senderId;
    const isFarmer = chat.farmerId.toString() === senderId;

    if (!isBuyer && !isFarmer) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const receiverId = isBuyer ? chat.farmerId : chat.buyerId;

    const message = await Message.create({
      chatId,
      senderId,
      receiverId,
      content,
      messageType,
      deliveryStatus: "sent",
    });

    // Update chat's last message
    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: content,
      lastMessageTime: new Date(),
      lastMessageSenderId: senderId,
      updatedAt: new Date(),
    });

    const populatedMessage = await message.populate("senderId", "name email role");

    return res.json({ ok: true, message: populatedMessage });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /chat/:chatId/send-attachment - Send message with attachment
router.post(
  "/:chatId/send-attachment",
  requireAuth,
  upload.single("attachment"),
  async (req, res) => {
    try {
      const senderId = req.user.sub;
      const { chatId } = req.params;
      const { content = "" } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Verify chat exists and user is part of it
      const chat = await Chat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }

      const isBuyer = chat.buyerId.toString() === senderId;
      const isFarmer = chat.farmerId.toString() === senderId;

      if (!isBuyer && !isFarmer) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const receiverId = isBuyer ? chat.farmerId : chat.buyerId;

      // Upload file to Cloudinary
      const mimeType = req.file.mimetype;
      const isImage = mimeType.startsWith("image/");
      const resourceType = isImage ? "image" : "auto";

      const attachmentUrl = await uploadBuffer(
        req.file.buffer,
        `kizfarm/chat/${chatId}`,
        resourceType,
      );

      const messageType = isImage ? "image" : "file";

      const message = await Message.create({
        chatId,
        senderId,
        receiverId,
        content: content || (isImage ? "Sent an image" : "Sent a file"),
        messageType,
        attachmentUrl,
        attachmentType: mimeType,
        deliveryStatus: "sent",
      });

      // Update chat's last message
      await Chat.findByIdAndUpdate(chatId, {
        lastMessage: content || (isImage ? "📷 Image" : "📎 File"),
        lastMessageTime: new Date(),
        lastMessageSenderId: senderId,
        updatedAt: new Date(),
      });

      const populatedMessage = await message.populate("senderId", "name email role");

      return res.json({ ok: true, message: populatedMessage });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /chat/:messageId/mark-read - Mark message as read
router.patch("/:messageId/mark-read", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.receiverId.toString() !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    message.isRead = true;
    message.readAt = new Date();
    message.deliveryStatus = "read";
    await message.save();

    return res.json({ ok: true, message });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /chat/:chatId - Get chat details
router.get("/:chatId", requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { chatId } = req.params;

    const chat = await Chat.findById(chatId)
      .populate("buyerId", "name email phone")
      .populate("farmerId", "name email phone")
      .populate("productId", "name images price");

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    if (chat.buyerId._id.toString() !== userId && chat.farmerId._id.toString() !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    return res.json({ ok: true, chat });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
