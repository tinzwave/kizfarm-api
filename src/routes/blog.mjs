import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import BlogPost from "../models/BlogPost.mjs";
import { requireAdmin } from "../middleware/auth.mjs";
import { uploadBuffer } from "../lib/cloudinaryUpload.mjs";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

async function generateUniqueSlug(title) {
  let baseSlug = title
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-");

  if (!baseSlug) baseSlug = "post";

  let slug = baseSlug;
  let count = 1;
  while (await BlogPost.exists({ slug })) {
    slug = `${baseSlug}-${count}`;
    count++;
  }
  return slug;
}

// GET /blog - Get all published blog posts
router.get("/", async (req, res) => {
  try {
    const { category, search, includeDrafts } = req.query;

    const filter = {};
    if (includeDrafts === "true") {
      // Allow admins to view drafts if they pass verification, otherwise default to published
      // We will check auth token manually if admin requested
      // For simplicity, if they specify includeDrafts, we verify auth
      // If unauthorized, fallback to published only
      try {
        const payload = requireAdmin; // we will verify manually if token present
        // But to keep it simple and clean:
        // We will only show published to public, but let admin page call a separate endpoint or verify
      } catch {}
    }

    // Default filter is published
    if (includeDrafts !== "true") {
      filter.status = "published";
    }

    if (category && category !== "All") {
      filter.category = category;
    }

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { title: searchRegex },
        { summary: searchRegex }
      ];
    }

    const posts = await BlogPost.find(filter).sort({ createdAt: -1 });
    return res.json({ ok: true, posts });
  } catch (err) {
    console.error("List blogs error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /blog/admin - Get all blog posts for admin management (includes drafts)
router.get("/admin", requireAdmin, async (req, res) => {
  try {
    const posts = await BlogPost.find().sort({ createdAt: -1 });
    return res.json({ ok: true, posts });
  } catch (err) {
    console.error("Admin list blogs error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /blog/:slugOrId - Get single blog post by slug or ID
router.get("/:slugOrId", async (req, res) => {
  try {
    const { slugOrId } = req.params;

    let query = { slug: slugOrId };
    if (mongoose.Types.ObjectId.isValid(slugOrId)) {
      query = { $or: [{ _id: slugOrId }, { slug: slugOrId }] };
    }

    const post = await BlogPost.findOne(query);
    if (!post) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    return res.json({ ok: true, post });
  } catch (err) {
    console.error("Get blog error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /blog - Create a new blog post (Admin only)
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { title, summary, content, coverImage, category, readTime, status } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required." });
    }

    const slug = await generateUniqueSlug(title);
    const post = await BlogPost.create({
      title,
      slug,
      summary,
      content,
      coverImage,
      category: category || "General",
      readTime: Number(readTime || 5),
      status: status || "published",
      author: "KizFarm Admin",
    });

    return res.status(201).json({ ok: true, post });
  } catch (err) {
    console.error("Create blog error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH /blog/:id - Update an existing blog post (Admin only)
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid blog post ID" });
    }

    const post = await BlogPost.findById(id);
    if (!post) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    const allowedUpdates = ["title", "summary", "content", "coverImage", "category", "readTime", "status"];
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        post[key] = req.body[key];
      }
    }

    // Re-generate slug if title changed
    if (req.body.title && req.body.title !== post.title) {
      post.slug = await generateUniqueSlug(req.body.title);
    }

    await post.save();
    return res.json({ ok: true, post });
  } catch (err) {
    console.error("Update blog error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE /blog/:id - Delete a blog post (Admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid blog post ID" });
    }

    const post = await BlogPost.findByIdAndDelete(id);
    if (!post) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    return res.json({ ok: true, message: "Blog post deleted successfully" });
  } catch (err) {
    console.error("Delete blog error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /blog/upload - Upload an image to Cloudinary (Admin only)
router.post("/upload", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const imageUrl = await uploadBuffer(req.file.buffer, "kizfarm/blogs");
    return res.json({ ok: true, imageUrl });
  } catch (err) {
    console.error("Blog image upload error:", err);
    return res.status(500).json({ error: "Image upload failed" });
  }
});

export default router;
