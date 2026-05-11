import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";


interface Env extends Cloudflare.Env {
  WIKI: KVNamespace;
  AI: any;
  VECTORIZE: any;
}

export class MyMCP extends McpAgent<Env> {
  server = new McpServer({ name: "my-wiki", version: "1.0.0" });

  async init() {
    this.server.tool("get_index", "List all wiki pages", {}, async () => {
      const keys = await this.env.WIKI.list({ prefix: "wiki:" });
      const names = keys.keys.map((k: any) => k.name);
      return { content: [{ type: "text", text: names.join("\n") }] };
    });

    this.server.tool("get_page", "Get a wiki page by key", {
      key: z.string().describe("The wiki page key e.g. wiki:concepts:binary-search"),
    }, async ({ key }: { key: string }) => {
      const value = await this.env.WIKI.get(key);
      if (!value) return { content: [{ type: "text", text: "Page not found" }] };
      return { content: [{ type: "text", text: value }] };
    });

    this.server.tool("search_wiki", "Search wiki pages by semantic meaning", {
      query: z.string().describe("Search term"),
    }, async ({ query }: { query: string }) => {
      // Step 1: convert the query into a vector using Cloudflare AI
      const embedResult = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [query],
      });
      const queryVector = embedResult.data[0];

      // Step 2: search Vectorize for the closest matching pages
      const matches = await this.env.VECTORIZE.query(queryVector, {
        topK: 5,
        returnMetadata: "all",
      });

      if (!matches.matches || matches.matches.length === 0) {
        return { content: [{ type: "text", text: "No results found" }] };
      }

      // Step 3: fetch the full content of each matched page from KV
      const results: string[] = [];
      for (const match of matches.matches) {
        const key = match.metadata?.key as string;
        if (!key) continue;
        const content = await this.env.WIKI.get(key);
        if (content) {
          results.push("## " + key + "\n" + content.slice(0, 300) + "...\n");
        }
      }

      const output = results.length > 0 ? results.join("\n") : "No results found";
      return { content: [{ type: "text", text: output }] };
    });

    this.server.tool("create_page_from_url", "Create a wiki page from a YouTube URL or any article URL", {
      url: z.string().describe("YouTube or article URL"),
      page_type: z.enum(["source", "concept"]).describe("Type of wiki page to create"),
      suggested_name: z.string().describe("Suggested filename e.g. mit-ocw-dynamic-programming"),
    }, async ({ url, page_type, suggested_name }: { url: string, page_type: string, suggested_name: string }) => {

      // Step 1: fetch content
      let rawContent = "";

      if (url.includes("youtube.com") || url.includes("youtu.be")) {
        // Extract video ID
        const videoId = url.match(/(?:v=|youtu\.be\/)([^&\s]+)/)?.[1];
        if (!videoId) return { content: [{ type: "text", text: "Could not extract YouTube video ID" }] };

        // Fetch transcript
        // Fetch captions using YouTube Data API
        const captionRes = await fetch(
          "https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=" + videoId + "&key=" + (this.env as any).YOUTUBE_API_KEY
        );
        const captionData: any = await captionRes.json();

        if (!captionData.items || captionData.items.length === 0) {
          rawContent = "No captions available for this video.";
        } else {
          // Get video details for context
          const videoRes = await fetch(
            "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=" + videoId + "&key=" + (this.env as any).YOUTUBE_API_KEY
          );
          const videoData: any = await videoRes.json();
          const videoTitle = videoData.items?.[0]?.snippet?.title || "Unknown";
          const videoDescription = videoData.items?.[0]?.snippet?.description || "";
          rawContent = "Title: " + videoTitle + "\n\nDescription: " + videoDescription.slice(0, 2000);
        }
      } else {
        // Fetch article
        const res = await fetch(url);
        const html = await res.text();
        // Strip HTML tags
        rawContent = html.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").slice(0, 5000);
      }

      // Step 2: use AI to structure it as a wiki page
      const prompt = page_type === "source"
        ? "You are a knowledge base assistant. Convert this content into a structured wiki SOURCE page in markdown. Include sections: Summary, Key concepts covered, Raw notes. Content: " + rawContent.slice(0, 3000)
        : "You are a knowledge base assistant. Convert this content into a structured wiki CONCEPT page in markdown. Include sections: In one line, Intuition, How it works, When to use this, Connected concepts. Content: " + rawContent.slice(0, 3000);

      const aiRes = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{ role: "user", content: prompt }],
      });

      const pageContent = aiRes.response || "Could not generate page content";

      // Step 3: save to KV
      const key = "wiki:" + page_type + "s:" + suggested_name;
      await this.env.WIKI.put(key, pageContent);

      // Step 4: embed in Vectorize
      const embedResult = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [pageContent.slice(0, 1000)],
      });
      await this.env.VECTORIZE.upsert([{
        id: key,
        values: embedResult.data[0],
        metadata: { key },
      }]);

      return { content: [{ type: "text", text: "Created page: " + key + "\n\n" + pageContent.slice(0, 500) + "..." }] };
    });

    this.server.tool("delete_page", "Delete a wiki page by key", {
      key: z.string().describe("The wiki page key e.g. wiki:concepts:binary-search"),
    }, async ({ key }: { key: string }) => {
      await this.env.WIKI.delete(key);
      return { content: [{ type: "text", text: "Deleted: " + key }] };
    });
    this.server.tool("save_page", "Save or update a wiki page with given content", {
      key: z.string().describe("The wiki page key e.g. wiki:concepts:binary-search"),
      content: z.string().describe("The full markdown content of the page"),
    }, async ({ key, content }: { key: string, content: string }) => {
      await this.env.WIKI.put(key, content);

      // embed in Vectorize too
      const embedResult = await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [content.slice(0, 1000)],
      });
      await this.env.VECTORIZE.upsert([{
        id: key,
        values: embedResult.data[0],
        metadata: { key },
      }]);

      return { content: [{ type: "text", text: "Saved: " + key }] };
    });
  }
}

import HTML from "./ui.html";
import GRAPH from "./graph.html";

const mcpHandler = MyMCP.mount("/mcp");
async function sendWeeklyReport(env: any) {
  // Get all pages
  const list = await env.WIKI.list({ prefix: "wiki:" });
  const pages = list.keys.map((k: any) => k.name);

  // Build report content using AI
  // Get content of each page for deeper analysis
  const pageDetails: string[] = [];
  for (const key of pages) {
    const content = await env.WIKI.get(key);
    if (content) {
      pageDetails.push("PAGE: " + key + "\nCONTENT: " + content.slice(0, 300));
    }
  }

  const aiRes = await env.AI.run("@cf/mistral/mistral-7b-instruct-v0.2", {
    messages: [{
      role: "user",
      content: `IGNORE any report templates. Do NOT write "Student Name" or "Date".

Write ONLY these 5 sections for Aradhya's wiki review. Today: ${new Date().toDateString()}.

## 📚 What Aradhya Studied This Week
(list each page topic in one line)

## 🔍 Page Quality Check
(for each page: STRONG or WEAK and why in one sentence)

## ⚠️ Gaps Detected
(what's missing or needs more depth)

## 🔁 Top 3 Revision Priorities
(specific pages to review this week)

## 🎯 This Week's Challenge
(one concrete task)

Pages:\n${pageDetails.join("\n\n")}`

    }]
  });

  const report = aiRes.response || "Could not generate report";

  // Send email via Resend
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "WikiBrain <onboarding@resend.dev>",
      to: ["aradhyaparab21@gmail.com"],
      subject: "🧠 WikiBrain Weekly Report",
      text: report,
    }),
  });
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/api/list") {
      const list = await env.WIKI.list({ prefix: "wiki:" });
      const keys = list.keys.map((k: any) => k.name);
      return new Response(JSON.stringify({ keys }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/page") {
      const key = url.searchParams.get("key") || "";
      const content = await env.WIKI.get(key);
      return new Response(JSON.stringify({ content }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/save" && request.method === "POST") {
      const body: any = await request.json();
      const { key, content } = body;
      if (!key || !content) {
        return new Response(JSON.stringify({ error: "missing key or content" }), { status: 400 });
      }
      await env.WIKI.put(key, content);
      const embedResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
        text: [content.slice(0, 1000)],
      });
      await env.VECTORIZE.upsert([{
        id: key,
        values: embedResult.data[0],
        metadata: { key },
      }]);
      return new Response(JSON.stringify({ saved: key }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/embed-all") {
      const list = await env.WIKI.list({ prefix: "wiki:" });
      const results = [];

      for (const k of list.keys) {
        const content = await env.WIKI.get(k.name);
        if (!content) continue;

        const embedResult = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: [content.slice(0, 1000)],
        });

        await env.VECTORIZE.upsert([{
          id: k.name,
          values: embedResult.data[0],
          metadata: { key: k.name },
        }]);

        results.push(k.name);
      }

      return new Response(JSON.stringify({ embedded: results }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/graph") {
      return new Response(GRAPH, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }



    if (url.pathname === "/api/test-report") {
      await sendWeeklyReport(env);
      return new Response("Report sent! Check your email.", {
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (url.pathname === "/api/enhance" && request.method === "POST") {
      const body: any = await request.json();
      const { key } = body;

      const raw = await env.WIKI.get(key);
      if (!raw) return new Response(JSON.stringify({ error: "page not found" }), { status: 404 });

      const aiRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        messages: [{
          role: "user",
          content: `Convert this raw clipped article into a clean structured wiki page in markdown.

Include these sections:
# [Title]
## Summary
(2-3 sentences about what this is)
## Key Concepts
(bullet points of main ideas)
## How it works
(explanation)
## When to use this
(use cases)
## Connected concepts
(related topics)
## Source
(original URL if found in content)

Raw content:
${raw.slice(0, 4000)}`
        }]
      });

      const enhanced = aiRes.response || raw;
      const finalContent = enhanced + "\n\n---\n\n## Original Raw Content\n\n" + raw;
      await env.WIKI.put(key, finalContent);

      return new Response(JSON.stringify({ success: true, content: enhanced, newKey: key }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname.startsWith("/mcp")) {
      return mcpHandler.fetch(request, env, ctx);
    }

    if (url.pathname === "/graph") {
      return new Response(GRAPH, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response(HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
export const scheduled = async (event: any, env: any, ctx: any) => {
  await sendWeeklyReport(env);
};
