import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.mjs";
import Otp from "../models/Otp.mjs";
import { sendOtpEmail, notifyEmail } from "../lib/mailer.mjs";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "replace_this_with_a_secret";

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post("/signup", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!email || !password || !name)
      return res.status(400).json({ error: "Missing fields" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ error: "Email already registered" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, phone, passwordHash });

    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await Otp.create({ userId: user._id, codeHash, expiresAt });
    notifyEmail("OTP signup notification", sendOtpEmail(email, code));

    return res.json({ ok: true, message: "User created, OTP sent to email" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await Otp.create({ userId: user._id, codeHash, expiresAt });
    notifyEmail("OTP resend notification", sendOtpEmail(email, code));

    return res.json({ ok: true, message: "OTP resent" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const otp = await Otp.findOne({ userId: user._id }).sort({ createdAt: -1 });
    if (!otp)
      return res.status(400).json({ error: "OTP not found or expired" });

    const match = await bcrypt.compare(code, otp.codeHash);
    if (!match) return res.status(400).json({ error: "Invalid OTP" });

    user.isVerified = true;
    await user.save();
    await Otp.deleteMany({ userId: user._id });

    return res.json({ ok: true, message: "Email verified" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid credentials" });
    if (!user.isVerified) {
      const code = generateCode();
      const codeHash = await bcrypt.hash(code, 10);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await Otp.create({ userId: user._id, codeHash, expiresAt });
      notifyEmail("OTP login notification", sendOtpEmail(user.email, code));
      return res.status(403).json({
        error: "Email not verified",
        needsVerification: true,
        email: user.email,
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { sub: user._id, role: user.role || "user" },
      JWT_SECRET,
      {
        expiresIn: "7d",
      },
    );
    return res.json({
      ok: true,
      token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role || "user" },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const demoEmail = process.env.ADMIN_DEMO_EMAIL;
    const demoPassword = process.env.ADMIN_DEMO_PASSWORD;
    if (!demoEmail || !demoPassword)
      return res
        .status(500)
        .json({ error: "Admin demo credentials not configured" });

    if (email !== demoEmail || password !== demoPassword)
      return res.status(401).json({ error: "Invalid admin credentials" });

    // Upsert a real User document for the admin so that admin routes
    // that call User.findById(req.userId) always resolve correctly.
    let adminUser = await User.findOne({ email: demoEmail, role: "admin" });
    if (!adminUser) {
      const passwordHash = await bcrypt.hash(demoPassword, 10);
      adminUser = await User.create({
        name: "Admin",
        email: demoEmail,
        passwordHash,
        role: "admin",
        isVerified: true,
      });
    }

    const token = jwt.sign(
      { sub: adminUser._id.toString(), role: "admin" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    return res.json({ ok: true, token, admin: { email: demoEmail, id: adminUser._id } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
