// import express from "express";
import stripe from "./stripe";
import { db, admin } from "./firebase";

async function validateCarpoolSession(matchId: string, sessionId: string) {
  const sessionRef = db
    .collection("matches")
    .doc(matchId)
    .collection("carpoolSessions")
    .doc(sessionId);
  const sessionDoc = await sessionRef.get();

  if (!sessionDoc.exists) {
    throw new Error("Session not found");
  }

  const sessionData = sessionDoc.data();

  if (!sessionData) {
    throw new Error("Session data is empty");
  }

  const {
    riderResponse,
    driverResponse,
    paymentIntentId,
    driverId,
    driverAmount,
    riderAmount,
    startTime,
    status,
  } = sessionData;
  if (status !== "pending") return;
  if (driverAmount == riderAmount) {
    await sessionRef.update({ amount: riderAmount });
  } else {
    return;
  }
  const amount = sessionData?.amount;
  console.log("amount", amount);
  const now = admin.firestore.Timestamp.now();
  const daysPassed = (now.seconds - startTime.seconds) / (60 * 60 * 24);
  if (riderResponse === "accepted" && driverResponse === "accepted") {
    console.log("accepted");
    // await stripe.paymentIntents.capture(paymentIntentId);
    console.log("stripe updated");
    await db
      .collection("users_wallet")
      .doc(driverId)
      .update({
        walletBalance: admin.firestore.FieldValue.increment(amount),
      });
    console.log("driver balance");
    await sessionRef.update({ status: "approved" });
  } else if (riderResponse === "refused" && driverResponse === "refused") {
    await stripe.paymentIntents.cancel(paymentIntentId);
    await sessionRef.update({ status: "canceled" });
    await db.collection("canceledTransactions").doc(paymentIntentId).set({
      matchId,
      sessionId,
      canceledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else if (daysPassed >= 14) {
    await escalateToAdmin(matchId, sessionId);
  }
}

async function escalateToAdmin(matchId: string, sessionId: string) {
  await sendEmailToAdmin(matchId, sessionId);

  await db
    .doc(`matches/${matchId}/carpoolSessions/${sessionId}`)
    .update({ status: "review" });
}

// ?? Send Email to Admin
async function sendEmailToAdmin(matchId: string, sessionId: string) {
  const msg = {
    to: "admin@yourapp.com",
    from: "no-reply@yourapp.com",
    subject: "Carpool session needs review",
    text: `Please review session: Match: ${matchId}, Session: ${sessionId}`,
  };

  // await sendgrid.send(msg);
  console.log("message:", msg);
}

export default validateCarpoolSession;
