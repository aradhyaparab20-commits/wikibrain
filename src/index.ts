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
  }
}

import HTML from "./ui.html";

const mcpHandler = MyMCP.mount("/mcp");

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

    if (url.pathname.startsWith("/mcp")) {
      return mcpHandler.fetch(request, env, ctx);
    }

    return new Response(HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};