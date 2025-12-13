import fs from 'fs';
import readline from 'readline';

const input = 'replay.ndjson';
const output = 'output.json';

const rl = readline.createInterface({
  input: fs.createReadStream(input),
  crlfDelay: Infinity
});

const out = fs.createWriteStream(output);

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const json = JSON.parse(line);

    if (json[1] === "p") {
      const payload = json[2];

      // Check if any object inside payload has id === 2
      if (Array.isArray(payload) && payload.some(o => o.id === 2)) {
        out.write(line + '\n');
      }
    }
  } catch (e) {
    console.error("Invalid JSON line:", line);
  }
});

rl.on('close', () => {
  out.end();
  console.log("Done. Saved only 'p' events with id=2 to", output);
});
