import express from "express";
import { db } from "./firebase";
import stripe from "./stripe";

const router = express.Router();
const MIN_WITHDRAW_AMOUNT = 10; // Minimum withdrawal limit

// **Integrated Withdrawal Flow**
router.post("/request", async (req, res) => {
  try {
    const { userId, amount, stripeAccountId, currency = "usd" } = req.body;

    if (!userId || !amount || !stripeAccountId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (amount < MIN_WITHDRAW_AMOUNT) {
      return res.status(400).json({
        error: `Minimum withdrawal amount is $${MIN_WITHDRAW_AMOUNT}`,
      });
    }

    // Step 1: Check Driver's Wallet Balance
    const userRef = db.collection("users_wallet").doc(userId);
    const userDoc = await userRef.get();
    const userBalance = userDoc.exists ? userDoc.data()?.walletBalance || 0 : 0;
    console.log(userBalance);
    if (userBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Step 2: Create a Pending Withdrawal Transaction
    const transactionRef = db.collection("withdrawals").doc();
    const transactionId = transactionRef.id;
    await transactionRef.set({
      userId,
      amount,
      currency,
      status: "pending",
      createdAt: new Date(),
    });

    // Step 3: Process Withdrawal via Stripe
    // Step 3: Process Withdrawal via Stripe
    const payout = await stripe.transfers.create({
      amount: amount * 100, // Convert to cents
      currency,
      destination: stripeAccountId,
      metadata: {
        userId: userId,
        transactionId: transactionId,
      },
    });
    // Step 4: Update Withdrawal Transaction & Deduct Balance
    await transactionRef.update({
      status: "completed",
      stripePayoutId: payout.id,
    });

    await db.runTransaction(async (t) => {
      const userSnap = await t.get(userRef);

      if (!userSnap.exists) {
        return res.status(404).json({ error: "User not found" });
      }

      const currentBalance = userSnap.data()?.walletBalance || 0;
      return t.update(userRef, { walletBalance: currentBalance - amount });
    });

    return res.json({
      success: true,
      message: "Withdrawal successful",
      transactionId,
      payoutId: payout.id,
    });
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    return res.status(500).json({ error: "Withdrawal processing failed" });
  }
});

export default router;
