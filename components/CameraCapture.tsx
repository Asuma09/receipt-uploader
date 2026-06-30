"use client";

import { useEffect, useRef, useState } from "react";
import { parseTotalAmount } from "@/lib/parseAmount";

declare global {
  interface Window {
    cv: any;
  }
}

type Mode = "camera" | "review" | "done";

function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

// 4点を tl, tr, br, bl の順に並べ替える。
// s = x+y が最小→左上, 最大→右下 ; d = x-y が最大→右上, 最小→左下
function orderQuad(pts: number[][]): number[][] {
  let tl = pts[0];
  let br = pts[0];
  let tr = pts[0];
  let bl = pts[0];
  let minS = Infinity;
  let maxS = -Infinity;
  let maxD = -Infinity;
  let minD = Infinity;
  for (const p of pts) {
    const s = p[0] + p[1];
    const d = p[0] - p[1];
    if (s < minS) {
      minS = s;
      tl = p;
    }
    if (s > maxS) {
      maxS = s;
      br = p;
    }
    if (d > maxD) {
      maxD = d;
      tr = p;
    }
    if (d < minD) {
      minD = d;
      bl = p;
    }
  }
  return [tl, tr, br, bl];
}

// グレースケール画像 gray からレシートの4隅を検出し、真上から見た長方形に
// 射影変換して dst に書き込む。成功したら true。縦長の大きな四角形のみ対象。
function warpReceipt(cv: any, gray: any, dst: any): boolean {
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let srcTri: any = null;
  let dstTri: any = null;
  let M: any = null;
  try {
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    cv.Canny(blur, edges, 60, 180);
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    const frameArea = gray.cols * gray.rows;
    let best: { pts: number[][]; area: number } | null = null;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      if (approx.rows === 4) {
        const area = cv.contourArea(approx);
        if (area > frameArea * 0.2 && (!best || area > best.area)) {
          const pts: number[][] = [];
          for (let r = 0; r < 4; r++) {
            pts.push([approx.data32S[r * 2], approx.data32S[r * 2 + 1]]);
          }
          best = { pts, area };
        }
      }
      approx.delete();
      cnt.delete();
    }

    if (!best) return false;

    const [tl, tr, br, bl] = orderQuad(best.pts);
    const W = Math.max(
      Math.hypot(br[0] - bl[0], br[1] - bl[1]),
      Math.hypot(tr[0] - tl[0], tr[1] - tl[1])
    );
    const H = Math.max(
      Math.hypot(tr[0] - br[0], tr[1] - br[1]),
      Math.hypot(tl[0] - bl[0], tl[1] - bl[1])
    );
    if (W < 50 || H < 50) return false;
    if (H < W * 0.9) return false; // レシートは縦長。横長なら誤検出とみなす

    srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1],
    ]);
    dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
    M = cv.getPerspectiveTransform(srcTri, dstTri);
    cv.warpPerspective(
      gray,
      dst,
      M,
      new cv.Size(Math.round(W), Math.round(H)),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255)
    );
    return true;
  } catch {
    return false;
  } finally {
    blur.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
    if (srcTri) srcTri.delete();
    if (dstTri) dstTri.delete();
    if (M) M.delete();
  }
}

export default function CameraCapture() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("起動中…");
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<Mode>("camera");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayStr());
  const [ocrRunning, setOcrRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocrText, setOcrText] = useState("");

  const stableFramesRef = useRef(0);
  const capturingRef = useRef(false);
  const cvReadyRef = useRef(false);
  const modeRef = useRef<Mode>("camera");
  const capturedBlobRef = useRef<Blob | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // mode を ref にも反映（検知ループから参照するため）
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // OpenCV を読み込み（レシートの自動検知に使用）
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

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function handleStart() {
    setStarted(true);
    setStatus("カメラ起動中…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("レシートを画面いっぱいに写してください");
        requestAnimationFrame(loop);
      }
    } catch (e: any) {
      setStatus(`カメラ起動失敗: ${e?.message ?? e}`);
    }
  }

  function loop() {
    if (modeRef.current === "camera") detectReceipt();
    setTimeout(() => requestAnimationFrame(loop), 400);
  }

  function detectReceipt() {
    if (capturingRef.current) return;
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
      setStatus("レシートを画面いっぱいに写してください");
    }
  }

  function capture() {
    if (capturingRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    capturingRef.current = true;
    setMode("review");
    modeRef.current = "review";
    setStatus("撮影中…");

    // 押した瞬間の最新フレームをキャンバスへ描画
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      capturingRef.current = false;
      return;
    }
    ctx.drawImage(video, 0, 0);

    // 保存用：カラー原本
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          capturingRef.current = false;
          setMode("camera");
          modeRef.current = "camera";
          return;
        }
        capturedBlobRef.current = blob;
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);

        // OCR用：前処理（白黒・拡大）した別画像を渡す
        const ocrBlob = await makeOcrBlob();
        await runOcr(ocrBlob ?? blob);
        capturingRef.current = false;
      },
      "image/jpeg",
      0.9
    );
  }

  // OCRの精度を上げるための前処理。
  // 1) グレースケール 2) レシートの4隅を検出して傾き・歪みを補正
  // 3) 拡大 4) CLAHEでコントラスト強調 5) ノイズ除去→Otsu二値化。
  // OpenCV が未準備ならカラー原本をそのまま返す。
  function makeOcrBlob(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      const cv = window.cv;
      if (!canvas) return resolve(null);
      if (!cv || !cvReadyRef.current) {
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95);
        return;
      }

      const mats: any[] = [];
      const track = <T,>(m: T): T => {
        mats.push(m);
        return m;
      };
      const cleanup = () =>
        mats.forEach((m) => {
          try {
            m.delete();
          } catch {}
        });

      try {
        const src = track(cv.imread(canvas));
        const gray = track(new cv.Mat());
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // 傾き・歪み補正（4隅が取れたときだけ）
        const warped = track(new cv.Mat());
        const dewarped = warpReceipt(cv, gray, warped);
        const base = dewarped ? warped : gray;

        // 幅 ~1600px を目安に拡大
        const targetW = 1600;
        const factor =
          base.cols > 0 && base.cols < targetW ? targetW / base.cols : 1;
        const sized = track(new cv.Mat());
        if (factor !== 1) {
          cv.resize(
            base,
            sized,
            new cv.Size(
              Math.round(base.cols * factor),
              Math.round(base.rows * factor)
            ),
            0,
            0,
            cv.INTER_CUBIC
          );
        } else {
          base.copyTo(sized);
        }

        // CLAHE でコントラスト強調（かすれ文字対策）。無ければスキップ。
        const eq = track(new cv.Mat());
        let enhanced = sized;
        try {
          const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
          clahe.apply(sized, eq);
          clahe.delete();
          enhanced = eq;
        } catch {
          enhanced = sized;
        }

        // ノイズ低減 → Otsu二値化
        const den = track(new cv.Mat());
        cv.medianBlur(enhanced, den, 3);
        const bin = track(new cv.Mat());
        cv.threshold(
          den,
          bin,
          0,
          255,
          cv.THRESH_BINARY + cv.THRESH_OTSU
        );

        const out = document.createElement("canvas");
        cv.imshow(out, bin);
        cleanup();
        out.toBlob((b) => resolve(b), "image/png");
      } catch {
        cleanup();
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95);
      }
    });
  }

  async function runOcr(blob: Blob) {
    setOcrRunning(true);
    setAmount("");
    setOcrText("");
    setStatus("文字を解析中…（初回は言語データのDLで時間がかかります）");
    let worker: any = null;
    try {
      const Tesseract = (await import("tesseract.js")).default;
      worker = await Tesseract.createWorker("jpn+eng", 1, {
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            setStatus(`文字を解析中… ${Math.round((m.progress ?? 0) * 100)}%`);
          }
        },
      });
      // レシートは1列のブロック。PSM=6（単一ブロック）で誤読を減らす。
      await worker.setParameters({
        tessedit_pageseg_mode: "6",
        preserve_interword_spaces: "1",
      });
      const { data } = await worker.recognize(blob);
      const text = data?.text ?? "";
      setOcrText(text);
      const guess = parseTotalAmount(text);
      if (guess != null) {
        setAmount(String(guess));
        setStatus("金額を読み取りました。確認・修正して保存してください");
      } else {
        setStatus("金額を自動入力できませんでした。手入力してください");
      }
    } catch (e: any) {
      setStatus(`OCRエラー: ${e?.message ?? e}（金額は手入力してください）`);
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch {}
      }
      setOcrRunning(false);
    }
  }

  async function handleSave() {
    const blob = capturedBlobRef.current;
    if (!blob) return;
    setSaving(true);
    setStatus("保存中…");
    try {
      const form = new FormData();
      form.append("file", blob, "receipt.jpg");
      if (amount.trim() !== "") form.append("amount", amount.trim());
      form.append("date", date);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (json.ok) {
        setMode("done");
        setStatus("✅ Notion に保存しました");
      } else {
        setStatus(`⚠ ${json.message}`);
      }
    } catch (e: any) {
      setStatus(`⚠ 送信エラー: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
  }

  function backToCamera() {
    capturedBlobRef.current = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
    setAmount("");
    setOcrText("");
    setDate(todayStr());
    stableFramesRef.current = 0;
    setMode("camera");
    modeRef.current = "camera";
    setStatus("レシートを画面いっぱいに写してください");
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

      {/* カメラ映像（撮影モードのときだけ表示） */}
      <video
        ref={videoRef}
        playsInline
        muted
        className={`w-full bg-black ${mode === "camera" ? "" : "hidden"}`}
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* 確認・保存モード */}
      {mode !== "camera" && previewUrl && (
        <div className="bg-black text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="撮影したレシート"
            className="mx-auto block max-h-[45vh] w-full bg-black object-contain"
          />

          <div className="space-y-4 p-4 pb-10">
            <label className="block">
              <span className="text-sm text-gray-300">合計金額（円）</span>
              <input
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={ocrRunning ? "解析中…" : "金額を入力"}
                disabled={mode === "done"}
                className="mt-1 w-full rounded-lg bg-white px-3 py-3 text-2xl font-bold text-black"
              />
            </label>

            <label className="block">
              <span className="text-sm text-gray-300">日付</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={mode === "done"}
                className="mt-1 w-full rounded-lg bg-white px-3 py-3 text-black"
              />
            </label>

            <p className="text-center text-sm text-gray-300">{status}</p>

            {ocrText && (
              <details className="text-xs text-gray-400">
                <summary className="cursor-pointer">
                  読み取りテキスト（デバッグ用）
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white/10 p-2">
                  {ocrText}
                </pre>
              </details>
            )}

            {mode === "review" ? (
              <div className="flex gap-3">
                <button
                  onClick={backToCamera}
                  disabled={saving}
                  className="flex-1 rounded-lg border border-white py-4 text-lg font-bold disabled:opacity-50"
                >
                  撮り直す
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || ocrRunning}
                  className="flex-1 rounded-lg bg-blue-600 py-4 text-lg font-bold disabled:opacity-50"
                >
                  {saving ? "保存中…" : "Notionに保存"}
                </button>
              </div>
            ) : (
              <button
                onClick={backToCamera}
                className="w-full rounded-lg bg-blue-600 py-4 text-lg font-bold"
              >
                次のレシートへ
              </button>
            )}
          </div>
        </div>
      )}

      {/* カメラ画面のステータスは上部に表示（下のシャッターと重ならないように） */}
      {mode === "camera" && (
        <p className="absolute left-4 top-4 z-10 rounded bg-black/70 px-3 py-1 text-sm text-white">
          {status}
        </p>
      )}

      {/* 手動シャッター（自動検知に加えて、ピントが合った瞬間に撮れる） */}
      {started && mode === "camera" && (
        <button
          onClick={capture}
          aria-label="撮影"
          className="absolute bottom-6 left-1/2 z-10 h-16 w-16 -translate-x-1/2 rounded-full border-4 border-white bg-white/30 shadow-lg active:bg-white/70"
        />
      )}
    </div>
  );
}
