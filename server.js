const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
const { Paynow } = require('paynow');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const transactions = {};

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
    const id = process.env.PAYNOW_USD_ID;
    const key = process.env.PAYNOW_USD_KEY;
    console.log('USD ID exists:', !!id);
    console.log('USD KEY exists:', !!key);
    if (!id || !key) {
      throw new Error('Missing USD Paynow credentials. Set PAYNOW_USD_ID and PAYNOW_USD_KEY.');
    }
    return new Paynow(id, key);
  }

  if (normalized === "ZWG") {
    const id = process.env.PAYNOW_ZWG_ID;
    const key = process.env.PAYNOW_ZWG_KEY;
    console.log('ZWG ID exists:', !!id);
    console.log('ZWG KEY exists:', !!key);
    if (!id || !key) {
      throw new Error('Missing ZWG Paynow credentials. Set PAYNOW_ZWG_ID and PAYNOW_ZWG_KEY.');
    }
    return new Paynow(id, key);
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
    console.log('Received body:', req.body);
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

    const reference = "MW-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase();

    const paynow = getPaynow(normalizedCurrency);

    const returnUrl = process.env.PAYNOW_RETURN_URL;
    const resultUrl = process.env.PAYNOW_RESULT_URL;
    console.log('Return URL:', returnUrl);
    console.log('Result URL:', resultUrl);

    if (!returnUrl || !resultUrl) {
      throw new Error('Missing PAYNOW_RETURN_URL or PAYNOW_RESULT_URL in environment variables.');
    }

    paynow.returnUrl = returnUrl;
    paynow.resultUrl = resultUrl;

    const payment = paynow.createPayment(reference, email || "");
    payment.add(description || "MindWorld Subscription", numericAmount);

    console.log('Sending payment to Paynow...');
    console.log('Payment object:', payment);

    const response = await paynow.send(payment);
    console.log('Paynow response type:', typeof response);
    console.log('Paynow response:', response);

    if (!response) {
      throw new Error('Paynow returned an empty response. This usually means your Integration ID or Secret Key is invalid. Please verify your Paynow credentials.');
    }

    if (response.success !== true) {
      const errorMsg = response.error || 'Paynow rejected the payment';
      console.error('Paynow rejection:', errorMsg);
      return res.status(502).json({
        success: false,
        error: errorMsg
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
    console.error('Paynow create error:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      error: error.message || "Unable to create Paynow payment"
    });
  }
});

// --------------------------------------------------------------
// CHECK PAYNOW PAYMENT STATUS (Client-side polling)
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
    console.error('Paynow status error:', error);
    return res.status(500).json({
      success: false,
      error: "Unable to check Paynow payment"
    });
  }
});

// --------------------------------------------------------------
// PAYNOW RESULT WEBHOOK (Server-to-server notification)
// --------------------------------------------------------------
app.post("/api/paynow/result", async (req, res) => {
  try {
    console.log('Paynow result webhook received:', req.body);
    const { reference, status, amount, paynowReference } = req.body;

    transactions[reference] = {
      status,
      amount,
      paynowReference,
      updatedAt: new Date()
    };

    console.log('Transaction', reference, 'updated to', status);
    res.sendStatus(200);
  } catch (error) {
    console.error('Paynow result error:', error);
    res.sendStatus(200);
  }
});

// --------------------------------------------------------------
// START SERVER
// --------------------------------------------------------------
app.listen(PORT, () => {
  console.log('MindWorld payment backend running on port', PORT);
});
