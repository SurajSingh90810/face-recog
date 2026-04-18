import React, { useRef, useEffect, useState } from "react";
import * as faceapi from "@vladmandic/face-api";

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
  const lastSavedTimeRef = useRef<number>(0);
  
  // Gatekeepers
  const isDetectingRef = useRef<boolean>(false);
  const modelsLoadedRef = useRef<boolean>(false);

  const [isModelLoaded, setIsModelLoaded] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [detectionStatus, setDetectionStatus] = useState<string>(
    "Loading AI Models...",
  );
  const [faceData, setFaceData] = useState<FaceData | null>(null);

  // 1. Load ALL models (The library automatically handles the WebGL backend now!)
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    } catch (error: any) {
      setCameraError(`Camera error: ${error.message || error.name}`);
    }
  };

  // 2. Detect and DRAW
  const handleVideoOnPlay = () => {
    isDetectingRef.current = true;
    // Give the browser 500ms to actually paint the video frame to the DOM
    setTimeout(detectFaceLoop, 500);
  };

  const detectFaceLoop = async () => {
    if (
      !isDetectingRef.current ||
      !videoRef.current ||
      !canvasRef.current ||
      !isModelLoaded
    ) {
      return;
    }

    // Require readyState === 4 (HAVE_ENOUGH_DATA) to ensure a complete frame is available
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
          faceapi.draw.drawDetections(canvasRef.current, resizedDetection);
          faceapi.draw.drawFaceLandmarks(canvasRef.current, resizedDetection);

          // Extract Data safely
          const genderProbability = Math.round(
            detection.genderProbability * 100,
          );
          const gender = detection.gender === "male" ? "Man" : "Woman";
          const age = Math.round(detection.age);

          const sortedExpressions = Object.entries(detection.expressions).sort(
            (a, b) => b[1] - a[1],
          );
          const [dominantExpression, expressionProb] = sortedExpressions[0];
          const expressionProbability = Math.round(expressionProb * 100);

          setFaceData({
            gender,
            genderProbability,
            age,
            expression: dominantExpression,
            expressionProbability,
          });

          // ---------------------------------------------------------
          // NEW: Save data to MongoDB every 2 seconds, BUT ONLY if confidence is >= 90%
          // ---------------------------------------------------------
          const now = Date.now();
          const SAVE_INTERVAL_MS = 2000;

          if (now - lastSavedTimeRef.current > SAVE_INTERVAL_MS && genderProbability >= 90) {
            lastSavedTimeRef.current = now;

            try {
              await fetch("http://localhost:5000/api/faces", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  gender,
                  genderProbability,
                  age,
                  expression: dominantExpression,
                  expressionProbability,
                }),
              });
              console.log("Snapshot saved to database (High confidence hit)!");
            } catch (dbError) {
              console.error("Failed to save to database:", dbError);
            }
          }
          // ---------------------------------------------------------

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

    // Trigger next frame only if still detecting, with a safe 150ms breather
    if (isDetectingRef.current) {
      setTimeout(detectFaceLoop, 150);
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
            }}
          >
            <p style={{ margin: "0", fontSize: "14px", color: "#1565c0" }}>
              Gender
            </p>
            <h3 style={{ margin: "5px 0 0 0" }}>
              {faceData.gender} ({faceData.genderProbability}%)
            </h3>
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
          width: "100%",
          maxWidth: "640px",
          backgroundColor: "#000",
          display: isCameraActive ? "block" : "none",
          borderRadius: "8px",
          overflow: "hidden",
        }}
      >
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
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
          }}
        />
      </div>
    </div>
  );
};

export default FaceDetector;