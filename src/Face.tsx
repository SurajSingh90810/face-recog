import React, { useRef, useEffect, useState } from "react";
import * as faceapi from "@vladmandic/face-api";

interface FaceData {
  detailedGender: string; // Boy, Girl, Man, Woman
  rawGender: string;      // Male, Female
  genderProbability: number;
  age: number;
  expression: string;
  expressionProbability: number;
}

const FaceDetector: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Gatekeepers
  const isDetectingRef = useRef<boolean>(false);
  const modelsLoadedRef = useRef<boolean>(false);

  // NEW: Replaced the Date timer with a simple boolean cooldown lock
  const isSavingCooldownRef = useRef<boolean>(false);

  const [isModelLoaded, setIsModelLoaded] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [detectionStatus, setDetectionStatus] = useState<string>(
    "Loading AI Models...",
  );
  const [faceData, setFaceData] = useState<FaceData | null>(null);

  // 1. Define stopWebcam FIRST so useEffect can use it safely
  const stopWebcam = () => {
    isDetectingRef.current = false;

    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach((track) => track.stop());
    }

    setIsCameraActive(false);
    setFaceData(null);

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  // 2. Load ALL models
  useEffect(() => {
    if (modelsLoadedRef.current) return;
    modelsLoadedRef.current = true;

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
        setDetectionStatus(
          "Error loading models. Check your public/models folder.",
        );
      }
    };

    loadModels();

    return () => stopWebcam();
  }, []);

  // 3. Define the main detection loop
  // 3. Define the main detection loop
  const detectFaceLoop = async () => {
    if (
      !isDetectingRef.current ||
      !videoRef.current ||
      !canvasRef.current ||
      !isModelLoaded
    ) {
      return;
    }

    // Require readyState === 4 (HAVE_ENOUGH_DATA)
    if (
      videoRef.current.readyState === 4 &&
      videoRef.current.videoWidth > 0 &&
      videoRef.current.videoHeight > 0
    ) {
      try {
        const detection = await faceapi
          .detectSingleFace(
            videoRef.current,
            new faceapi.TinyFaceDetectorOptions({
              inputSize: 224,
              scoreThreshold: 0.1,
            }),
          )
          .withFaceLandmarks()
          .withAgeAndGender()
          .withFaceExpressions();

        if (detection) {
          setDetectionStatus("Face Tracked!");

          const displaySize = {
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight,
          };

          faceapi.matchDimensions(canvasRef.current, displaySize);
          const resizedDetection = faceapi.resizeResults(
            detection,
            displaySize,
          );

          // Clear and Draw
          const ctx = canvasRef.current.getContext("2d");
          ctx?.clearRect(
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height,
          );

          // Custom Landmark Styling
          const drawOptions = new faceapi.draw.DrawFaceLandmarksOptions({
            lineWidth: 1,          // Thin lines
            pointSize: 1,          // Small dots
            lineColor: '#00ffff',  // Cyan
            pointColor: '#ff00ff', // Pink
          });

          const drawLandmarks = new faceapi.draw.DrawFaceLandmarks(
            resizedDetection.landmarks,
            drawOptions
          );
          drawLandmarks.draw(canvasRef.current);

          // =========================================================
          // Data Extraction & Formatting
          // =========================================================
          const age = Math.round(detection.age);
          const genderProbability = Math.round(detection.genderProbability * 100);

          // The AI returns exactly "male" or "female"
          const rawAiGender = detection.gender;

          // Format Male/Female with capital letters
          const formattedRawGender = rawAiGender === "male" ? "Male" : "Female";

          // Use Age to determine Boy vs Man, Girl vs Woman
          let detailedGender = "";
          if (rawAiGender === "male") {
            detailedGender = age < 18 ? "Boy" : "Man";
          } else {
            detailedGender = age < 18 ? "Girl" : "Woman";
          }

          const sortedExpressions = Object.entries(detection.expressions).sort(
            (a, b) => b[1] - a[1],
          );
          const [dominantExpression, expressionProb] = sortedExpressions[0];
          const expressionProbability = Math.round(expressionProb * 100);

          // 1. Update the UI Cards
          setFaceData({
            detailedGender,
            rawGender: formattedRawGender,
            genderProbability,
            age,
            expression: dominantExpression,
            expressionProbability,
          });

          // =========================================================
          // MODIFIED: Stop & Save if Male is >= 70%
          // =========================================================

          if (rawAiGender === "male" && genderProbability >= 70 && !isSavingCooldownRef.current) {

            isSavingCooldownRef.current = true; // Lock immediately to prevent duplicates

            try {
              fetch("http://localhost:5000/api/faces", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  detailedGender,
                  rawGender: formattedRawGender,
                  genderProbability,
                  age,
                  expression: dominantExpression,
                  expressionProbability,
                }),
              })
                .then((res) => res.json())
                .then((data) => {
                  console.log("✅ Saved to DB:", data);
                  setDetectionStatus("Match Found & Saved! Camera Stopped.");

                  // Turn off the camera hardware
                  if (videoRef.current && videoRef.current.srcObject) {
                    const stream = videoRef.current.srcObject as MediaStream;
                    const tracks = stream.getTracks();
                    tracks.forEach((track) => track.stop());
                  }

                  // Update UI States to break the loop but keep data visible
                  setIsCameraActive(false);
                  isDetectingRef.current = false;
                })
                .catch((err) => {
                  console.error("❌ Fetch error:", err);
                  isSavingCooldownRef.current = false; // Unlock if network fails so it can try again
                });
            } catch (dbError) {
              console.error("Failed to send to backend:", dbError);
              isSavingCooldownRef.current = false;
            }
          }
          // =========================================================

        } else {
          setDetectionStatus("No face detected in frame.");
          setFaceData(null);
          const ctx = canvasRef.current.getContext("2d");
          ctx?.clearRect(
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height,
          );
        }
      } catch (error) {
        console.warn("Detection frame skipped due to engine load:", error);
      }
    }

    if (isDetectingRef.current) {
      setTimeout(detectFaceLoop, 150);
    }
  };

  // 4. Define video play handler AFTER detectFaceLoop is defined
  const handleVideoOnPlay = () => {
    isDetectingRef.current = true;
    setTimeout(detectFaceLoop, 500);
  };

  // 5. Start Webcam logic
  const startWebcam = async () => {
    setCameraError("");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        "Camera API is blocked. You MUST open this link using HTTPS.",
      );
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
    } catch (error) {
      const err = error as Error;
      setCameraError(`Camera error: ${err.message || err.name || "Unknown error"}`);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: "20px",
        fontFamily: "sans-serif",
        padding: "0 20px",
      }}
    >
      <h2>AI Face Analyzer Pro</h2>

      {/* Status Bar */}
      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          backgroundColor: "#f0f0f0",
          borderRadius: "8px",
          width: "100%",
          maxWidth: "400px",
          textAlign: "center",
        }}
      >
        <h3 style={{ margin: "0 0 10px 0" }}>Status: {detectionStatus}</h3>
        {cameraError && (
          <p style={{ color: "red", fontWeight: "bold", margin: 0 }}>
            {cameraError}
          </p>
        )}
      </div>

      {/* Data Cards */}
      {faceData && (
        <div
          style={{
            display: "flex",
            gap: "15px",
            marginBottom: "20px",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              padding: "10px 20px",
              backgroundColor: "#e3f2fd",
              borderRadius: "8px",
              border: "1px solid #90caf9",
              textAlign: "center",
              minWidth: "140px"
            }}
          >
            <p style={{ margin: "0", fontSize: "14px", color: "#1565c0" }}>
              Identity
            </p>
            <h3 style={{ margin: "5px 0 0 0" }}>
              {faceData.detailedGender}
            </h3>
            <p style={{ margin: "5px 0 0 0", fontSize: "12px", color: "#1565c0" }}>
              ({faceData.rawGender} - {faceData.genderProbability}%)
            </p>
          </div>
          <div
            style={{
              padding: "10px 20px",
              backgroundColor: "#e8f5e9",
              borderRadius: "8px",
              border: "1px solid #a5d6a7",
              textAlign: "center",
            }}
          >
            <p style={{ margin: "0", fontSize: "14px", color: "#2e7d32" }}>
              Estimated Age
            </p>
            <h3 style={{ margin: "5px 0 0 0" }}>~{faceData.age} years</h3>
          </div>
          <div
            style={{
              padding: "10px 20px",
              backgroundColor: "#fff3e0",
              borderRadius: "8px",
              border: "1px solid #ffcc80",
              textAlign: "center",
            }}
          >
            <p style={{ margin: "0", fontSize: "14px", color: "#e65100" }}>
              Emotion
            </p>
            <h3 style={{ margin: "5px 0 0 0", textTransform: "capitalize" }}>
              {faceData.expression} ({faceData.expressionProbability}%)
            </h3>
          </div>
        </div>
      )}

      {/* Enable Camera Button */}
      {isModelLoaded && !isCameraActive && (
        <button
          onClick={startWebcam}
          style={{
            padding: "12px 24px",
            fontSize: "16px",
            cursor: "pointer",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "6px",
            marginBottom: "20px",
          }}
        >
          Enable Camera
        </button>
      )}

      {/* Video Container */}
      <div
        style={{
          position: "relative",
          width: "300px",
          height: "300px",
          backgroundColor: "#000",
          display: isCameraActive ? "block" : "none",
          borderRadius: "50%",
          overflow: "hidden",
          border: "4px solid #007bff",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
          margin: "0 auto 20px auto",
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onPlay={handleVideoOnPlay}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        />
      </div>
    </div>
  );
};

export default FaceDetector;