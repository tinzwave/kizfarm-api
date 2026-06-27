const FALLBACK_RESEND_API_KEY = "re_i8FPocXm_9PUTifqHT1RuZ2vD4VnBCiZr";

const RESEND_API_KEY = process.env.RESEND_API_KEY || FALLBACK_RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@myschoolmanager.org";
const ADMIN_NOTIFICATION_EMAILS = (process.env.ADMIN_NOTIFICATION_EMAILS || process.env.ADMIN_DEMO_EMAIL || "")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(amount) {
  return `NGN ${Number(amount || 0).toLocaleString("en-NG")}`;
}

function orderRef(order) {
  return order?.masterOrderId || `KF-${String(order?._id || "").slice(-6).toUpperCase()}`;
}

function orderItems(order) {
  return (order?.items || [])
    .map((item) => `<li>${escapeHtml(item.name)} x ${Number(item.quantity || 0).toLocaleString("en-NG")}</li>`)
    .join("");
}

function layout(title, body) {
  return `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.55">
      <h2 style="color:#166534;margin:0 0 16px">${escapeHtml(title)}</h2>
      ${body}
      <p style="margin-top:24px;color:#64748b;font-size:13px">Kiz Farm</p>
    </div>
  `;
}

export async function sendEmail({ to, subject, html }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (recipients.length === 0) return { skipped: true, reason: "No recipient" };
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set. Skipping:", subject, recipients.join(", "));
    return { skipped: true, reason: "Missing RESEND_API_KEY" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: recipients,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Email send failed (${response.status}): ${text}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

export function notifyEmail(message, emailPromise) {
  Promise.resolve(emailPromise).catch((err) => {
    console.error(`[email] ${message}:`, err.message || err);
  });
}

export function adminEmails() {
  return ADMIN_NOTIFICATION_EMAILS;
}

export function sendOtpEmail(email, code) {
  return sendEmail({
    to: email,
    subject: "Your KIZ FARM verification code",
    html: layout(
      "Your verification code",
      `<p>Your verification code is <strong>${escapeHtml(code)}</strong>. It expires in 10 minutes.</p>`,
    ),
  });
}

export function sendAdminTransportQuoteNeededEmail(orders, buyer) {
  const list = (orders || [])
    .map((order) => `<li><strong>${escapeHtml(orderRef(order))}</strong> - ${money(order.total)}<ul>${orderItems(order)}</ul></li>`)
    .join("");

  return sendEmail({
    to: adminEmails(),
    subject: "New order needs transport fare",
    html: layout(
      "Transport fare needed",
      `
        <p>${escapeHtml(buyer?.name || "A buyer")} submitted a checkout that needs transport fare review.</p>
        <ul>${list}</ul>
        <p>Please open admin order control and add the transport fare so the buyer can pay.</p>
      `,
    ),
  });
}

export function sendBuyerOrderSubmittedEmail(order, buyerEmail) {
  return sendEmail({
    to: buyerEmail,
    subject: "Your order is awaiting transport fare",
    html: layout(
      "Order received",
      `
        <p>Your order <strong>${escapeHtml(orderRef(order))}</strong> has been received.</p>
        <p>Our admin team will add the transport fare for delivery to your address. Payment will open after that.</p>
        <p>Current total before transport: <strong>${money(order.total)}</strong></p>
      `,
    ),
  });
}

export function sendBuyerTransportFareAddedEmail(order, buyerEmail) {
  return sendEmail({
    to: buyerEmail,
    subject: "Transport fare added to your order",
    html: layout(
      "Your order is ready for payment",
      `
        <p>Transport fare has been added to order <strong>${escapeHtml(orderRef(order))}</strong>.</p>
        <p>Transport fare: <strong>${money(order.deliveryFee)}</strong></p>
        <p>Total to pay: <strong>${money(order.total)}</strong></p>
      `,
    ),
  });
}

export function sendBuyerPaymentSuccessfulEmail(order, buyerEmail) {
  return sendEmail({
    to: buyerEmail,
    subject: "Payment successful",
    html: layout(
      "Payment received",
      `
        <p>Your payment for order <strong>${escapeHtml(orderRef(order))}</strong> was successful.</p>
        <p>The farmer has been notified and will accept or reject the order.</p>
        <p>Total paid: <strong>${money(order.total)}</strong></p>
      `,
    ),
  });
}

export function sendFarmerNewPaidOrderEmail(order, farmerEmail) {
  return sendEmail({
    to: farmerEmail,
    subject: "New paid order received",
    html: layout(
      "New paid order",
      `
        <p>You have a new paid order <strong>${escapeHtml(orderRef(order))}</strong>.</p>
        <ul>${orderItems(order)}</ul>
        <p>Please open your farmer orders page to accept or reject it.</p>
      `,
    ),
  });
}

export function sendAdminOrderPaidEmail(order) {
  return sendEmail({
    to: adminEmails(),
    subject: "Order paid and awaiting farmer response",
    html: layout(
      "Order paid",
      `
        <p>Order <strong>${escapeHtml(orderRef(order))}</strong> has been paid.</p>
        <p>Total: <strong>${money(order.total)}</strong></p>
        <p>The farmer should now accept or reject the order.</p>
      `,
    ),
  });
}

export function sendOrderStatusEmail(order, recipientEmail, title, message) {
  return sendEmail({
    to: recipientEmail,
    subject: title,
    html: layout(
      title,
      `
        <p>${escapeHtml(message)}</p>
        <p>Order: <strong>${escapeHtml(orderRef(order))}</strong></p>
        <p>Status: <strong>${escapeHtml(order.status)}</strong></p>
      `,
    ),
  });
}

export function sendAdminOrderStatusEmail(order, title, message) {
  return sendEmail({
    to: adminEmails(),
    subject: title,
    html: layout(
      title,
      `
        <p>${escapeHtml(message)}</p>
        <p>Order: <strong>${escapeHtml(orderRef(order))}</strong></p>
        <p>Status: <strong>${escapeHtml(order.status)}</strong></p>
      `,
    ),
  });
}

export function sendFarmerPayoutReleasedEmail(order, escrow, farmerEmail) {
  return sendEmail({
    to: farmerEmail,
    subject: "Your Kiz Farm payout has been released",
    html: layout(
      "Payout released",
      `
        <p>Your payout for order <strong>${escapeHtml(orderRef(order))}</strong> has been released.</p>
        <p>Amount: <strong>${money(escrow.amount)}</strong></p>
      `,
    ),
  });
}

export function sendFarmerApplicationSubmittedEmail(farmer) {
  return sendEmail({
    to: adminEmails(),
    subject: "New farmer application awaiting review",
    html: layout(
      "New farmer application",
      `
        <p>${escapeHtml(farmer.fullName || farmer.farmName || "A farmer")} submitted a farmer application.</p>
        <p>Farm: <strong>${escapeHtml(farmer.farmName || "Not provided")}</strong></p>
      `,
    ),
  });
}

export function sendFarmerVerificationEmail(farmer, email, approved) {
  const reason = farmer.rejectionReason ? `<p>Reason: ${escapeHtml(farmer.rejectionReason)}</p>` : "";
  return sendEmail({
    to: email,
    subject: approved ? "Your farmer account was approved" : "Your farmer application was rejected",
    html: layout(
      approved ? "Farmer account approved" : "Farmer application rejected",
      approved
        ? `<p>Your farmer account has been approved. You can now use the farmer portal.</p>`
        : `<p>Your farmer application was rejected.</p>${reason}`,
    ),
  });
}

export function sendCourseSubmittedEmail(course, creatorEmail) {
  return Promise.all([
    sendEmail({
      to: adminEmails(),
      subject: "New course awaiting review",
      html: layout(
        "Course review needed",
        `<p>A new course titled <strong>${escapeHtml(course.title)}</strong> was submitted for review.</p>`,
      ),
    }),
    sendEmail({
      to: creatorEmail,
      subject: "Your course was submitted for review",
      html: layout(
        "Course submitted",
        `<p>Your course <strong>${escapeHtml(course.title)}</strong> has been submitted for admin review.</p>`,
      ),
    }),
  ]);
}

export function sendCourseReviewedEmail(course, creatorEmail) {
  const approved = course.status === "approved";
  return sendEmail({
    to: creatorEmail,
    subject: approved ? "Your course was approved" : "Your course was rejected",
    html: layout(
      approved ? "Course approved" : "Course rejected",
      approved
        ? `<p>Your course <strong>${escapeHtml(course.title)}</strong> was approved and published.</p><p>Final price: <strong>${money(course.finalPrice)}</strong></p>`
        : `<p>Your course <strong>${escapeHtml(course.title)}</strong> was rejected.</p><p>Reason: ${escapeHtml(course.rejectionReason)}</p>`,
    ),
  });
}

export function sendCoursePurchaseEmails(subscription) {
  const course = subscription.course;
  const buyerEmail = subscription.user?.email;
  const creatorEmail = course?.creator?.email;
  const emails = [
    sendEmail({
      to: buyerEmail,
      subject: "Course purchase successful",
      html: layout(
        "Course purchase successful",
        `<p>You now have access to <strong>${escapeHtml(course?.title)}</strong>.</p><p>Amount paid: <strong>${money(subscription.amount)}</strong></p>`,
      ),
    }),
  ];

  if (course?.source === "buyer" && creatorEmail) {
    emails.push(
      sendEmail({
        to: creatorEmail,
        subject: "Someone purchased your course",
        html: layout(
          "New course sale",
          `<p>Your course <strong>${escapeHtml(course.title)}</strong> was purchased.</p><p>Your payout is pending admin release.</p>`,
        ),
      }),
    );
  }

  emails.push(
    sendEmail({
      to: adminEmails(),
      subject: "New course purchase",
      html: layout(
        "New course purchase",
        `<p><strong>${escapeHtml(course?.title)}</strong> was purchased for ${money(subscription.amount)}.</p>`,
      ),
    }),
  );

  return Promise.all(emails);
}

export function sendCoursePayoutReleasedEmail(purchase, creatorEmail) {
  return sendEmail({
    to: creatorEmail,
    subject: "Your course payout has been released",
    html: layout(
      "Course payout released",
      `
        <p>Your payout for <strong>${escapeHtml(purchase.course?.title)}</strong> has been released.</p>
        <p>Amount: <strong>${money(purchase.creatorAmount || purchase.course?.price)}</strong></p>
      `,
    ),
  });
}

export function sendFarmerApplicationReceivedEmail(farmer, email) {
  return sendEmail({
    to: email,
    subject: "Your farmer application was received",
    html: layout(
      "Application submitted",
      `
        <p>Dear ${escapeHtml(farmer.fullName || "Farmer")},</p>
        <p>Your application and verification documents have been received and are currently under review by our admin team.</p>
      `,
    ),
  });
}

