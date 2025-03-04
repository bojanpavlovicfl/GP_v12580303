import express from "express";
import { db } from "./firebase";

const router = express.Router();

// **1. Validate Carpool Session**
router.post("/validate", async (req, res) => {
  try {
    const { sessionId, driverResponse, riderResponse, matchId } = req.body;

    // Check match document
    const matchRef = db.collection("carpool_sessions").doc(matchId);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
      return res.status(404).json({ error: "Match not found" });
    }

    const sessionRef = db.collection("carpool_sessions").doc(sessionId);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(404).json({ error: "Carpool session not found" });
    }

    // If both accept, approve payment
    if (driverResponse === "accept" && riderResponse === "accept") {
      await sessionRef.update({ status: "approved" });
      return res.json({ success: true, message: "Transaction approved" });
    }

    // If both refuse, cancel payment
    if (driverResponse === "refuse" && riderResponse === "refuse") {
      await sessionRef.update({ status: "canceled" });
      return res.json({ success: true, message: "Transaction canceled" });
    }

    // If one refuses, require admin validation
    if (driverResponse !== riderResponse) {
      await sessionRef.update({ status: "disputed" });
      return res.json({ success: true, message: "Transaction under review" });
    }

    // If one user did not answer, check for intervention
    if (driverResponse === "DNA" || riderResponse === "DNA") {
      const startTime = sessionDoc.data()?.startTime;
      const currentTime = new Date();
      const timeDiff = Math.floor(
        (currentTime.getTime() - startTime.toDate().getTime()) /
          (1000 * 60 * 60 * 24)
      );

      if (timeDiff > 14) {
        return res.json({
          success: true,
          message: "Session ignored due to inactivity",
        });
      } else {
        await sessionRef.update({ status: "admin_intervention" });
        return res.json({
          success: true,
          message: "Admin intervention required",
        });
      }
    }

    return res.status(400).json({ error: "Invalid responses" });
  } catch (error) {
    console.error("Error validating session:", error);
    return res.status(500).json({ error: "Validation failed" });
  }
});

export default router;
