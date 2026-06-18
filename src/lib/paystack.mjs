export async function verifyPaystackPayment(reference) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured in the environment");
  }

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Paystack verification HTTP error:", errText);
      return { success: false, message: "Paystack API responded with an error status." };
    }

    const data = await response.json();
    if (data && data.status && data.data && data.data.status === "success") {
      return {
        success: true,
        amount: data.data.amount / 100, // convert kobo to Naira
        currency: data.data.currency,
        email: data.data.customer?.email,
        reference: data.data.reference,
      };
    }

    return {
      success: false,
      message: data?.message || "Transaction verification failed on Paystack.",
    };
  } catch (err) {
    console.error("Error communicating with Paystack verification API:", err);
    return { success: false, message: "Error communicating with Paystack API." };
  }
}
