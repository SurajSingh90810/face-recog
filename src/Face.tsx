import React, { useRef, useEffect, useState } from "react";
import * as faceapi from "face-api.js";

// Define a type for our new detailed face data
interface FaceData {
  gender: string;
  genderProbability: number;
  age: number;
  expression: string;
  expressionProbability: number;
}

const FaceDetector: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // States
  const [isModelLoaded, setIsModelLoaded] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [detectionStatus, setDetectionStatus] = useState<string>(
    "Loading AI Models...",
  );

  // New state to hold our expanded data
  const [faceData, setFaceData] = useState<FaceData | null>(null);

  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);

  // 1. Load the models
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = "/models";
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
          // Add the new expression model here!
          faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
        ]);

        setIsModelLoaded(true);
        setDetectionStatus("Models loaded. Ready to start camera.");
      } catch (error) {
        console.error("Error loading models:", error);
        setDetectionStatus(
          "Error loading models. Did you add the expression models?",
        );
      }
    };

    loadModels();

    return () => {
      stopWebcam();
    };
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
  };

  // 2. Start the webcam
  const startWebcam = async () => {
    setCameraError("");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        "Camera API is blocked by your browser. You MUST open this link using HTTPS.",
      );
      setIsCameraActive(false);
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
      console.error("Error accessing webcam:", error);
      setIsCameraActive(false);
      setCameraError(`Camera error: ${error.message || error.name}`);
    }
  };

  // 3. Handle video play and start detecting
  const handleVideoOnPlay = () => {
    if (intervalId) clearInterval(intervalId);

    const id = setInterval(async () => {
      if (videoRef.current && isModelLoaded) {
        // Chain the new .withFaceExpressions() method
        const detection = await faceapi
          .detectSingleFace(
            videoRef.current,
            new faceapi.TinyFaceDetectorOptions(),
          )
          .withAgeAndGender()
          .withFaceExpressions();

        if (detection) {
          setDetectionStatus("Face Tracked!");

          // Extract Gender and Age
          const gender = detection.gender === "male" ? "Man" : "Woman";
          const genderProbability = Math.round(
            detection.genderProbability * 100,
          );
          const age = Math.round(detection.age);

          // Extract the dominant emotion (highest probability)
          const expressions = detection.expressions;
          const sortedExpressions = Object.entries(expressions).sort(
            (a, b) => b[1] - a[1],
          );
          const [dominantExpression, expressionProb] = sortedExpressions[0];
          const expressionProbability = Math.round(expressionProb * 100);

          // Save it to state to display
          setFaceData({
            gender,
            genderProbability,
            age,
            expression: dominantExpression,
            expressionProbability,
          });
        } else {
          setDetectionStatus("No face detected in frame.");
          setFaceData(null); // Clear data if face leaves frame
        }
      }
    }, 500);

    setIntervalId(id);
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
      <h2>AI Face Analyzer</h2>

      {/* Main Status Bar */}
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

      {/* NEW: Data Dashboard (Only shows when a face is detected) */}
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

      {/* Video Container - Now Mobile Responsive! */}
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: "640px",
          aspectRatio: "4/3",
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
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    </div>
  );
};

export default FaceDetector;
