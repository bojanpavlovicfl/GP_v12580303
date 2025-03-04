import express from "express";
import { db } from "./firebase";
// import stripe from "./stripe";

const router = express.Router();

// **1. Rider Accepts Carpool Match & Creates Payment**
router.post("/accept-match", async (req, res) => {
  try {
    const { riderId, driverId, amount, currency = "usd", matchId } = req.body;

    // Check if rider has enough balance
    const riderRef = db.collection("users").doc(riderId);
    const riderDoc = await riderRef.get();
    const riderBalance = riderDoc.data()?.walletBalance || 0;

    if (riderBalance < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    // Create pending transaction
    const transactionRef = await db.collection("carpool_transactions").add({
      riderId,
      driverId,
      amount,
      currency,
      matchId,
      status: "pending",
      createdAt: new Date(),
    });

    // Deduct balance temporarily
    await riderRef.update({
      walletBalance: riderBalance - amount,
    });

    return res.json({ success: true, transactionId: transactionRef.id });
  } catch (error) {
    console.error("Error accepting match:", error);
    return res.status(500).json({ error: "Failed to accept match" });
  }
});

// **2. Confirm Carpool Completion & Process Payment**
router.post("/confirm-ride", async (req, res) => {
  try {
    const { transactionId } = req.body;

    const transactionRef = db
      .collection("carpool_transactions")
      .doc(transactionId);
    const transactionDoc = await transactionRef.get();
    // const { riderId, driverId, amount } = transactionDoc.data()!;
    const { driverId, amount } = transactionDoc.data()!;

    if (!transactionDoc.exists) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    // Mark as completed
    await transactionRef.update({ status: "completed" });

    // Transfer amount to driver
    const driverRef = db.collection("users").doc(driverId);
    await db.runTransaction(async (t) => {
      const driverDoc = await t.get(driverRef);
      const currentBalance = driverDoc.data()?.walletBalance || 0;
      t.update(driverRef, { walletBalance: currentBalance + amount });
    });

    return res.json({ success: true, message: "Payment to driver completed" });
  } catch (error) {
    console.error("Error confirming ride:", error);
    return res.status(500).json({ error: "Ride confirmation failed" });
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
    const riderRef = db.collection("users").doc(riderId);
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
