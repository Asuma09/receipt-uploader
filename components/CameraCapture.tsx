"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    cv: any;
  }
}

export default function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("起動中…");
  const [started, setStarted] = useState(false);
  const stableFramesRef = useRef(0);
  const cooldownRef = useRef(false);
  const cvReadyRef = useRef(false);

  useEffect(() => {
    if (document.getElementById("opencv-script")) {
      cvReadyRef.current = true;
      return;
    }
    const script = document.createElement("script");
    script.id = "opencv-script";
    script.src = "https://docs.opencv.org/4.x/opencv.js";
    script.async = true;
    script.onload = () => {
      const cv = window.cv;
      if (cv && typeof cv.then === "function") {
        cv.then(() => {
          cvReadyRef.current = true;
        });
      } else {
        window.cv["onRuntimeInitialized"] = () => {
          cvReadyRef.current = true;
        };
      }
    };
    document.body.appendChild(script);
  }, []);

  async function handleStart() {
    setStarted(true);
    setStatus("カメラ起動中…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("レシートをカメラに向けてください");
        requestAnimationFrame(loop);
      }
    } catch (e: any) {
      setStatus(`カメラ起動失敗: ${e?.message ?? e}`);
    }
  }

  function loop() {
    detectReceipt();
    setTimeout(() => requestAnimationFrame(loop), 400);
  }

  function detectReceipt() {
    if (cooldownRef.current) return;
    if (!cvReadyRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const cv = window.cv;
    if (!video || !canvas || !cv) return;
    if (!video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    const edges = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 60, 180);

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    let detected = false;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      const area = cv.contourArea(approx);
      if (approx.rows === 4 && area > src.cols * src.rows * 0.1) {
        const rect = cv.boundingRect(approx);
        const ratio = rect.height / rect.width;
        if (ratio > 1.2 && ratio < 4.5) detected = true;
      }
      approx.delete();
      cnt.delete();
    }

    src.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();

    if (detected) {
      stableFramesRef.current += 1;
      setStatus(`検知中… ${stableFramesRef.current}/3`);
      if (stableFramesRef.current >= 3) {
        stableFramesRef.current = 0;
        capture();
      }
    } else {
      stableFramesRef.current = 0;
      setStatus("レシートをカメラに向けてください");
    }
  }

  async function capture() {
    cooldownRef.current = true;
    setStatus("撮影中…");
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          cooldownRef.current = false;
          return;
        }
        const form = new FormData();
        form.append("file", blob, "receipt.jpg");
        try {
          const res = await fetch("/api/upload", {
            method: "POST",
            body: form,
          });
          const json = await res.json();
          setStatus(
            json.ok ? "✅ Notion に投稿しました" : `⚠ ${json.message}`
          );
        } catch (e: any) {
          setStatus(`⚠ 送信エラー: ${e?.message ?? e}`);
        } finally {
          setTimeout(() => {
            cooldownRef.current = false;
          }, 3000);
        }
      },
      "image/jpeg",
      0.85
    );
  }

  return (
    <div className="relative w-full">
      {!started && (
        <button
          onClick={handleStart}
          className="absolute inset-0 z-10 m-auto h-16 w-56 rounded-full bg-white text-black font-bold shadow-lg"
          style={{ top: "50%", transform: "translateY(-50%)" }}
        >
          カメラを開始
        </button>
      )}
      <video
        ref={videoRef}
        playsInline
        muted
        className="w-full bg-black"
      />
      <canvas ref={canvasRef} className="hidden" />
      <p className="absolute bottom-4 left-4 bg-black/70 text-white px-3 py-1 rounded">
        {status}
      </p>
    </div>
  );
}
