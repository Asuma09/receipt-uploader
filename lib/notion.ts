import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

type ReceiptRow = {
  imageUrl: string;
  amount?: number | null;
  date?: string; // "YYYY-MM-DD"
};

// Notion データベースに「1行（＝1ページ）」を追加する。
// SDK v5 は data source モデルなので、
//   database_id → data_source_id を取得 → そのスキーマを読む → ページ作成
// の順で行う。
// プロパティ名は店ごとに自由に付けられるよう、名前ではなく「型」で検出する
// （title / number / date の最初のプロパティを使う）。
export async function addReceiptRow({ imageUrl, amount, date }: ReceiptRow) {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error(
      "NOTION_DATABASE_ID が未設定です。Notionでデータベースを作成しIDを設定してください。"
    );
  }

  // 1) データベースから data source を取得
  const db = await notion.databases.retrieve({ database_id: databaseId });
  const dataSources = "data_sources" in db ? db.data_sources : [];
  const dataSourceId = dataSources[0]?.id;
  if (!dataSourceId) {
    throw new Error("データベースに data source が見つかりませんでした。");
  }

  // 2) スキーマ（プロパティ一覧）を取得し、型からプロパティ名を特定
  const ds = await notion.dataSources.retrieve({
    data_source_id: dataSourceId,
  });

  let titleName: string | undefined;
  let amountName: string | undefined;
  let dateName: string | undefined;
  for (const [name, cfg] of Object.entries(ds.properties)) {
    if (cfg.type === "title") titleName = name;
    else if (cfg.type === "number" && !amountName) amountName = name;
    else if (cfg.type === "date" && !dateName) dateName = name;
  }

  const dateStr = date ?? new Date().toISOString().slice(0, 10);

  // 3) プロパティを組み立て
  const properties: Record<string, unknown> = {};
  if (titleName) {
    properties[titleName] = {
      title: [{ type: "text", text: { content: `レシート ${dateStr}` } }],
    };
  }
  if (amountName && amount != null && Number.isFinite(amount)) {
    properties[amountName] = { number: amount };
  }
  if (dateName) {
    properties[dateName] = { date: { start: dateStr } };
  }

  // 4) ページ（行）を作成。本文にレシート画像を埋め込む。
  await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: properties as never,
    children: [
      {
        object: "block",
        type: "image",
        image: { type: "external", external: { url: imageUrl } },
      },
    ],
  });
}
