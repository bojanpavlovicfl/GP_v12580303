import express from "express";
import { db } from "./firebase";
import stripe from "./stripe";

const router = express.Router();

// **Integrated Wallet Flow (Top-up, Payment, Confirmation)**
router.post("/topup", async (req, res) => {
  try {
    const { userId, amount, currency = "usd", paymentMethodId } = req.body;
    // console.log(req.body);
    // Step 1: Create a Pending Transaction
    const transactionRef = db.collection("wallet_transactions").doc();
    await transactionRef.set({
      userId,
      amount,
      currency,
      status: "pending",
      createdAt: new Date(),
    });
    // console.log(transactionRef);
    // Step 2: Create Stripe Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Convert to cents
      currency,
      payment_method: paymentMethodId, // Attach provided card
      confirm: true, // Automatically confirm the payment
      confirmation_method: "automatic",
      return_url: "https://your-app-url.com/payment-success", // Optional redirect
      metadata: { userId, transactionId: transactionRef.id },
    });
    // console.log(paymentIntent);
    // Step 3: Verify Payment & Update Wallet
    if (paymentIntent.status === "succeeded") {
      await transactionRef.update({ status: "success" });

      const userWalletRef = db.collection("users_wallet").doc(userId);
      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userWalletRef);

        if (!userDoc.exists) {
          // If user does not exist, create a new document
          t.set(userWalletRef, { walletBalance: amount });
        } else {
          // If user exists, update their balance
          const currentBalance = userDoc.data()?.walletBalance || 0;
          t.update(userWalletRef, { walletBalance: currentBalance + amount });
        }
      });

      return res.json({
        success: true,
        message: "Wallet updated successfully",
        transactionId: transactionRef.id,
      });
    } else {
      return res.status(400).json({ error: "Payment not confirmed" });
    }
  } catch (error) {
    console.error("Error in wallet top-up process:", error);
    return res.status(500).json({ error: "Failed to process wallet top-up" });
  }
});

export default router;
