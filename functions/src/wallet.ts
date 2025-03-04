import express from "express";
import { db } from "./firebase";
import stripe from "./stripe";

const router = express.Router();

// **1. Create a Pending Wallet Transaction**
router.post("/topup", async (req, res) => {
  try {
    const { userId, amount, currency = "usd" } = req.body;

    const transactionRef = await db.collection("wallet_transactions").add({
      userId,
      amount,
      currency,
      status: "pending",
      createdAt: new Date(),
    });

    res.json({ success: true, transactionId: transactionRef.id });
  } catch (error) {
    console.error("Error creating transaction:", error);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

// **2. Create a Stripe Payment Intent**
router.post("/payment-intent", async (req, res) => {
  try {
    const { amount, currency, userId, transactionId, paymentMethodId } =
      req.body;

    // Retrieve user's Stripe Customer ID
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency,
      payment_method: paymentMethodId, // Attach the provided card
      metadata: { userId, transactionId },
    });

    res.json({ success: true, clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: "Failed to create payment intent" });
  }
});

// **3. Confirm Payment & Update Wallet**
router.post("/confirm-payment", async (req, res) => {
  try {
    const { transactionId, paymentIntentId } = req.body;

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === "succeeded") {
      await db.collection("wallet_transactions").doc(transactionId).update({
        status: "success",
      });

      const transactionDoc = await db
        .collection("wallet_transactions")
        .doc(transactionId)
        .get();
      const { userId, amount } = transactionDoc.data()!;

      const userWalletRef = db.collection("users").doc(userId);
      await db.runTransaction(async (t) => {
        const userDoc = await t.get(userWalletRef);
        const currentBalance = userDoc.data()?.walletBalance || 0;
        t.update(userWalletRef, { walletBalance: currentBalance + amount });
      });

      res.json({ success: true, message: "Wallet updated successfully" });
    } else {
      res.status(400).json({ error: "Payment not confirmed" });
    }
  } catch (error) {
    console.error("Error confirming payment:", error);
    res.status(500).json({ error: "Payment confirmation failed" });
  }
});

export default router;
