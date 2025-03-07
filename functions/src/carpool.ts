import express from "express";
import { db } from "./firebase";
import stripe from "./stripe";

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

// **Refund or Cancel Transaction and Ensure Funds Return**
router.post("/refund", async (req, res) => {
  try {
    const { transactionId, cancelReason = "Manual Cancellation" } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "Transaction ID is required" });
    }

    // Step 1: Retrieve the Transaction
    const transactionRef = db
      .collection("carpool_transactions")
      .doc(transactionId);
    const transactionDoc = await transactionRef.get();

    if (!transactionDoc.exists) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const { riderId, driverId, amount, status } = transactionDoc.data()!;

    // Step 2: Check if the transaction was already refunded or cancelled
    if (status === "refunded" || status === "cancelled") {
      return res
        .status(400)
        .json({ error: "Transaction has already been processed" });
    }

    // Step 3: Process Refund (Update Rider & Driver Wallet)
    const riderRef = db.collection("users_wallet").doc(riderId);
    const driverRef = db.collection("users_wallet").doc(driverId);

    const collectionStatus = await db.runTransaction(async (t) => {
      const riderDoc = await t.get(riderRef);
      const driverDoc = await t.get(driverRef);

      if (!riderDoc.exists || !driverDoc.exists) {
        return false;
      }

      const riderBalance = riderDoc.data()?.walletBalance || 0;
      const driverBalance = driverDoc.data()?.walletBalance || 0;

      // ? Refund amount to the rider
      t.update(riderRef, { walletBalance: riderBalance + amount });

      // ? Deduct amount from the driver
      t.update(driverRef, {
        walletBalance: Math.max(driverBalance - amount, 0),
      });
      return true;
    });

    if (!collectionStatus) {
      return res.status(404).json({ error: "Rider or Driver not found" });
    }

    // Step 4: Update Transaction Status in Firestore
    await transactionRef.update({
      status: "refunded",
      cancelReason: cancelReason,
      cancelledAt: new Date(),
    });

    console.log(
      `Transaction ${transactionId} refunded. Rider ${riderId} received refund, Driver ${driverId} balance updated.`
    );

    return res.json({
      success: true,
      message: "Refund processed successfully",
    });
  } catch (error) {
    console.error("Error processing refund:", error);
    return res.status(500).json({ error: "Refund processing failed" });
  }
});

// **Refund & Adjust Rider/Driver Balances**
router.post("/cancel-payment", async (req, res) => {
  try {
    const { transactionId, cancelReason = "User Requested Cancellation" } =
      req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "Transaction ID is required" });
    }

    // Step 1: Retrieve the Transaction
    const transactionRef = db
      .collection("carpool_transactions")
      .doc(transactionId);
    const transactionDoc = await transactionRef.get();

    if (!transactionDoc.exists) {
      return res.status(404).json({ error: "Transaction not found" });
    }

    const { riderId, driverId, amount, status, stripePaymentIntentId } =
      transactionDoc.data()!;

    // Step 2: Prevent double refunds
    if (status === "refunded" || status === "cancelled") {
      return res
        .status(400)
        .json({ error: "Transaction has already been processed" });
    }

    // Step 3: Process Refund via Stripe (If Stripe Payment Was Used)
    let stripeRefundId = null;
    if (stripePaymentIntentId) {
      try {
        const refund = await stripe.refunds.create({
          payment_intent: stripePaymentIntentId,
        });
        stripeRefundId = refund.id;
        console.log("Stripe refund processed:", refund.id);
      } catch (stripeError) {
        console.error("Error refunding via Stripe:", stripeError);
        return res.status(500).json({ error: "Stripe refund failed" });
      }
    }

    // Step 4: Adjust Wallet Balances for Rider & Driver
    const riderRef = db.collection("users_wallet").doc(riderId);
    const driverRef = db.collection("users_wallet").doc(driverId);

    await db.runTransaction(async (t) => {
      const riderDoc = await t.get(riderRef);
      const driverDoc = await t.get(driverRef);

      if (!riderDoc.exists || !driverDoc.exists) {
        return res.status(404).json({ error: "Rider or Driver not found" });
      }

      const riderBalance = riderDoc.data()?.walletBalance || 0;
      const driverBalance = driverDoc.data()?.walletBalance || 0;

      // ? Deduct from the driver only if the status is "completed"
      if (status === "completed") {
        t.update(driverRef, {
          walletBalance: Math.max(driverBalance - amount, 0),
        });
      } else {
        // ? If the transaction is NOT "completed", return funds to the rider
        t.update(riderRef, { walletBalance: riderBalance - amount });
      }
      return;
    });

    // Step 5: Update Transaction Status in Firestore
    await transactionRef.update({
      status: "refunded",
      cancelReason: cancelReason,
      cancelledAt: new Date(),
      stripeRefundId: stripeRefundId, // Store Stripe refund ID
    });

    console.log(
      `Transaction ${transactionId} refunded. Rider ${riderId} balance adjusted, Driver ${driverId} balance updated.`
    );

    return res.json({
      success: true,
      message: "Refund processed successfully",
      stripeRefundId: stripeRefundId,
    });
  } catch (error) {
    console.error("Error processing refund:", error);
    return res.status(500).json({ error: "Refund processing failed" });
  }
});

export default router;
