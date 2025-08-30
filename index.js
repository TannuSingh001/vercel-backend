// index.js
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
import dotenv from "dotenv";

dotenv.config(); // load env variables

const app = express();


const mongoURI = process.env.MONGO_URI;
const jwtSecret = process.env.JWT_SECRET;

const allowedOrigins = ["http://localhost:3000", "http://localhost:5173"];
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Postman/non-browser
      if (allowedOrigins.indexOf(origin) === -1) {
        return callback(new Error("Not allowed by CORS"), false);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));


mongoose
  .connect(mongoURI)
  .then(() => console.log("MongoDB connected successfully"))
  .catch((err) => console.error("MongoDB connection error:", err));


const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype);
  if (extname && mimetype) cb(null, true);
  else cb(new Error("Only images are allowed"));
};

const upload = multer({ storage, fileFilter });


const DataSchema = new mongoose.Schema({
  title: String,
  description: String,
  imageUrl: String,
});
const DataModel = mongoose.model("Data", DataSchema);

const ProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    new_price: { type: Number, required: true },
    old_price: { type: Number, default: 0 },
    images: [{ type: String, required: true }],
    category: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    available: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Product = mongoose.model("Product", ProductSchema);

const Users = mongoose.model("Users", {
  name: { type: String },
  email: { type: String, unique: true },
  password: { type: String },
  cartDate: { type: Object },
  date: { type: Date, default: Date.now },
});

const Orders = mongoose.model("Orders", {
  userId: { type: String, required: true },
  products: { type: Object, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now },
});


app.post("/api/data", upload.single("image"), async (req, res) => {
  try {
    const newData = new DataModel({
      title: req.body.title,
      description: req.body.description,
      imageUrl: req.file ? `/uploads/${req.file.filename}` : null,
    });
    await newData.save();
    res.status(201).json({ success: true, data: newData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Something went wrong" });
  }
});

app.get("/api/data", async (req, res) => {
  try {
    const data = await DataModel.find();
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Something went wrong" });
  }
});


app.post("/products", upload.array("images", 50), async (req, res) => {
  try {
    const images = req.files
      ? req.files.map((file) => `/uploads/${file.filename}`)
      : [];

    let parsedData = {};
    if (req.body.data) {
      try {
        parsedData = JSON.parse(req.body.data);
      } catch (e) {
        parsedData = {};
      }
    }

    const product = new Product({
      name: req.body.name,
      description: req.body.description,
      new_price: req.body.new_price,
      old_price: req.body.old_price,
      category: req.body.category,
      images,
      data: parsedData,
      available: req.body.available !== undefined ? req.body.available : true,
    });

    await product.save();
    res.status(201).json({ success: true, product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Something went wrong" });
  }
});

app.get("/products", async (req, res) => {
  try {
    const products = await Product.find();
    res.json({ success: true, products });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Something went wrong" });
  }
});

app.delete("/products/:id", async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product)
      return res.status(404).json({ success: false, error: "Product not found" });
    res.json({ success: true, product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Something went wrong" });
  }
});

app.put("/products/:id", upload.array("images", 50), async (req, res) => {
  try {
    const updatedData = {
      name: req.body.name,
      description: req.body.description,
      new_price: req.body.new_price,
      old_price: req.body.old_price,
      category: req.body.category,
      available: req.body.available !== undefined ? req.body.available : true,
    };

    if (req.files && req.files.length > 0) {
      updatedData.images = req.files.map((file) => `/uploads/${file.filename}`);
    }

    if (req.body.data) {
      try {
        updatedData.data = JSON.parse(req.body.data);
      } catch (e) {
        updatedData.data = {};
      }
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updatedData, {
      new: true,
    });
    if (!product)
      return res.status(404).json({ success: false, error: "Product not found" });
    res.json({ success: true, product });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Something went wrong" });
  }
});


app.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existingUser = await Users.findOne({ email });
    if (existingUser)
      return res.status(400).json({ success: false, error: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const cart = {};
    for (let i = 0; i < 300; i++) cart[i] = 0;

    const user = new Users({
      name: username,
      email,
      password: hashedPassword,
      cartDate: cart,
    });
    await user.save();

    const payload = { user: { id: user._id.toString() } };
    const token = jwt.sign(payload, "secret_ecom", { expiresIn: "1h" });

    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await Users.findOne({ email });
    if (!user) return res.status(400).json({ success: false, error: "Invalid Email" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, error: "Invalid Password" });

    const payload = { user: { id: user._id.toString() } };
    const token = jwt.sign(payload, "secret_ecom", { expiresIn: "1h" });

    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});





app.listen(5000, () => console.log("Server running on port 5000"));
