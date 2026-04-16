import React, { useRef, useEffect, useState } from "react";
import * as faceapi from "face-api.js";

const FaceDetector: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // States to track our app's progress
  const [isModelLoaded, setIsModelLoaded] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [detectionResult, setDetectionResult] = useState<string>(
    "Loading AI Models...",
  );
  const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);

  // 1. Load the models when the component mounts (but DON'T start the camera yet)
  useEffect(() => {
    const loadModels = async () => {
      try {
        const MODEL_URL = "/models";
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
          faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
        ]);

        setIsModelLoaded(true);
        setDetectionResult("Models loaded. Ready to start camera.");
      } catch (error) {
        console.error("Error loading models:", error);
        setDetectionResult("Error loading models. Check public/models folder.");
      }
    };

    loadModels();

    // Cleanup function when leaving the page
    return () => {
      stopWebcam();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper function to stop the webcam completely
  const stopWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const tracks = stream.getTracks();
      tracks.forEach((track) => track.stop());
    }
    if (intervalId) clearInterval(intervalId);
    setIsCameraActive(false);
  };

  // 2. Start the webcam ONLY when the user clicks the button
  // 2. Start the webcam ONLY when the user clicks the button
  const startWebcam = async () => {
    setCameraError("");

    // SAFETY CHECK: Does the browser allow camera access here?
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
        setDetectionResult("Camera authorized. Scanning...");
      }
    } catch (error: any) {
      console.error("Error accessing webcam:", error);
      setIsCameraActive(false);
      setCameraError(`Camera error: ${error.message || error.name}`);
    }
  };

  // 3. Handle video play and start detecting
  const handleVideoOnPlay = () => {
    if (intervalId) clearInterval(intervalId); // clear any existing intervals

    // Run detection every 500ms
    const id = setInterval(async () => {
      if (videoRef.current && isModelLoaded) {
        const detection = await faceapi
          .detectSingleFace(
            videoRef.current,
            new faceapi.TinyFaceDetectorOptions(),
          )
          .withAgeAndGender();

        if (detection) {
          const gender = detection.gender;
          const probability = Math.round(detection.genderProbability * 100);

          if (gender === "male") {
            setDetectionResult(`Man Detected (${probability}% confidence)`);
          } else {
            setDetectionResult(`Woman Detected (${probability}% confidence)`);
          }
        } else {
          setDetectionResult("No face detected in frame.");
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
        marginTop: "50px",
        fontFamily: "sans-serif",
      }}
    >
      <h2>Face & Gender Recognition</h2>

      <div
        style={{
          marginBottom: "20px",
          padding: "15px",
          backgroundColor: "#f0f0f0",
          borderRadius: "8px",
          minWidth: "300px",
          textAlign: "center",
        }}
      >
        <h3>Status: {detectionResult}</h3>
        {cameraError && (
          <p style={{ color: "red", fontWeight: "bold", maxWidth: "400px" }}>
            {cameraError}
          </p>
        )}
      </div>

      {/* Show the button if models are loaded BUT camera is not active yet */}
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

      {/* Show the video wrapper only when the camera is active */}
      <div
        style={{
          position: "relative",
          width: "640px",
          height: "480px",
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
