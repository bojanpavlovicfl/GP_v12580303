import express from "express";
import { db, admin } from "./firebase";
import stripe from "./stripe";

const router = express.Router();
// const MIN_WITHDRAW_AMOUNT = 10; // Minimum withdrawal limit

// **Integrated Withdrawal Flow**
router.post("/request-withdrawal", async (req, res) => {
  try {
    const { driverId, amount } = req.body;

    if (!driverId || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const driverRef = db.collection("users_wallet").doc(driverId);
    const driverDoc = await driverRef.get();

    if (!driverDoc.exists) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const driverData = driverDoc.data();

    if (!driverData) {
      return res.status(500).json({ message: "Driver data is empty" });
    }

    const { stripeAccountId, walletBalance } = driverData;

    // ?? Ensure sufficient balance before processing withdrawal
    if (walletBalance < amount) {
      return res.status(400).json({ message: "Insufficient balance" });
    }

    // ?? Initiate payout via Stripe
    const transfer = await stripe.transfers.create({
      amount: amount * 100,
      currency: "usd",
      destination: stripeAccountId,
    });

    // ?? Deduct the withdrawn amount from wallet balance
    await db
      .collection("drivers")
      .doc(driverId)
      .update({
        walletBalance: admin.firestore.FieldValue.increment(-amount),
      });

    // ?? Log the transaction in Firestore
    await db.collection("withdrawals").doc(transfer.id).set({
      driverId,
      amount,
      status: "completed",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      message: "Withdrawal successful",
      transferId: transfer.id,
    });
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    return res.status(500).json({ message: "Withdrawal failed" });
  }
});

export default router;
