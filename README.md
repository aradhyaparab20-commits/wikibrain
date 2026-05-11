# 🧠 WikiBrain

**Your personal AI that knows what YOU know.**

Most people forget 90% of what they learn within a week. Notes get buried. Lectures fade. That YouTube video you watched last month? Gone.

WikiBrain fixes this. Write notes anywhere → they sync to the cloud → Claude reads them instantly. Ask Claude anything about your own knowledge base — it answers from YOUR notes, not the generic internet.

---

## The idea

I came across a guide in the 100xEngineers community — inspired by Andrej Karpathy's idea of maintaining a personal wiki that an LLM can read and reason over.

The concept was simple: what if Claude had permanent memory of everything you've ever learned?

I built it. Then kept going.

---

## What it actually does

You write a note in Obsidian. Two seconds later Claude knows about it.

Ask Claude:
- *"Quiz me on binary search"* → it reads YOUR notes, not Wikipedia
- *"What did I study this week?"* → it checks your daily logs
- *"What are my weakest DSA topics?"* → it analyses your problem logs
- *"I have an interview tomorrow — summarise everything I know about graphs"* → it pulls from your entire knowledge base

The more you feed it, the smarter it gets about **you**.

---

## Live demo

| | |
|---|---|
| 🌐 Web UI | [my-wiki-mcp.aradhyaparab21.workers.dev](https://my-wiki-mcp.aradhyaparab21.workers.dev) |

> These are my personal instances. You deploy your own — takes ~30 minutes.

---

## Features

| | |
|---|---|
| ⚡ Auto-sync | Save a note in Obsidian → syncs to cloud in 2 seconds |
| 🔍 Semantic search | Finds relevant notes even when exact words don't match |
| 🌐 Web UI | Browse your entire wiki from any device, any browser |
| 🕸️ Graph view | See how all your notes connect as a visual network |
| 🔌 Chrome extension | One click clips any webpage into your wiki |
| 🤖 Auto page creation | Paste a YouTube URL → Claude creates a structured wiki page |
| 📧 Weekly brain report | Every Monday: what you learned, your gaps, revision plan |
| 🖥️ Claude Desktop | Works free — no Pro plan needed |
| 🛠️ 6 MCP tools | get, search, save, delete, create from URL, list all |

---

## How it works

```
You write a note in Obsidian
         ↓
watch.js detects the save (runs in background always)
         ↓
Cloudflare KV stores the note in the cloud
         ↓
Cloudflare Vectorize indexes it for semantic search
         ↓
MCP server exposes it as tools Claude can call
         ↓
Claude reads your notes and answers your questions
```

No database to manage. No server to maintain. Cloudflare handles everything.

---

## Stack

| Tool | Role |
|---|---|
| Obsidian | Note writing |
| Cloudflare Workers | MCP server + Web UI |
| Cloudflare KV | Note storage |
| Cloudflare Vectorize | Semantic search |
| Cloudflare AI | Embeddings + LLM |
| Node.js + chokidar | Auto-sync file watcher |
| PM2 | Keeps watcher running in background |
| Chrome Extension | Web clipper |
| D3.js | Graph visualisation |
| Resend | Weekly email report |

---

## Prerequisites

- [ ] Node.js v18+ — check with `node --version`
- [ ] [Cloudflare account](https://cloudflare.com) — free tier works
- [ ] [Obsidian](https://obsidian.md) — for writing notes
- [ ] [Claude Desktop](https://claude.ai/download) — free, no Pro plan needed

---

## Setup — step by step

### 1. Install Wrangler and login to Cloudflare

```bash
npm install -g wrangler
wrangler login
```

Browser opens → click Allow → you're in.

---

### 2. Clone the repo

```bash
git clone https://github.com/aradhyaparab20-commits/wikibrain.git
cd wikibrain
npm install
```

---

### 3. Create your folder structure

```bash
mkdir -p wiki/concepts wiki/sources wiki/entities wiki/synthesis wiki/dsa
mkdir -p raw/daily raw/clippings
```

What each folder is for:

```
wiki/
  concepts/    ← algorithms, ideas, techniques
  sources/     ← lectures, videos, articles
  entities/    ← people, tools, frameworks
  synthesis/   ← cross-topic connections and patterns
  dsa/         ← LeetCode / Codeforces problem logs
raw/
  daily/       ← daily learning logs (YYYY-MM-DD.md)
  clippings/   ← raw web clips before processing
```

---

### 4. Open as Obsidian vault

1. Open Obsidian
2. Click **Open folder as vault** — not "Create new vault"
3. Select your `wikibrain/` folder
4. Trust the vault when prompted

> ⚠️ Use "Open folder as vault" — not "Create new vault". Wrong choice breaks the sync paths.

---

### 5. Create your Cloudflare Worker

```bash
npm create cloudflare@latest -- my-wiki-mcp \
  --template=cloudflare/ai/demos/remote-mcp-authless
cd my-wiki-mcp
npm install
```

When prompted:
- Add AGENTS.md? → **No**
- Use git? → **Yes**
- Deploy now? → **No**

---

### 6. Create KV namespace

```bash
npx wrangler kv namespace create WIKI_DATA
```

Copy the `id` from the output — you need it in the next step.

---

### 7. Configure wrangler.jsonc

Open `my-wiki-mcp/wrangler.jsonc` and add:

```json
"kv_namespaces": [
  {
    "binding": "WIKI",
    "id": "your-id-from-step-6"
  }
],
"vectorize": [
  { "binding": "VECTORIZE", "index_name": "wiki-index" }
],
"ai": { "binding": "AI" }
```

---

### 8. Create Vectorize index

```bash
npx wrangler vectorize create wiki-index --dimensions=768 --metric=cosine
```

---

### 9. Activate your workers.dev subdomain

Go to this URL in your browser:

```
https://dash.cloudflare.com/?to=/:account/workers
```

Opening this page creates your `yourname.workers.dev` subdomain. One-time step.

---

### 10. Deploy

```bash
cd my-wiki-mcp
npx wrangler deploy
```

You'll get a live URL:

```
https://my-wiki-mcp.YOUR-NAME.workers.dev
```

Your MCP endpoint:
```
https://my-wiki-mcp.YOUR-NAME.workers.dev/mcp
```

---

### 11. Choose your sync style

Pick **one** of these 3 options based on how you work. All of them do the same thing — push your notes to Cloudflare KV. The difference is when and how.

---

#### Option A — Manual sync (simplest)

Best for: people who write notes in batches and don't mind one extra command.

Run this in terminal whenever you finish a writing session:

```bash
node ~/Desktop/Wiki/sync.js
```

That's it. You can run this from **any terminal window** — no need to open your project folder first. Just run it and close terminal.

✅ Simple — one command  
✅ No background processes  
✅ No RAM usage when not writing  
⚠️ You have to remember to run it  

---

#### Option B — Session watcher (recommended for most people)

Best for: people who want auto-sync during a writing session but don't want something running 24/7.

When you sit down to write notes, open terminal and run:

```bash
node ~/Desktop/Wiki/watch.js
```

It watches your wiki folder and syncs every time you save a file. When you're done writing, close the terminal — it stops.

✅ Auto-syncs while you write  
✅ Nothing running in background when you don't need it  
✅ Simple to start and stop  
⚠️ You need to start it each writing session  

---

#### Option C — Always-on background sync (power users)

Best for: people who write notes constantly throughout the day across multiple sessions and never want to think about syncing.

```bash
npm install chokidar
npm install -g pm2
pm2 start watch.js --name "wikibrain"
pm2 startup
```

Run the command that `pm2 startup` prints. Then:

```bash
pm2 save
```

WikiBrain now runs silently in the background forever — even after Mac restarts. Write in Obsidian → syncs in 2 seconds, always.

✅ Fully automatic — zero effort  
✅ Survives Mac restarts  
✅ Works while you're in VS Code or any other app  
⚠️ Uses ~50MB RAM always  
⚠️ Needs internet to sync (notes are safe locally if offline)  
⚠️ If something breaks, it fails silently — check with `pm2 logs wikibrain`  

---

### 13. Connect to Claude Desktop (free)

```bash
npm install -g mcp-remote
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Paste this (replace with your Worker URL):

```json
{
  "mcpServers": {
    "wikibrain": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://my-wiki-mcp.YOUR-NAME.workers.dev/mcp"
      ]
    }
  }
}
```

Save with `Ctrl+O`, exit with `Ctrl+X`.

Fully quit Claude Desktop (`Cmd+Q`) → reopen → wait 15 seconds → ask:

```
Search my wiki for binary search
```

Claude reads your own notes and answers from them. That's the moment it clicks. 🎉

---

### 14. Connect to Claude.ai

Go to [claude.ai/settings/connectors](https://claude.ai/settings/connectors) → Add custom connector → paste your MCP URL → set permissions to **Always allowed**.

---

### 15. Install Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked** → select `wikibrain-extension/` folder

Click the WikiBrain icon on any webpage to clip it to your wiki in one click.

---

### 16. Weekly Brain Report (optional)

Sign up at [resend.com](https://resend.com) (free). Store your key:

```bash
cd my-wiki-mcp
npx wrangler secret put RESEND_API_KEY
```

Add to `wrangler.jsonc`:

```json
"triggers": {
  "crons": ["0 9 * * 1"]
}
```

Redeploy:
```bash
npx wrangler deploy
```

Every Monday at 9am — an email with what you learned, your knowledge gaps, and a revision plan generated from your own notes.

---

## Daily workflow

| When | What |
|---|---|
| Morning | *"Quiz me on binary search before class"* |
| During lecture | Write raw notes in Obsidian → auto-syncs |
| After lecture | *"Read my notes on X and fill in what I missed"* |
| LeetCode | Write problem log → *"What pattern did I use most this week?"* |
| Night | *"Quiz me on everything I learned today"* |
| Monday | Receive weekly brain report automatically |

### Useful prompts

```
Search my wiki for binary search
Get my wiki page on Dijkstra and quiz me on it
What LeetCode problems have I solved using dynamic programming?
Run a health check — what topics need more depth?
I have an interview tomorrow — summarise all my DSA notes
Read my notes on X and suggest 3 things I should add
```

---

## MCP tools

| Tool | What it does |
|---|---|
| `get_index` | List all wiki pages |
| `get_page` | Fetch a page by key |
| `search_wiki` | Semantic search across all pages |
| `save_page` | Write content directly to your wiki |
| `delete_page` | Remove a page |
| `create_page_from_url` | YouTube/article → structured wiki page |

---

## Troubleshooting

**"No KV Namespaces configured" when running sync.js**
→ `wrangler.jsonc` inside `my-wiki-mcp/` is missing the `kv_namespaces` block. Add it with your namespace ID.

**Deploy fails with "workers.dev subdomain required"**
→ Go to Cloudflare dashboard → Compute → Workers & Pages. Opening this page activates your subdomain automatically.

**Claude Desktop shows "Failed to fetch"**
→ Wait 15 seconds after opening Claude Desktop before asking. mcp-remote needs warm-up time on cold start.

**Graph shows isolated nodes with no connections**
→ Add `[[wikilinks]]` between your pages. Each link becomes an edge in the graph.

---

## What's next

- [ ] Voice notes → transcribe → auto-sync
- [ ] PDF ingestion → structured wiki pages
- [ ] Team wiki — shared knowledge base for study groups
- [ ] Spaced repetition — Claude tracks what you've reviewed
- [ ] Mobile app

---

## Credits

- **Andrej Karpathy** — original LLM wiki idea
- **100xEngineers** — the community that sparked this
- **Anthropic** — built MCP, the protocol that makes this possible
- **Cloudflare** — Workers, KV, Vectorize, AI

---

## License

MIT — use it, modify it, build on it.

---

Built by [Aradhya Parab](https://github.com/aradhyaparab20-commits) 🧠
