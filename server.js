// server.js
import express from "express";
import mongoose from "mongoose"; // Fixed the typo here!
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// -----------------------------------------
// 1. MongoDB Connection
// -----------------------------------------
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/faceAnalyzer";

mongoose
    .connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected Successfully"))
    .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// -----------------------------------------
// 2. Mongoose Schema & Model
// -----------------------------------------
const faceSchema = new mongoose.Schema({
    detailedGender: { type: String, required: true },
    rawGender: { type: String, required: true },
    genderProbability: { type: Number, required: true },
    age: { type: Number, required: true },
    expression: { type: String, required: true },
    expressionProbability: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now },
});

const Face = mongoose.model("Face", faceSchema);

// -----------------------------------------
// 3. API Routes
// -----------------------------------------
app.post("/api/faces", async (req, res) => {
    try {
        const {
            detailedGender,
            rawGender,
            genderProbability,
            age,
            expression,
            expressionProbability,
        } = req.body;

        const newFaceData = new Face({
            detailedGender,
            rawGender,
            genderProbability,
            age,
            expression,
            expressionProbability,
        });

        const savedFace = await newFaceData.save();
        console.log("💾 New face data saved:", savedFace._id);

        res.status(201).json({
            success: true,
            message: "Face data saved successfully!",
            data: savedFace,
        });
    } catch (error) {
        console.error("Error saving face data:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

app.get("/api/faces", async (req, res) => {
    try {
        const faces = await Face.find().sort({ timestamp: -1 });
        res.status(200).json({ success: true, data: faces });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// -----------------------------------------
// 4. Start Server
// -----------------------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});