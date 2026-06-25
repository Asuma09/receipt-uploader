import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function appendImageToNotion(imageUrl: string) {
  const ts = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  await notion.blocks.children.append({
    block_id: process.env.NOTION_PAGE_ID!,
    children: [
      {
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: ts } }],
        },
      },
      {
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: { url: imageUrl },
        },
      },
    ],
  });
}
