const { execSync } = require("child_process");
const { execSync: exec } = require("child_process");

async function embedAllPages() {
    console.log("🧠 Embedding all wiki pages into Vectorize...");

    // Get all keys
    const result = execSync(
        'npx wrangler kv key list --binding=WIKI --remote',
        { cwd: __dirname }
    ).toString();

    const keys = JSON.parse(result).map((k) => k.name);
    console.log(`Found ${keys.length} pages`);

    for (const key of keys) {
        // Get content
        const content = execSync(
            `npx wrangler kv key get --binding=WIKI "${key}" --remote`,
            { cwd: __dirname }
        ).toString();

        // Generate embedding via AI binding
        const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ text: [content.slice(0, 1000)] }),
            }
        );

        const data = await res.json();
        const vector = data.result.data[0];

        // Upsert into Vectorize
        execSync(
            `npx wrangler vectorize insert wiki-index --values='${JSON.stringify([{ id: key, values: vector, metadata: { key } }])}'`,
            { cwd: __dirname }
        );

        console.log(`✅ Embedded: ${key}`);
    }

    console.log("Done!");
}

embedAllPages().catch(console.error);