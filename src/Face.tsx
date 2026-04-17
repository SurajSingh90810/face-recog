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
  
  // FIX 1: Guard to prevent overlapping detection cycles from freezing the browser
  const isDetecting = useRef<boolean>(false);

  const [isModelLoaded, setIsModelLoaded] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [detectionStatus, setDetectionStatus] = useState<string>(
    "Loading AI Models..."
  );
  const [faceData, setFaceData] = useState<FaceData | null>(null);
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
          // FIX 2: Use the Tiny Landmark Net you have in your folder for much better FPS
          faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL), 
        ]);

        setIsModelLoaded(true);
        setDetectionStatus("Models loaded. Ready to start camera.");
      } catch (error) {
        console.error("Error loading models:", error);
        setDetectionStatus(
          "Error loading models. Check your public/models folder."
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

    // Clear the canvas drawing when stopping
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  // 2. Start Webcam
  const startWebcam = async () => {
    setCameraError("");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        "Camera API is blocked. You MUST open this link using HTTPS."
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

  // 3. Detect and DRAW
  const handleVideoOnPlay = () => {
    if (intervalId) clearInterval(intervalId);

    const id = setInterval(async () => {
      // FIX 3: Ensure video is ready (readyState === 4) and prevent overlapping runs
      if (
        isDetecting.current || 
        !videoRef.current || 
        videoRef.current.readyState !== 4 || 
        !canvasRef.current || 
        !isModelLoaded
      ) {
        return; 
      }

      isDetecting.current = true; // Lock

      try {
        // FIX 4: Lower the score threshold slightly so it catches faces easier
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 });

        // Run full detection
        const detection = await faceapi
          .detectSingleFace(videoRef.current, options)
          .withFaceLandmarks(true) // 'true' tells it to use the TinyLandmarkNet
          .withAgeAndGender()
          .withFaceExpressions();

        if (detection) {
          setDetectionStatus("Face Tracked!");

          // --- DRAWING LOGIC ---
          const displaySize = {
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight,
          };
          faceapi.matchDimensions(canvasRef.current, displaySize);

          const resizedDetection = faceapi.resizeResults(detection, displaySize);

          canvasRef.current
            .getContext("2d")
            ?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

          faceapi.draw.drawDetections(canvasRef.current, resizedDetection);
          faceapi.draw.drawFaceLandmarks(canvasRef.current, resizedDetection);

          // Extract Data for Dashboard
          const gender = detection.gender === "male" ? "Man" : "Woman";
          const genderProbability = Math.round(detection.genderProbability * 100);
          const age = Math.round(detection.age);

          const expressions = detection.expressions;
          const sortedExpressions = Object.entries(expressions).sort(
            (a, b) => b[1] - a[1]
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
        } else {
          setDetectionStatus("No face detected in frame. Bring face closer.");
          // FIX 5: We intentionally DON'T clear the UI / Canvas immediately here.
          // This prevents the UI cards from violently flickering if it misses a single frame.
        }
      } catch (err) {
        console.error("Detection processing error:", err);
      } finally {
        isDetecting.current = false; // Release Lock
      }
    }, 150); // Changed to 150ms for better stability

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
      <h2>AI Face Analyzer Pro</h2>

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