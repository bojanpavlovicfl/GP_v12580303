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

router.post("/register-driver", async (req, res) => {
  try {
    const { driverId, email } = req.body;

    if (!driverId || !email) {
      return res.status(400).json({ message: "Missing driverId or email" });
    }

    // ?? Step 1: Create Stripe Connected Account
    const account = await stripe.accounts.create({
      type: "express", // Use "express" or "custom" depending on your setup
      country: "US", // Change based on your supported country
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: "individual",
      metadata: { driverId },
    });

    // ?? Step 2: Save `stripeAccountId` in Firestore
    await db.collection("users_wallet").doc(driverId).set(
      {
        email,
        stripeAccountId: account.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true } // Ensure existing data is not overwritten
    );

    return res.json({
      success: true,
      stripeAccountId: account.id,
      message: "Driver registered on Stripe",
    });
  } catch (error) {
    console.error("Error registering driver:", error);
    return res.status(500).json({ message: "Failed to register driver" });
  }
});

router.post("/create-onboarding-link", async (req, res) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ message: "Missing driverId" });
    }

    // ?? Retrieve Stripe Account ID
    const driverDoc = await db.collection("users_wallet").doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const stripeAccountId = driverDoc.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return res
        .status(400)
        .json({ message: "Driver not registered on Stripe" });
    }

    // ?? Create Stripe Onboarding Link
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: "https://your-app.com/reauth", // Redirect if session expires
      return_url: "https://your-app.com/dashboard", // Redirect after onboarding
      type: "account_onboarding",
    });

    return res.json({ success: true, onboardingLink: accountLink.url });
  } catch (error) {
    console.error("Error creating onboarding link:", error);
    return res
      .status(500)
      .json({ message: "Failed to generate onboarding link" });
  }
});

router.get("/check-driver-status/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!driverId) {
      return res.status(400).json({ message: "Missing driverId" });
    }

    // ?? Retrieve Stripe Account ID
    const driverDoc = await db.collection("users_wallet").doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const stripeAccountId = driverDoc.data()?.stripeAccountId;
    if (!stripeAccountId) {
      return res
        .status(400)
        .json({ message: "Driver not registered on Stripe" });
    }

    // ?? Fetch Account Details from Stripe
    const account = await stripe.accounts.retrieve(stripeAccountId);

    return res.json({
      success: true,
      stripeAccountId,
      details_submitted: account.details_submitted,
      payouts_enabled: account.payouts_enabled,
      charges_enabled: account.charges_enabled,
    });
  } catch (error) {
    console.error("Error checking driver status:", error);
    return res.status(500).json({ message: "Failed to check driver status" });
  }
});

export default router;
