import { NextRequest, NextResponse } from "next/server";
import { uploadImage } from "@/lib/storage";
import { isReceipt } from "@/lib/gemini";
import { appendImageToNotion } from "@/lib/notion";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return NextResponse.json(
        { ok: false, message: "no file" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const imageUrl = await uploadImage(buffer);

    const ok = await isReceipt(imageUrl);
    if (!ok) {
      return NextResponse.json({
        ok: false,
        message: "レシートと判定できませんでした",
        imageUrl,
      });
    }

    await appendImageToNotion(imageUrl);
    return NextResponse.json({ ok: true, imageUrl });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
