const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Load environment variables from .env file
dotenv.config();

const stripe = require("stripe")(process.env.PAYMENT_GATEWAY_KEY);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.9rzwgbq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("parcelDB");
    const parcelCollection = db.collection("parcels");
    const paymentsCollection = db.collection("payments");

    app.get("/parcels", async (req, res) => {
      const parcels = await parcelCollection.find().toArray();
      res.send(parcels);
    });

    // parcels er api
    app.get("/my-parcels", async (req, res) => {
      try {
        const userEmail = req.query.email;
        // 🟡 Query: If email exists, filter; else get all
        const query = userEmail ? { created_by: userEmail } : {};

        // 🟢 Options: Sort by creation_date descending
        const options = { sort: { creation_date: -1 } };

        // 🔵 Fetch from MongoDB
        const parcels = await parcelCollection.find(query, options).toArray();

        res.send(parcels);
      } catch (error) {
        console.error("❌ Error fetching parcels:", error);
        res.status(500).send({ message: "Failed to fetch parcels" });
      }
    });

    // / GET: Get a specific parcel by ID
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const parcel = await parcelCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!parcel) {
          return res.status(404).send({ message: "Parcel not found" });
        }

        res.send(parcel);
      } catch (error) {
        console.error("Error fetching parcel:", error);
        res.status(500).send({ message: "Failed to fetch parcel" });
      }
    });

    // Add Parcel (sample route)
    app.post("/add-parcels", async (req, res) => {
      const parcel = req.body;

      // ✅ Backend-side creation_date নিশ্চিত করো
      parcel.creation_date = new Date();

      const result = await parcelCollection.insertOne(parcel);
      res.send(result);
    });

    app.delete("/my-parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // Optional: validate ID to avoid crash (recommended, but optional for you)
        const query = { _id: new ObjectId(id) };

        const result = await parcelCollection.deleteOne(query);

        res.send(result); // Just send raw result
      } catch (error) {
        console.error("❌ Error deleting parcel:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.post("/tracking", async (req, res) => {
      const {
        tracking_id,
        parcel_id,
        status,
        message,
        updated_by = "",
      } = req.body;

      const log = {
        tracking_id,
        parcel_id: parcel_id ? new ObjectId(parcel_id) : undefined,
        status,
        message,
        time: new Date(),
        updated_by,
      };

      const result = await trackingCollection.insertOne(log);
      res.send({ success: true, insertedId: result.insertedId });
    });

    app.get("/payments", async (req, res) => {
      try {
        const userEmail = req.query.email;

        const query = userEmail ? { email: userEmail } : {};
        const options = { sort: { paid_at: -1 } }; // Latest first

        const payments = await paymentsCollection
          .find(query, options)
          .toArray();
        res.send(payments);
      } catch (error) {
        console.error("Error fetching payment history:", error);
        res.status(500).send({ message: "Failed to get payments" });
      }
    });

    // POST: Record payment and update parcel status
    app.post("/payments", async (req, res) => {
      try {
        const { parcelId, email, amount, paymentMethod, transactionId } =
          req.body;

        // 1. Update parcel's payment_status
        const updateResult = await parcelCollection.updateOne(
          { _id: new ObjectId(parcelId) },
          {
            $set: {
              payment_status: "paid",
            },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res
            .status(404)
            .send({ message: "Parcel not found or already paid" });
        }

        // 2. Insert payment record
        const paymentDoc = {
          parcelId,
          email,
          amount,
          paymentMethod,
          transactionId,
          paid_at_string: new Date().toISOString(),
          paid_at: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.status(201).send({
          message: "Payment recorded and parcel marked as paid",
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        console.error("Payment processing failed:", error);
        res.status(500).send({ message: "Failed to record payment" });
      }
    });

    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Simple route
app.get("/", (req, res) => {
  res.send("Parcel Server is Running");
});

// Start server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
