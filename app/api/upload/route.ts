import { NextRequest, NextResponse } from "next/server";
import { uploadImage } from "@/lib/storage";
import { addReceiptRow } from "@/lib/notion";

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

    // フロント（ブラウザOCR＋手直し）から渡される金額・日付
    const amountRaw = form.get("amount");
    const dateRaw = form.get("date");
    const amount =
      typeof amountRaw === "string" && amountRaw.trim() !== ""
        ? Number(amountRaw)
        : null;
    const date =
      typeof dateRaw === "string" && dateRaw.trim() !== "" ? dateRaw : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());

    const imageUrl = await uploadImage(buffer);
    await addReceiptRow({
      imageUrl,
      amount: amount != null && Number.isFinite(amount) ? amount : null,
      date,
    });

    return NextResponse.json({ ok: true, imageUrl });
  } catch (e: unknown) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
