import express from "express";
import { db } from "./firebase";
// import stripe from "./stripe";

const router = express.Router();

// **Integrated Carpool Flow: Match Acceptance & Payment**
router.post("/accept-and-confirm", async (req, res) => {
  try {
    const { riderId, driverId, amount, currency = "usd", matchId } = req.body;

    if (!riderId || !driverId || !amount || !matchId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Step 1: Check if rider has enough balance
    const riderRef = db.collection("users_wallet").doc(riderId);
    const riderDoc = await riderRef.get();
    const riderBalance = riderDoc.exists
      ? riderDoc.data()?.walletBalance || 0
      : 0;

    if (riderBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Step 2: Create a Pending Transaction with Auto-Generated ID
    const transactionRef = db.collection("carpool_transactions").doc(); // Ensure it generates an ID
    // const transactionId = transactionRef.id; // Store the auto-generated ID

    await transactionRef.set({
      riderId,
      driverId,
      amount,
      currency,
      matchId,
      status: "pending",
      createdAt: new Date(),
    });

    // Step 3: Deduct balance temporarily
    await riderRef.update({ walletBalance: riderBalance - amount });

    // Step 4: Confirm Ride Completion & Process Payment
    await transactionRef.update({ status: "completed" });

    // Step 5: Transfer amount to driver
    const driverRef = db.collection("users_wallet").doc(driverId);
    await db.runTransaction(async (t) => {
      const driverDoc = await t.get(driverRef);

      if (!driverDoc.exists) {
        // If driver doesn't exist, create with initial balance
        t.set(driverRef, { walletBalance: amount });
      } else {
        const currentBalance = driverDoc.data()?.walletBalance || 0;
        t.update(driverRef, { walletBalance: currentBalance + amount });
      }
    });

    return res.json({
      success: true,
      message: "Payment to driver completed",
      transactionId: transactionRef.id,
    });
  } catch (error) {
    console.error("Error in carpool payment process:", error);
    return res.status(500).json({ error: "Carpool payment failed" });
  }
});

// **3. Handle Refund in Case of Dispute**
router.post("/refund", async (req, res) => {
  try {
    const { transactionId } = req.body;

    const transactionRef = db
      .collection("carpool_transactions")
      .doc(transactionId);
    const transactionDoc = await transactionRef.get();
    const { riderId, amount } = transactionDoc.data()!;

    if (!transactionDoc.exists) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    // Refund money to rider's wallet
    const riderRef = db.collection("users_wallet").doc(riderId);
    await db.runTransaction(async (t) => {
      const riderDoc = await t.get(riderRef);
      const currentBalance = riderDoc.data()?.walletBalance || 0;
      t.update(riderRef, { walletBalance: currentBalance + amount });
    });

    // Mark transaction as refunded
    await transactionRef.update({ status: "refunded" });

    return res.json({ success: true, message: "Refund successful" });
  } catch (error) {
    console.error("Error processing refund:", error);
    return res.status(500).json({ error: "Refund failed" });
  }
});

export default router;
