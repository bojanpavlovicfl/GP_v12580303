import express from "express";
import { db, admin } from "./firebase";
import stripe from "./stripe";

const router = express.Router();

router.post("/register-user", async (req, res) => {
  try {
    const { user, email } = req.body;

    if (!user || !email)
      return res.status(400).json({ message: "Missing data" });

    await db.collection("users_wallet").doc(user).set({
      email,
      stripeCustomerId: null,
      paymentMethodId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, message: "User registered" });
  } catch (error) {
    return res.status(500).json({ message: "Error registering rider" });
  }
});

router.post("/create-stripe-customer", async (req, res) => {
  try {
    const { riderId, email } = req.body;

    if (!riderId || !email) {
      return res.status(400).json({ message: "Missing riderId or email" });
    }

    // ?? Check if the rider document exists in Firestore
    const riderRef = db.collection("users_wallet").doc(riderId);
    const riderDoc = await riderRef.get();

    if (riderDoc.exists) {
      const riderData = riderDoc.data();

      // ?? If Stripe Customer ID already exists, return it
      if (riderData?.stripeCustomerId) {
        return res.json({
          success: true,
          customerId: riderData.stripeCustomerId,
        });
      }
    } else {
      // ?? If the rider does not exist, create a new Firestore record
      await riderRef.set({
        email,
        stripeCustomerId: null,
        paymentMethodId: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // ?? Create a Stripe Customer
    const customer = await stripe.customers.create({
      email: email,
      metadata: { riderId },
    });

    // ?? Save Customer ID in Firestore
    await riderRef.update({ stripeCustomerId: customer.id });

    return res.json({ success: true, customerId: customer.id });
  } catch (error) {
    console.error("Error creating Stripe customer:", error);
    return res
      .status(500)
      .json({ message: "Failed to create Stripe customer" });
  }
});

router.post("/save-payment-method", async (req, res) => {
  try {
    const { riderId, paymentMethodId } = req.body;

    if (!riderId || !paymentMethodId) {
      return res
        .status(400)
        .json({ message: "Missing riderId or paymentMethodId" });
    }

    // ?? Retrieve Stripe Customer ID
    const riderDoc = await db.collection("users_wallet").doc(riderId).get();
    if (!riderDoc.exists) {
      return res.status(400).json({ message: "RiderId not found" });
    }
    const stripeCustomerId = riderDoc.data()?.stripeCustomerId;

    if (!stripeCustomerId) {
      return res.status(400).json({ message: "Stripe Customer ID not found" });
    }

    // ?? Attach Payment Method to Customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomerId,
    });

    // ?? Set Payment Method as Default
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // ?? Save Payment Method in db
    await db
      .collection("users_wallet")
      .doc(riderId)
      .update({ paymentMethodId });

    return res.json({ success: true, message: "Payment method saved" });
  } catch (error) {
    console.error("Error saving payment method:", error);
    return res.status(500).json({ message: "Failed to save payment method" });
  }
});

router.post("/freeze-payment", async (req, res) => {
  try {
    // ?? Extract request body
    const { riderId, matchId, sessionId, amount } = req.body;

    // ?? Validate request data
    if (!riderId || !matchId || !sessionId || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (typeof amount !== "number" || amount <= 0) {
      return res
        .status(400)
        .json({ message: "Invalid amount. Must be a positive number." });
    }

    // ?? Retrieve rider document from Firestore
    const riderRef = db.collection("users_wallet").doc(riderId);
    const riderDoc = await riderRef.get();

    if (!riderDoc.exists) {
      return res.status(404).json({ message: "Rider not found" });
    }

    const riderData = riderDoc.data();
    if (!riderData?.stripeCustomerId || !riderData?.paymentMethodId) {
      return res.status(400).json({ message: "Stripe details missing" });
    }

    const { stripeCustomerId, paymentMethodId } = riderData;
    console.log(stripeCustomerId, paymentMethodId);
    // ?? Create Stripe PaymentIntent (Freeze Funds)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents and ensure it's an integer
      currency: "usd",
      customer: stripeCustomerId,
      payment_method: paymentMethodId,
      confirm: true,
      return_url: "https://your-app-url.com/payment-success",
      // capture_method: "manual", // Hold funds, charge later
    });

    console.log(paymentIntent);
    await db
      .collection("matches")
      .doc(matchId)
      .collection("carpoolSessions")
      .doc(sessionId)
      .set(
        {
          paymentIntentId: paymentIntent.id,
          status: "pending",
        },
        { merge: true } // ? Ensures document is created if it doesn¡Çt exist
      );

    return res.json({ success: true, paymentIntentId: paymentIntent.id });
  } catch (error) {
    return res.status(500).json({ message: "Failed to freeze payment" });
  }
});

export default router;
