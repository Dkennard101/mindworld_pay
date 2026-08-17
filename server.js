const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
// ✅ Correct – imports the Paynow constructor
const { Paynow } = require('paynow');
console.log('Paynow type:', typeof Paynow);
console.log('Paynow value:', Paynow);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory transaction store (replace with real DB later)
const transactions = {};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  console.error('Global Error:', err.stack);
  res.status(500).json({ error: err.message });
});
// --------------------------------------------------------------
// PAYNOW CONFIGURATION
// --------------------------------------------------------------
function getPaynow(currency) {
  const normalized = String(currency || "").toUpperCase();

  if (normalized === "USD") {
    return new Paynow(
      process.env.PAYNOW_USD_ID,
      process.env.PAYNOW_USD_KEY
    );
  }

  if (normalized === "ZWG") {
    return new Paynow(
      process.env.PAYNOW_ZWG_ID,
      process.env.PAYNOW_ZWG_KEY
    );
  }

  throw new Error("Unsupported currency");
}

// --------------------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "MindWorld Payment Backend",
    status: "running"
  });
});

// --------------------------------------------------------------
// CREATE PAYNOW PAYMENT
// --------------------------------------------------------------
app.post("/api/paynow/create", async (req, res) => {
  try {
    const { currency, amount, description, email } = req.body;

    const normalizedCurrency = String(currency || "").toUpperCase();
    const numericAmount = Number(amount);

    if (!["USD", "ZWG"].includes(normalizedCurrency)) {
      return res.status(400).json({
        success: false,
        error: "Currency must be USD or ZWG"
      });
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid payment amount"
      });
    }

    const reference =
      "MW-" +
      Date.now() +
      "-" +
      crypto.randomBytes(4).toString("hex").toUpperCase();

    const paynow = getPaynow(normalizedCurrency);
    const payment = paynow.createPayment(reference, email || "");
    payment.add(description || "MindWorld Subscription", numericAmount);

    // ★ Set return and result URLs from environment ★
    payment.returnUrl = process.env.PAYNOW_RETURN_URL;
    payment.resultUrl = process.env.PAYNOW_RESULT_URL;

    const response = await paynow.send(payment);

    if (!response.success) {
      return res.status(502).json({
        success: false,
        error: response.error || "Paynow rejected the payment"
      });
    }

    return res.json({
      success: true,
      reference: reference,
      pollUrl: response.pollUrl,
      redirectUrl: response.redirectUrl,
      amount: numericAmount,
      currency: normalizedCurrency
    });

  } catch (error) {
    console.error("Paynow create error:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to create Paynow payment"
    });
  }
});

// --------------------------------------------------------------
// CHECK PAYNOW PAYMENT STATUS (Client‑side polling)
// --------------------------------------------------------------
app.post("/api/paynow/status", async (req, res) => {
  try {
    const { currency, pollUrl } = req.body;
    const normalizedCurrency = String(currency || "").toUpperCase();

    if (!["USD", "ZWG"].includes(normalizedCurrency)) {
      return res.status(400).json({
        success: false,
        error: "Invalid currency"
      });
    }

    if (!pollUrl) {
      return res.status(400).json({
        success: false,
        error: "pollUrl is required"
      });
    }

    const paynow = getPaynow(normalizedCurrency);
    const status = await paynow.poll(pollUrl);

    return res.json({
      success: true,
      paid: status.paid(),
      status: status.status,
      amount: status.amount,
      reference: status.reference,
      paynowReference: status.paynowReference,
      currency: normalizedCurrency
    });

  } catch (error) {
    console.error("Paynow status error:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to check Paynow payment"
    });
  }
});

// --------------------------------------------------------------
// PAYNOW RESULT WEBHOOK (Server‑to‑server notification)
// --------------------------------------------------------------
app.post("/api/paynow/result", async (req, res) => {
  try {
    console.log("Paynow result webhook received:", req.body);

    const { reference, status, amount, paynowReference } = req.body;

    // Store transaction (replace with database update)
    transactions[reference] = {
      status,
      amount,
      paynowReference,
      updatedAt: new Date()
    };

    console.log(`✅ Transaction ${reference} updated to ${status}`);

    res.sendStatus(200);
  } catch (error) {
    console.error("Paynow result error:", error);
    res.sendStatus(200); // still respond 200 to avoid retries
  }
});

// --------------------------------------------------------------
// START SERVER
// --------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`MindWorld payment backend running on port ${PORT}`);
});
