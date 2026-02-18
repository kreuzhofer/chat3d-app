import { Router } from "express";
import {
  confirmWaitlistEmail,
  getWaitlistStatus,
  joinWaitlist,
  WaitlistError,
} from "../services/waitlist.service.js";

function isValidEmail(email: string): boolean {
  return /.+@.+\..+/.test(email);
}

export const waitlistRouter = Router();

waitlistRouter.post("/join", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const marketingConsent = req.body?.marketingConsent === true;

  if (!email || !isValidEmail(email)) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }

  try {
    const result = await joinWaitlist({
      email,
      marketingConsent,
    });

    res.status(202).json({
      entryId: result.entryId,
      status: result.status,
    });
  } catch (error) {
    if (error instanceof WaitlistError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to join waitlist", detail: String(error) });
  }
});

waitlistRouter.post("/confirm", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  try {
    const result = await confirmWaitlistEmail(token);
    res.status(200).json({
      entryId: result.entryId,
      email: result.email,
      status: result.status,
    });
  } catch (error) {
    if (error instanceof WaitlistError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to confirm waitlist entry", detail: String(error) });
  }
});

waitlistRouter.get("/confirm-email", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  try {
    const result = await confirmWaitlistEmail(token);
    res.status(200).json({
      entryId: result.entryId,
      email: result.email,
      status: result.status,
    });
  } catch (error) {
    if (error instanceof WaitlistError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to confirm waitlist entry", detail: String(error) });
  }
});

waitlistRouter.get("/status", async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email : undefined;
  const token = typeof req.query.token === "string" ? req.query.token : undefined;

  try {
    const result = await getWaitlistStatus({
      email,
      confirmationToken: token,
    });

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof WaitlistError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Failed to fetch waitlist status", detail: String(error) });
  }
});
