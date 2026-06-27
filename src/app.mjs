import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.mjs";
import farmerRoutes from "./routes/farmer.mjs";
import adminRoutes from "./routes/admin.mjs";
import publicRoutes from "./routes/public.mjs";
import chatRoutes from "./routes/chat.mjs";
import buyerRoutes from "./routes/buyer.mjs";
import ordersAdminRoutes from "./routes/orders.mjs";
import farmerOrdersRoutes from "./routes/farmerOrders.mjs";
import escrowRoutes from "./routes/escrow.mjs";
import learningRoutes from "./routes/learning.mjs";
import blogRoutes from "./routes/blog.mjs";

const app = express();

app.use(cors());
app.use(express.json());
app.use(helmet());

app.use("/", publicRoutes);
app.use("/auth", authRoutes);
app.use("/farmer", farmerRoutes);
app.use("/farmer-orders", farmerOrdersRoutes);
app.use("/admin", adminRoutes);
app.use("/admin", ordersAdminRoutes);   // driver & order management
app.use("/admin/escrow", escrowRoutes);  // escrow management
app.use("/buyer", buyerRoutes);
app.use("/chat", chatRoutes);
app.use("/learning", learningRoutes);
app.use("/blog", blogRoutes);

app.get("/", (req, res) => res.json({ ok: true, message: "KIZ FARM API" }));

export default app;
