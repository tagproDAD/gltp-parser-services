// bot.js
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import fetch from "node-fetch";
import { sanitizeReplayInput } from "./sanitizeInput.js";

// Replace with your bot token and Worker details
const DISCORD_TOKEN = "";
const CHANNELS = []; // allowed channel IDs
const WORKER_URL = "https://gltp.fwotagprodad.workers.dev";
//const WR_CHANNEL_ID = ""; //test server
const WR_CHANNEL_ID = "";


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

  // WR announcement scheduler
  setInterval(checkWRs, 10 * 60 * 1000); // every 10 minutes
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

function buildWRAnnounceEmbed(newRecords, lastAnnouncedTs) {
  const embed = new EmbedBuilder()
    .setTitle("🏆 New World Records!")
    .setColor(0xFFD700)
    .setDescription("\n");

  for (const record of newRecords) {
    const isNewTime = record.timestamp_uploaded_time > lastAnnouncedTs;
    const isNewJumps = record.timestamp_uploaded_jumps > lastAnnouncedTs;

    const replayTimeLink = record.uuid_time
      ? `https://tagpro.koalabeast.com/replays?uuid=${record.uuid_time}`
      : null;
    const replayJumpsLink = record.uuid_jumps
      ? `https://tagpro.koalabeast.com/replays?uuid=${record.uuid_jumps}`
      : null;

    let value = "";

    if (isNewTime && isNewJumps) {
      if (record.player_time === record.player_jumps && replayTimeLink === replayJumpsLink) {
        // Same player, same run → one replay link
        value =
          `👤 **${record.player_time}** set both!\n` +
          `⏱️ Fastest Time: \`${formatTime(record.fastestTime)}\`\n` +
          `🦘 Min Jumps: \`${record.minJumps}\`\n` +
          `[Replay](${replayTimeLink})`;
      } else {
        // Different players or different runs
        value =
          `👤 **${record.player_time}**\n` +
          `⏱️ Fastest Time: \`${formatTime(record.fastestTime)}\`\n` +
          `[Replay](${replayTimeLink})\n\n` +
          `👤 **${record.player_jumps}**\n` +
          `🦘 Min Jumps: \`${record.minJumps}\`\n` +
          `[Replay](${replayJumpsLink})`;
      }
    } else if (isNewTime) {
      value =
        `👤 **${record.player_time}**\n` +
        `⏱️ Fastest Time: \`${formatTime(record.fastestTime)}\`\n` +
        `[Replay](${replayTimeLink})`;
    } else if (isNewJumps) {
      value =
        `👤 **${record.player_jumps}**\n` +
        `🦘 Min Jumps: \`${record.minJumps}\`\n` +
        `[Replay](${replayJumpsLink})`;
    }

    if (value) {
      embed.addFields({
        name: record.map_name || `Map ${record.map_id}`,
        value: value + "\n",
        inline: false
      });
    }
  }

  embed.setFooter({
    text: `\nGLTP Tracker • ${newRecords.length} WR${newRecords.length > 1 ? "s" : ""} announced`
  });

  return embed;
}


async function checkWRs() {
  try {
    const wrs = await fetch(`${WORKER_URL}/wrs`).then(r => r.json());
    const wrChannel = await client.channels.fetch(WR_CHANNEL_ID);

    const lastMsg = (await wrChannel.messages.fetch({ limit: 1 })).first();
    const lastAnnouncedTs = lastMsg ? lastMsg.createdTimestamp : 0;

    const newRecords = [];
    for (const [mapId, record] of Object.entries(wrs)) {
      const isNewTime = Number(record.timestamp_uploaded_time) > lastAnnouncedTs;
      const isNewJumps = Number(record.timestamp_uploaded_jumps) > lastAnnouncedTs;

      if (isNewTime || isNewJumps) {
        newRecords.push({ map_id: mapId, ...record });
      }
    }

    if (newRecords.length > 0) {
      const total = newRecords.length;
      const batches = Math.ceil(total / 20);

      // Only send summary if more than one batch is needed
      if (batches > 1) {
        const summaryEmbed = new EmbedBuilder()
          .setTitle("📦 WR Announcement Summary")
          .setColor(0xFFD700)
          .setDescription(
            `🏆 ${total} WR${total > 1 ? "s" : ""} announced!\n` +
            `Splitting into ${batches} batches...`
          )
          .setFooter({ text: "GLTP Tracker" });

        await wrChannel.send({ embeds: [summaryEmbed] });
      }

      // Send detailed embeds in batches
      for (let i = 0; i < total; i += 20) {
        const chunk = newRecords.slice(i, i + 20);
        const embed = buildWRAnnounceEmbed(chunk, lastAnnouncedTs);

        embed.setFooter({
          text: `GLTP Tracker • Batch ${Math.floor(i / 20) + 1} of ${batches} • ${chunk.length} WR${chunk.length > 1 ? "s" : ""}`
        });

        await wrChannel.send({ embeds: [embed] });
      }
    }
  } catch (err) {
    console.error("❌ WR check failed:", err);
  }
}


client.login(DISCORD_TOKEN);