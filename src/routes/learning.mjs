import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import Course from "../models/Course.mjs";
import Subscription from "../models/Subscription.mjs";
import Tutor from "../models/Tutor.mjs";
import User from "../models/User.mjs";
import { requireAdmin, requireAuth } from "../middleware/auth.mjs";
import { uploadBuffer } from "../lib/cloudinaryUpload.mjs";
import { verifyPaystackPayment } from "../lib/paystack.mjs";
import {
  notifyEmail,
  sendCourseSubmittedEmail,
  sendCourseReviewedEmail,
  sendCoursePurchaseEmails,
  sendCoursePayoutReleasedEmail
} from "../lib/mailer.mjs";
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function userIdFrom(req) {
  return req.user?.id || req.user?._id || req.user?.userId || req.user?.sub;
}

function coursePrice(course) {
  return course.source === "buyer" ? Number(course.finalPrice ?? course.price) : Number(course.price);
}

function populateCourseQuery(query) {
  return query.populate("tutor").populate("creator", "name email");
}

router.get("/tutors", async (req, res) => {
  try {
    const tutors = await Tutor.find().sort({ createdAt: -1 });
    return res.json({ ok: true, tutors });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/tutors", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    const { name, description, phone, whatsapp } = req.body;
    if (!name || !description || !phone || !whatsapp) {
      return res.status(400).json({ error: "All tutor fields are required" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Tutor image is required" });
    }

    const imageUrl = await uploadBuffer(req.file.buffer, "kizfarm/tutors");
    const tutor = await Tutor.create({
      name,
      description,
      phone,
      whatsapp,
      imageUrl,
    });

    return res.json({ ok: true, tutor });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/courses", async (req, res) => {
  try {
    const { audience, source } = req.query;
    const filter = { isPublished: true };

    if (source === "admin") {
      filter.source = "admin";
    } else if (source === "buyer") {
      filter.source = "buyer";
      filter.status = "approved";
    } else if (audience === "farmer") {
      filter.$or = [
        { source: "admin" },
        { source: "buyer", status: "approved" },
      ];
    }

    const courses = await populateCourseQuery(Course.find(filter))
      .sort({ createdAt: -1 });
    return res.json({ ok: true, courses });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/courses/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid course id" });
    }

    const { source } = req.query;
    const filter = { _id: req.params.id, isPublished: true };
    if (source === "buyer") {
      filter.source = "buyer";
      filter.status = "approved";
    }
    const course = await populateCourseQuery(Course.findOne(filter));
    if (!course) return res.status(404).json({ error: "Course not found" });

    return res.json({ ok: true, course });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/courses", requireAdmin, async (req, res) => {
  try {
    const { title, description, price, content, tutor } = req.body;
    if (!title || !description || price === undefined || !content || !tutor) {
      return res.status(400).json({ error: "All course fields are required" });
    }
    if (!mongoose.Types.ObjectId.isValid(tutor)) {
      return res.status(400).json({ error: "Invalid tutor" });
    }

    const tutorExists = await Tutor.exists({ _id: tutor });
    if (!tutorExists) return res.status(404).json({ error: "Tutor not found" });

    const course = await Course.create({
      title,
      description,
      price: Number(price),
      finalPrice: Number(price),
      content,
      tutor,
      source: "admin",
      audience: "farmers",
      status: "approved",
      isPublished: true,
    });

    const populated = await course.populate("tutor");
    return res.json({ ok: true, course: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/buyer/courses", requireAuth, async (req, res) => {
  try {
    const courses = await populateCourseQuery(
      Course.find({
        source: "buyer",
        status: "approved",
        isPublished: true,
        creator: { $ne: userIdFrom(req) },
      }),
    ).sort({ createdAt: -1 });

    return res.json({ ok: true, courses });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/buyer/my-courses", requireAuth, async (req, res) => {
  try {
    const courses = await populateCourseQuery(
      Course.find({
        source: "buyer",
        creator: userIdFrom(req),
      }),
    ).sort({ createdAt: -1 });

    return res.json({ ok: true, courses });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/buyer/courses", requireAuth, async (req, res) => {
  try {
    const { title, description, price, content } = req.body;
    if (!title || !description || price === undefined || !content) {
      return res.status(400).json({ error: "All course fields are required" });
    }

    const basePrice = Number(price);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      return res.status(400).json({ error: "Course price must be a valid amount" });
    }

    const course = await Course.create({
      title,
      description,
      price: basePrice,
      finalPrice: basePrice,
      content,
      creator: userIdFrom(req),
      source: "buyer",
      audience: "all",
      status: "pending",
      isPublished: false,
      rejectionReason: null,
    });

    const creator = await User.findById(userIdFrom(req));
    if (creator?.email) {
      notifyEmail(
        "Course submission alert",
        sendCourseSubmittedEmail(course, creator.email)
      );
    }

    const populated = await populateCourseQuery(Course.findById(course._id));
    return res.status(201).json({ ok: true, course: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch("/buyer/courses/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid course id" });
    }

    const course = await Course.findOne({
      _id: id,
      source: "buyer",
      creator: userIdFrom(req),
    });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const { title, description, price, content } = req.body;
    if (!title || !description || price === undefined || !content) {
      return res.status(400).json({ error: "All course fields are required" });
    }

    const basePrice = Number(price);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      return res.status(400).json({ error: "Course price must be a valid amount" });
    }

    course.title = title;
    course.description = description;
    course.price = basePrice;
    course.finalPrice = basePrice;
    course.commission = 0;
    course.content = content;
    course.status = "pending";
    course.isPublished = false;
    course.rejectionReason = null;
    course.reviewedBy = null;
    course.reviewedAt = null;
    await course.save();

    const populated = await populateCourseQuery(Course.findById(course._id));
    return res.json({ ok: true, course: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/buyer-courses", requireAdmin, async (req, res) => {
  try {
    const courses = await populateCourseQuery(
      Course.find({ source: "buyer" }),
    ).sort({ createdAt: -1 });

    return res.json({ ok: true, courses });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.patch("/admin/buyer-courses/:id/review", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, commission = 0, rejectionReason = "" } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid course id" });
    }
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Review status must be approved or rejected" });
    }

    const course = await Course.findOne({ _id: id, source: "buyer" });
    if (!course) return res.status(404).json({ error: "Buyer course not found" });

    const adminCommission = Number(commission || 0);
    if (!Number.isFinite(adminCommission) || adminCommission < 0) {
      return res.status(400).json({ error: "Commission cannot reduce the buyer's price" });
    }
    course.status = status;
    course.commission = status === "approved" ? adminCommission : 0;
    course.finalPrice = status === "approved" ? course.price + adminCommission : course.price;
    course.isPublished = status === "approved";
    course.rejectionReason = status === "rejected"
      ? String(rejectionReason).trim() || "Rejected by admin. Please update the course and resubmit."
      : null;
    course.reviewedBy = userIdFrom(req);
    course.reviewedAt = new Date();
    await course.save();

    const creator = await User.findById(course.creator);
    if (creator?.email) {
      notifyEmail(
        "Course review notification",
        sendCourseReviewedEmail(course, creator.email)
      );
    }

    const populated = await populateCourseQuery(Course.findById(course._id));
    return res.json({ ok: true, course: populated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/course-purchases", requireAdmin, async (req, res) => {
  try {
    const purchases = await Subscription.find({ source: "buyer", status: "active" })
      .populate({
        path: "course",
        populate: [
          { path: "creator", select: "name email" },
          { path: "tutor" },
        ],
      })
      .populate("user", "name email")
      .sort({ createdAt: -1 });

    return res.json({
      ok: true,
      purchases: purchases.map((purchase) => ({
        ...purchase.toObject(),
        buyer: purchase.user,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/course-purchases/:id/release-payout", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid purchase id" });
    }

    const purchase = await Subscription.findOne({
      _id: id,
      source: "buyer",
      status: "active",
    }).populate("course");

    if (!purchase) return res.status(404).json({ error: "Course purchase not found" });
    if (purchase.payoutStatus === "released") {
      return res.status(400).json({ error: "Payout has already been released" });
    }
    if (!purchase.course?.creator) {
      return res.status(400).json({ error: "Course creator is missing" });
    }

    const creatorAmount = Number(purchase.creatorAmount || purchase.course.price || 0);
    purchase.payoutStatus = "released";
    purchase.releasedAt = new Date();
    purchase.releasedBy = userIdFrom(req);
    await purchase.save();

    const creator = await User.findById(purchase.course.creator);
    if (creator?.email) {
      notifyEmail(
        "Course payout released notification",
        sendCoursePayoutReleasedEmail(purchase, creator.email)
      );
    }

    await User.findByIdAndUpdate(purchase.course.creator, {
      $inc: { accountBalance: creatorAmount },
      $push: {
        coursePayoutLedger: {
          subscriptionId: purchase._id,
          courseId: purchase.course._id,
          amount: creatorAmount,
          releasedAt: purchase.releasedAt,
          releasedBy: userIdFrom(req),
        },
      },
    });

    const populated = await Subscription.findById(purchase._id)
      .populate({
        path: "course",
        populate: [
          { path: "creator", select: "name email" },
          { path: "tutor" },
        ],
      })
      .populate("user", "name email");

    return res.json({ ok: true, purchase: { ...populated.toObject(), buyer: populated.user } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/subscriptions", requireAuth, async (req, res) => {
  try {
    const filter = { user: userIdFrom(req) };
    if (req.query.source === "buyer" || req.query.source === "admin") {
      filter.source = req.query.source;
    }

    const subscriptions = await Subscription.find(filter)
      .populate({
        path: "course",
        populate: [
          { path: "tutor" },
          { path: "creator", select: "name email" },
        ],
      })
      .sort({ createdAt: -1 });

    return res.json({ ok: true, subscriptions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/subscriptions", requireAuth, async (req, res) => {
  try {
    const { courseId, paymentReference, source } = req.body;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ error: "Invalid course id" });
    }
    if (!paymentReference) {
      return res.status(400).json({ error: "Payment reference is required" });
    }

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });
    if (!course.isPublished || (source === "buyer" && (course.source !== "buyer" || course.status !== "approved"))) {
      return res.status(400).json({ error: "Course is not available for purchase" });
    }
    if (course.source === "buyer" && String(course.creator) === String(userIdFrom(req))) {
      return res.status(400).json({ error: "You cannot subscribe to a course you created" });
    }

    // Verify payment with Paystack
    const verification = await verifyPaystackPayment(paymentReference);
    if (!verification.success) {
      return res.status(400).json({ error: verification.message || "Payment verification failed." });
    }

    // Check course price
    const payableAmount = coursePrice(course);
    if (Math.abs(verification.amount - payableAmount) > 10) {
      return res.status(400).json({
        error: `Payment amount mismatch. Expected: ₦${course.price}, Paid: ₦${verification.amount}`,
      });
    }

    const existingSub = await Subscription.findOne({ user: userIdFrom(req), course: course._id });
    const isNewPurchase = !existingSub || existingSub.status !== "active";

    const subscription = await Subscription.findOneAndUpdate(
      { user: userIdFrom(req), course: course._id },
      {
        user: userIdFrom(req),
        course: course._id,
        amount: payableAmount,
        creatorAmount: course.source === "buyer" ? course.price : 0,
        commission: course.source === "buyer" ? Number(course.commission || 0) : 0,
        source: course.source,
        payoutStatus: course.source === "buyer" ? "pending" : "not_applicable",
        status: "active",
        paymentReference,
        paidAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).populate({
      path: "course",
      populate: [
        { path: "tutor" },
        { path: "creator", select: "name email" },
      ],
    });

    if (isNewPurchase) {
      const populated = await Subscription.findById(subscription._id)
        .populate({
          path: "course",
          populate: [
            { path: "tutor" },
            { path: "creator", select: "name email" },
          ],
        })
        .populate("user", "name email");

      notifyEmail(
        "Course purchase notification",
        sendCoursePurchaseEmails(populated)
      );
    }

    return res.json({ ok: true, subscription });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/subscriptions/:courseId/access", requireAuth, async (req, res) => {
  try {
    const filter = {
      user: userIdFrom(req),
      course: req.params.courseId,
      status: "active",
    };
    if (req.query.source === "buyer" || req.query.source === "admin") {
      filter.source = req.query.source;
    }

    const subscription = await Subscription.findOne(filter).populate({
      path: "course",
      populate: [
        { path: "tutor" },
        { path: "creator", select: "name email" },
      ],
    });

    if (!subscription) {
      return res.status(403).json({ error: "Course is not subscribed" });
    }

    return res.json({ ok: true, course: subscription.course, subscription });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
