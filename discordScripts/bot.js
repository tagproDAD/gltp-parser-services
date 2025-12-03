// bot.js
import { Client, GatewayIntentBits } from "discord.js";
import fetch from "node-fetch";
import { sanitizeReplayInput } from "./sanitizeInput.js";

// Replace with your bot token and Worker details
const DISCORD_TOKEN = "";
const CHANNELS = [""]; // allowed channel IDs
const WORKER_URL = "";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function formatTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`;
}

// Quick validation
function validateInput(input) {
  const validPrefix = "https://tagpro.koalabeast.com/";
  if (input.startsWith(validPrefix)) {
    if (input.includes("replay=")) return "replay";
    if (input.includes("uuid=")) return "uuid";
  }
  const uuidRegex = /^[0-9a-f-]{36}$/i;
  if (uuidRegex.test(input)) return "uuid";
  return "invalid";
}

// Upload helper (calls Worker /parse)
async function uploadRecord(arg, message) {
  try {
    const res = await fetch(`${WORKER_URL}/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: String(arg), origin: "discord" }),
    });

    const data = await res.json();

    if (!data.ok) {
      await message.react("❌");

      // Custom handling for map-not-found error
      if (data.error && data.error.startsWith("MAP_NOT_FOUND")) {
        await message.reply(`🗺️ Map error: ${data.error}`);
        return { status: "map_error" };
      }

      await message.reply(`❌ Parse error: ${data.error}`);
      return { status: "invalid" };
    }

    const summary = data.summary;
    if (summary.player == null || summary.time == null) {
      await message.react("❌");
      await message.reply(`❌ Run not finished: Not enough caps`);
      return { status: "error" };
    }
    if (data.upload.status === 201) {
      await message.react("✅");
      await message.reply(
        `✅ Record ${summary.uuid} uploaded!\n🕒 Time: ${summary.time}\n📍 Map: ${summary.map_name}\n👤 Player: ${summary.player}`
      );
      return { status: "inserted" };
    } else if (data.upload.status === 409) {
      await message.react("⚠️");
      await message.reply(
        `⚠️ Duplicate record ${summary.uuid}, skipped.\n🕒 Time: ${summary.time}`
      );
      return { status: "duplicate" };
    } else {
      await message.react("❌");
      await message.reply(`❌ Upload failed: ${data.upload.status}`);
      return { status: "error" };
    }
  } catch (err) {
    await message.react("❌");
    await message.reply(`❌ Failed to contact Worker: ${err.message}`);
    return { status: "error" };
  }
}

// Startup catch-up
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    for (const channelId of CHANNELS) {
      const channel = await client.channels.fetch(channelId);
      console.log(`Processing catch-up for channel: ${channel.name}`);

      const recentMessages = await channel.messages.fetch({ limit: 100 });
      let lastProcessedId = null;
      for (const msg of recentMessages.values()) {
        const reacted = msg.reactions.cache.some((r) =>
          r.users.cache.has(client.user.id)
        );
        if (reacted) {
          lastProcessedId = msg.id;
          break;
        }
      }

      const fetchOptions = { limit: 50 };
      if (lastProcessedId) {
        fetchOptions.after = lastProcessedId;
      }
      const messages = await channel.messages.fetch(fetchOptions);

      let processed = 0,
        inserted = 0,
        duplicates = 0,
        invalid = 0,
        errors = 0;

      for (const msg of messages.values()) {
        if (msg.author.bot) continue;
        if (!msg.content.startsWith("!upload")) continue;

        const arg = msg.content.replace("!upload", "").trim();
        const sanitized = sanitizeReplayInput(arg);
        if (sanitized === "invalid") {
          await msg.react("❌");
          invalid++;
          processed++;
          continue;
        }

        try {
          const result = await uploadRecord(sanitized, msg);
          if (result.status === "inserted") inserted++;
          else if (result.status === "duplicate") duplicates++;
          else if (result.status === "invalid") invalid++;
          else if (result.status === "error") errors++;
        } catch {
          await msg.react("❌");
          errors++;
        }

        processed++;
      }

      if (processed > 0) {
        await channel.send(
          `📦 **Catch-up complete!**\nProcessed: ${processed}\n✅ Inserted: ${inserted}\n⚠️ Duplicates: ${duplicates}\n❌ Invalid: ${invalid}\n❌ Errors: ${errors}`
        );
      }
    }
  } catch (err) {
    console.error("❌ Failed to fetch channel messages:", err);
  }
});

// Real-time handler
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!CHANNELS.includes(message.channel.id)) return;

  if (message.content.startsWith("!check")) {
    const arg = message.content.replace("!check", "").trim();
    const sanitized = sanitizeReplayInput(arg);
    if (sanitized === "invalid") {
      await message.react("❌");
      await message.reply("❌ Invalid input — must be a TagPro replay link or UUID.");
      return;
    }

    try {
      const res = await fetch(`${WORKER_URL}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: String(sanitized), origin: "discord" }),
      });
      const data = await res.json();

      if (!data.ok) {
        await message.react("❌");
        await message.reply(`❌ Parse error: ${data.error}`);
        return;
      }

      const record = data.record;
      console.log(record);
      if (!record.capping_player || record.capping_player == null) {
        await message.react("❌");
        await message.reply("❌ Run not finished — no capping player detected.");
        return;
      }

      const formattedTime = formatTime(record.record_time);
      await message.react("✅");
      await message.reply(
        `🕒 Record time: ${formattedTime}\n📍 Map: ${record.map_name}\n👤 Player: ${record.capping_player}`
      );
    } catch (err) {
      await message.react("❌");
      await message.reply(`❌ Failed to contact Worker: ${err.message}`);
    }
    return;
  }

  if (message.content.startsWith("!upload")) {
    const arg = message.content.replace("!upload", "").trim();
    const sanitized = sanitizeReplayInput(arg);
    console.log(sanitized);

    if (!sanitized) {
      await message.react("❌");
      await message.reply("❌ Invalid input — must be a TagPro replay link or UUID.");
      return;
    }

    await uploadRecord(sanitized, message);
  }
});

client.login(DISCORD_TOKEN);