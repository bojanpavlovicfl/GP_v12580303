import express from "express";
import { db, admin } from "./firebase";
import validateCarpoolSession from "./validation";
// import stripe from "./stripe";
const router = express.Router();

router.post("/update-rider-response", async (req, res) => {
  try {
    const { matchId, sessionId, riderResponse, riderAmount } = req.body;
    const sessionRef = db
      .collection(`matches/${matchId}/carpoolSessions`)
      .doc(sessionId);

    await sessionRef.update({ riderResponse });
    await sessionRef.update({ riderAmount });

    const sessionData = (await sessionRef.get()).data();
    // ?? If `startTime` is not set (first user response), add it
    if (!sessionData?.startTime) {
      await sessionRef.update({ startTime: admin.firestore.Timestamp.now() });
    }
    // // Check if both responses exist & validate session
    if (sessionData?.driverResponse) {
      await validateCarpoolSession(matchId, sessionId);
    }

    res.json({ success: true, message: "Rider response saved" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to update rider response" });
  }
});

router.post("/update-driver-response", async (req, res) => {
  try {
    const { matchId, sessionId, driverResponse, driverId, driverAmount } =
      req.body;
    const sessionRef = db
      .collection(`matches/${matchId}/carpoolSessions`)
      .doc(sessionId);

    await sessionRef.update({ driverResponse });
    await sessionRef.update({ driverId });
    await sessionRef.update({ driverAmount });

    // Check if both responses exist & validate session
    const sessionData = (await sessionRef.get()).data();
    // ?? If `startTime` is not set (first user response), add it
    if (!sessionData?.startTime) {
      await sessionRef.update({ startTime: admin.firestore.Timestamp.now() });
    }
    if (sessionData?.riderResponse) {
      await validateCarpoolSession(matchId, sessionId);
    }

    res.json({
      success: true,
      message: "Driver response saved",
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to update driver response" });
  }
});

export default router;
