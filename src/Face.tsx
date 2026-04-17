import React, { useRef, useEffect, useState } from "react";
import * as faceapi from "face-api.js";

interface FaceData {
  gender: string;
  genderProbability: number;
  age: number;
  expression: string;
  expressionProbability: number;
}

const FaceDetector: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // A reference to prevent spamming the database
  const hasSavedRef = useRef<boolean>(false);

  const [isModelLoaded, setIsModelLoaded] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [detectionStatus, setDetectionStatus] = useState<string>("Loading AI Models...");
  const [faceData, setFaceData] = useState<FaceData | null>(null);
  const [showPopup, setShowPopup] = useState<boolean>(false);
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);

  // 1. Load ALL models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = "/models";
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        ]);
        setIsModelLoaded(true);
        setDetectionStatus("Models loaded. Ready to start camera.");
      } catch (error) {
        console.error("Error loading models:", error);
        setDetectionStatus("Error loading models. Check your public/models folder.");
      }
    };
    loadModels();
    return () => stopWebcam();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach((track) => track.stop());
    }
    if (intervalId) clearInterval(intervalId);
    setIsCameraActive(false);
    setFaceData(null);
    hasSavedRef.current = false; // Reset the save gatekeeper

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const startWebcam = async () => {
    setCameraError("");
    hasSavedRef.current = false;
    setShowPopup(false);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Camera API is blocked. You MUST open this link using HTTPS.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
        setDetectionStatus("Camera authorized. Scanning...");
      }
    } catch (error: any) {
      setCameraError(`Camera error: ${error.message || error.name}`);
    }
  };

  // 2. Save to Database Function
  const saveToDatabase = async (data: FaceData) => {
    try {
      // IMPORTANT: If deploying to Vercel, this must be changed to your live backend URL!
      // localhost:5000 will only work when testing on your own computer.
      const response = await fetch("http://localhost:5000/face-auth/addfaceauth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        console.log("Data successfully saved to MongoDB!");
        setShowPopup(true);
        setTimeout(() => setShowPopup(false), 3000);
      } else {
        console.error("Failed to save data.");
        hasSavedRef.current = false; // Open gate to try again
      }
    } catch (error) {
      console.error("API Connection Error:", error);
      hasSavedRef.current = false;
    }
  };

  // 3. Detect and DRAW
  // 3. Detect and DRAW
  const handleVideoOnPlay = () => {
    if (intervalId) clearInterval(intervalId);

    const id = setInterval(async () => {
      if (videoRef.current && canvasRef.current && isModelLoaded) {
        
        // Wait until the video has actual dimensions on the screen
        if (videoRef.current.clientWidth === 0 || videoRef.current.clientHeight === 0) {
          return;
        }

        const detection = await faceapi
          .detectSingleFace(
            videoRef.current,
            // --- ULTIMATE MOBILE FIX ---
            new faceapi.TinyFaceDetectorOptions({ 
              inputSize: 224,      // Lower resolution processes MUCH better on mobile
              scoreThreshold: 0.1  // Drop strictness to 10%. If it sees even a hint of a face, it tracks it!
            })
          )
          .withFaceLandmarks()
          .withAgeAndGender()
          .withFaceExpressions();

        if (detection) {
          setDetectionStatus("Face Tracked!");

          // Use clientWidth instead of videoWidth! This fixes the mobile squishing bug.
          const displaySize = {
            width: videoRef.current.clientWidth,
            height: videoRef.current.clientHeight,
          };
          
          faceapi.matchDimensions(canvasRef.current, displaySize);
          const resizedDetection = faceapi.resizeResults(detection, displaySize);

          // Clear and Draw
          canvasRef.current.getContext("2d")?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          faceapi.draw.drawDetections(canvasRef.current, resizedDetection);
          faceapi.draw.drawFaceLandmarks(canvasRef.current, resizedDetection);

          // Extract Data
          const genderProbability = Math.round(detection.genderProbability * 100);
          const gender = detection.gender === "male" ? "Man" : "Woman";
          const age = Math.round(detection.age);
          
          const sortedExpressions = Object.entries(detection.expressions).sort((a, b) => b[1] - a[1]);
          const [dominantExpression, expressionProb] = sortedExpressions[0];
          const expressionProbability = Math.round(expressionProb * 100);

          const currentFaceData = {
            gender,
            genderProbability,
            age,
            expression: dominantExpression,
            expressionProbability,
          };

          setFaceData(currentFaceData);

          // The 90% Confidence API Trigger
          if (genderProbability >= 90 && !hasSavedRef.current) {
            hasSavedRef.current = true; 
            saveToDatabase(currentFaceData); 
          }
        } else {
          setDetectionStatus("No face detected in frame.");
          setFaceData(null);
          canvasRef.current.getContext("2d")?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
    }, 150); // Slightly slower interval (150ms) gives the mobile processor more time to breathe

    setIntervalId(id);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "20px", fontFamily: "sans-serif", padding: "0 20px" }}>
      <h2>AI Face Analyzer Pro</h2>

      {/* Success Popup */}
      {showPopup && (
        <div style={{
          position: "fixed", top: "20px", left: "50%", transform: "translateX(-50%)",
          backgroundColor: "#4caf50", color: "white", padding: "15px 30px",
          borderRadius: "8px", boxShadow: "0 4px 6px rgba(0,0,0,0.2)",
          zIndex: 1000, fontWeight: "bold", fontSize: "18px", animation: "fadeIn 0.5s"
        }}>
          ✅ Face Detection Happened! Data Saved.
        </div>
      )}

      {/* Status Bar */}
      <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "#f0f0f0", borderRadius: "8px", width: "100%", maxWidth: "400px", textAlign: "center" }}>
        <h3 style={{ margin: "0 0 10px 0" }}>Status: {detectionStatus}</h3>
        {cameraError && <p style={{ color: "red", fontWeight: "bold", margin: 0 }}>{cameraError}</p>}
      </div>

      {/* Data Cards */}
      {faceData && (
        <div style={{ display: "flex", gap: "15px", marginBottom: "20px", flexWrap: "wrap", justifyContent: "center" }}>
          <div style={{ padding: "10px 20px", backgroundColor: "#e3f2fd", borderRadius: "8px", border: "1px solid #90caf9", textAlign: "center" }}>
            <p style={{ margin: "0", fontSize: "14px", color: "#1565c0" }}>Gender</p>
            <h3 style={{ margin: "5px 0 0 0" }}>{faceData.gender} ({faceData.genderProbability}%)</h3>
          </div>
          <div style={{ padding: "10px 20px", backgroundColor: "#e8f5e9", borderRadius: "8px", border: "1px solid #a5d6a7", textAlign: "center" }}>
            <p style={{ margin: "0", fontSize: "14px", color: "#2e7d32" }}>Estimated Age</p>
            <h3 style={{ margin: "5px 0 0 0" }}>~{faceData.age} years</h3>
          </div>
          <div style={{ padding: "10px 20px", backgroundColor: "#fff3e0", borderRadius: "8px", border: "1px solid #ffcc80", textAlign: "center" }}>
            <p style={{ margin: "0", fontSize: "14px", color: "#e65100" }}>Emotion</p>
            <h3 style={{ margin: "5px 0 0 0", textTransform: "capitalize" }}>{faceData.expression} ({faceData.expressionProbability}%)</h3>
          </div>
        </div>
      )}

      {/* Enable Camera Button */}
      {isModelLoaded && !isCameraActive && (
        <button
          onClick={startWebcam}
          style={{ padding: "12px 24px", fontSize: "16px", cursor: "pointer", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: "6px", marginBottom: "20px" }}
        >
          Enable Camera
        </button>
      )}

      {/* Video Container */}
      <div style={{ position: "relative", width: "100%", maxWidth: "640px", backgroundColor: "#000", display: isCameraActive ? "block" : "none", borderRadius: "8px", overflow: "hidden" }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onPlay={handleVideoOnPlay}
          style={{ width: "100%", height: "auto", display: "block" }}
        />
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
};

export default FaceDetector;