import CameraCapture from "@/components/CameraCapture";

export default function Page() {
  return (
    <main className="min-h-screen bg-black text-white">
      <h1 className="p-4 text-lg font-bold">レシートを向けるだけ</h1>
      <CameraCapture />
    </main>
  );
}
