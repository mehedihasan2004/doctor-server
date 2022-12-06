const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const mg = require("nodemailer-mailgun-transport");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
// app.use(express.static("public"));

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6dotpwg.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const bookingEmailSending = (bookign) => {
  const { email, appointmentDate, name, slot } = bookign;
  const auth = {
    auth: {
      api_key: process.env.EMAIL_SEND_KEY,
      domain: process.env.EMAIL_SEND_DOMAIN,
    },
  };

  const transporter = nodemailer.createTransport(mg(auth));

  transporter.sendMail(
    {
      from: "thisismehedihasan0.1@gmail.com",
      to: email,
      subject: `You appointment is confirmed for ${name} on ${appointmentDate} at ${slot}`,
      text: "Hello world!",
      html: `
  <h1>Your Appointment is confirmed</h1>
  <div>
  <p>You have to visit on chamber on ${appointmentDate}</p>
  <p>Thank's for take a appointment</p>
  </div>
  `,
    },
    function (error, info) {
      if (error) {
        console.log(error);
      } else {
        console.log("Email sent: " + info.response);
      }
    }
  );
};

const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send("anauthorized access");
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
};

const run = async () => {
  try {
    const treatmentCollection = client.db("doctor").collection("treatments");
    const bookingsCollection = client.db("doctor").collection("bookings");
    const usersCollection = client.db("doctor").collection("users");
    const doctorsCollection = client.db("doctor").collection("doctors");
    const paymentsCollection = client.db("doctor").collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const docodedEmail = req.decoded.email;
      const query = {
        email: docodedEmail,
      };
      const user = await usersCollection.findOne(query);
      if (user?.role !== "Admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    app.get("/treatments", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const treatments = await treatmentCollection.find(query).toArray();

      const bookingQuery = { appointmentDate: date };

      const alredyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();
      treatments.forEach((treatment) => {
        const treatmentBooked = alredyBooked.filter(
          (book) => book.name === treatment.name
        );
        const bookedSlots = treatmentBooked.map((book) => book.slot);
        const remainingSlots = treatment.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        treatment.slots = remainingSlots;
      });

      res.send(treatments);
    });

    app.get("/treatmentsSpecialties", async (req, res) => {
      const query = {};
      const result = await treatmentCollection
        .find(query)
        .project({ name: 1 })
        .toArray();
      res.send(result);
    });

    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: "forbidden access" });
      }
      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    app.get("/bookings/:id", async (req, res) => {
      const query = { _id: ObjectId(req.params.id) };
      const result = await bookingsCollection.findOne(query);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    });

    app.get("/users/admin/:email", async (req, res) => {
      const query = { email: req.params.email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === "Admin" });
    });

    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    });

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const amount = req.body?.fee * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        currency: "usd",
        amount: amount,
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = {
        email: email,
      };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, {
          expiresIn: "1d",
        });
        return res.send({ accessToken: token });
      }
      res.status(403).send({ accessToken: "user forbidden" });
    });

    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        name: booking.name,
        email: booking.email,
      };
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if (alreadyBooked.length) {
        return res.send({
          acknowledged: false,
          message: `You already have a booking on ${booking.appointmentDate}`,
        });
      }
      const result = await bookingsCollection.insertOne(booking);
      bookingEmailSending(booking);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const users = await usersCollection.insertOne(user);
      res.send(users);
    });

    app.post("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const doctors = await doctorsCollection.insertOne(doctor);
      res.send(doctors);
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const filter = { _id: ObjectId(payment?.bookingId) };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const updatedResult = await bookingsCollection.updateOne(
        filter,
        updatedDoc
      );
      res.send(result);
    });

    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          role: "Host",
        },
      };
      const result = await usersCollection.updateOne(
        filter,
        updateDoc,
        options
      );
      res.send(result);
    });

    app.delete("/doctors/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const query = { _id: ObjectId(req.params.id) };
      const result = await doctorsCollection.deleteOne(query);
      res.send(result);
    });
  } finally {
  }
};
run().catch((err) => console.log(err));

app.get("/", (req, res) => {
  res.send("The server (doctor server) is Running");
});

app.listen(port, () => {
  console.log("The doctor server is running on PORT", port);
});
