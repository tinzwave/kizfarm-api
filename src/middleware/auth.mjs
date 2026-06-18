import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET || "replace_this_with_a_secret";

export function parseToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (!auth) return null;
  const parts = auth.split(" ");
  if (parts.length !== 2) return null;
  const token = parts[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

export function requireAuth(req, res, next) {
  const payload = parseToken(req);
  console.log("Auth check - Authorization header:", req.headers?.authorization);
  console.log("Auth check - Parsed payload:", payload);
  if (!payload) {
    console.log("Auth failed - No valid payload");
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.user = payload;
  next();
}

export function requireAdmin(req, res, next) {
  const payload = parseToken(req);
  if (!payload || payload.role !== "admin")
    return res.status(403).json({ error: "Admin required" });
  req.user = payload;
  req.userId = payload.sub || payload.id;
  next();
}

export function verifyToken(req, res, next) {
  const payload = parseToken(req);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  req.userId = payload.sub || payload.id;
  req.user = payload;
  next();
}
