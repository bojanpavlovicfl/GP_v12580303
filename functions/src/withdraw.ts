import express from "express";
import { db } from "./firebase";
import stripe from "./stripe";

const router = express.Router();
const MIN_WITHDRAW_AMOUNT = 10; // Minimum withdrawal limit

// **1. Driver Requests Withdrawal**
router.post("/request", async (req, res) => {
  try {
    const { userId, amount, currency = "usd" } = req.body;

    // Validate minimum withdrawal amount
    if (amount < MIN_WITHDRAW_AMOUNT) {
      return res.status(400).json({
        error: `Minimum withdrawal amount is $${MIN_WITHDRAW_AMOUNT}`,
      });
    }

    // Get driver's wallet balance
    const userDoc = await db.collection("users").doc(userId).get();
    const userBalance = userDoc.data()?.walletBalance || 0;

    // Check if user has enough money
    if (userBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Create a pending withdrawal request
    const transactionRef = await db.collection("withdrawals").add({
      userId,
      amount,
      currency,
      status: "pending",
      createdAt: new Date(),
    });

    return res.json({ success: true, transactionId: transactionRef.id });
  } catch (error) {
    console.error("Error processing withdrawal request:", error);
    return res
      .status(500)
      .json({ error: "Failed to process withdrawal request" });
  }
});

// **2. Process Withdrawal via Stripe**
router.post("/process", async (req, res) => {
  try {
    const { transactionId, stripeAccountId } = req.body;

    const transactionRef = db.collection("withdrawals").doc(transactionId);
    const transactionDoc = await transactionRef.get();

    if (!transactionDoc.exists) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const { userId, amount, currency } = transactionDoc.data()!;

    // Verify if user still has enough money (double-check)
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    const userBalance = userDoc.data()?.walletBalance || 0;

    if (userBalance < amount) {
      return res
        .status(400)
        .json({ error: "Insufficient balance for withdrawal" });
    }

    // Create a Stripe payout
    const payout = await stripe.payouts.create({
      amount: amount * 100, // Convert to cents
      currency,
      destination: stripeAccountId,
    });

    // Update withdrawal transaction
    await transactionRef.update({
      status: "completed",
      stripePayoutId: payout.id,
    });

    // Deduct money from driver's wallet
    await db.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);
      const currentBalance = userSnap.data()?.walletBalance || 0;
      t.update(userRef, { walletBalance: currentBalance - amount });
    });

    return res.json({
      success: true,
      message: "Withdrawal successful",
      payoutId: payout.id,
    });
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    return res.status(500).json({ error: "Withdrawal processing failed" });
  }
});

export default router;
