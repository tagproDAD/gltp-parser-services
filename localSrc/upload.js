import fs from "fs";

// Worker endpoints
const WORKER_PARSE_URL = `https://gltp.fwotagprodad.workers.dev/parse`;
const VERCEL_PARSE_URL = 'http://localhost:3000/api/parse'
//const WORKER_PARSE_URL = 'http://127.0.0.1:8787/parse';
const WORKER_CHECK_URL = "https://gltp.fwotagprodad.workers.dev/check-uuids";
const WORKER_CHECK_ERRORS_URL = "https://gltp.fwotagprodad.workers.dev/check-errors";
const WORKER_DELETE_URL = "https://gltp.fwotagprodad.workers.dev/delete-record";
const DELAYED_WORKER_URL = "https://gltp.fwotagprodad.workers.dev/delayed-upload";

// Helper: sleep for ms milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testDelayedUpload() {
  const uuid = "f7569a6e-3ace-4181-b939-5ca987fbc8f7"; // sample UUID
  const origin = "local-test-script";

  try {
    const res = await fetch(DELAYED_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: uuid, origin })
    });

    const data = await res.json();
    console.log("Response from /delayed-upload:", data);
  } catch (err) {
    console.error("Error calling /delayed-upload:", err);
  }
}

async function parseWithVercel(uuid) {
  try {
    const res = await fetch(VERCEL_PARSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: uuid, origin: "local-test" }),
    });
    const parsed = await res.json();

    if (!parsed.ok) {
      console.log(`❌ Vercel parse error for ${uuid}: ${parsed.error}`);
      return null;
    }

    console.log(`✅ Parsed ${uuid}`);
    //console.log(JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (err) {
    console.error(`❌ Request to Vercel failed for ${uuid}:`, err);
    return null;
  }
}

// Call /delete-record for a single UUID
async function deleteRecord(uuid) {
  try {
    const res = await fetch(WORKER_DELETE_URL, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uuid, password: WORKER_PASSWORD })
    });

    const result = await res.json();

    if (res.status === 200 && result.ok) {
      console.log(`🗑️ Successfully deleted ${uuid}`);
      return result;
    } else if (res.status === 401) {
      console.log(`❌ Unauthorized: wrong password for ${uuid}`);
      return null;
    } else if (res.status === 404) {
      console.log(`⚠️ Record not found: ${uuid}`);
      return null;
    } else {
      console.log(`❌ Delete failed for ${uuid}: ${JSON.stringify(result)}`);
      return null;
    }
  } catch (err) {
    console.error(`❌ Request failed for ${uuid}:`, err);
    return null;
  }
}


// Call /parse for a single UUID
async function parseRecord(uuid) {
  try {
    const res = await fetch(WORKER_PARSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: uuid, origin: "local bot" }), // /parse expects { input }
    });
    const parsed = await res.json();
    if (!parsed.ok) {
      console.log(`❌ Parse error for ${uuid}: ${parsed.error}`);
      return null;
    }

    if (parsed.upload?.status === 201) {
      console.log(`✅ Inserted ${uuid}`);
    } else if (parsed.upload?.status === 409) {
      console.log(`⚠️ Duplicate ${uuid}`);
    } else {
      console.log(`❌ Upload failed for ${uuid}: ${JSON.stringify(parsed.upload)}`);
    }
    return parsed;
  } catch (err) {
    console.error(`❌ Request failed for ${uuid}:`, err);
  }
  return null;
}

// Call /check-uuids for a batch of UUIDs
async function checkUuids(uuids) {
  try {
    const res = await fetch(WORKER_CHECK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(uuids),
    });
    const data = await res.json();
    if (data.error) {
      console.log(data);
    }
    return data.missing || [];
  } catch (err) {
    console.error("❌ Check request failed:", err);
    return [];
  }
}

// Call /check-uuids for a batch of UUIDs
async function checkerrors(uuids) {
  try {
    const res = await fetch(WORKER_CHECK_ERRORS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(uuids),
    });
    const data = await res.json();
    if (data.error) {
      console.log(data);
    }
    return data.missing || [];
  } catch (err) {
    console.error("❌ Check request failed:", err);
    return [];
  }
}

// Mode: parse all records
async function runParse() {
  // Load records.json (array of objects with at least a uuid field)
  const records = JSON.parse(fs.readFileSync("uuidsSanitized.json", "utf8"));
  const results = [];
  for (let i = 0; i < records.length; i++) {
    const uuid = records[i].uuid;
    console.log(`Parsing record ${i + 1}/${records.length}: ${uuid}`);
    const parsed = await parseRecord(uuid);
    if (parsed) results.push(parsed);

    await sleep(2000);
  }

  fs.writeFileSync("parsed-results.json", JSON.stringify(results, null, 2));
  console.log("🎉 All parsing complete. Results saved to parsed-results.json");
}

// Mode: parse all records
async function runParseVercel() {
  // Load records.json (array of objects with at least a uuid field)
  const records = JSON.parse(fs.readFileSync("uuidsSanitized.json", "utf8"));
  const results = [];
  for (let i = 0; i < records.length; i++) {
    const uuid = records[i].uuid;
    console.log(`Parsing record ${i + 1}/${records.length}: ${uuid}`);
    const parsed = await parseWithVercel(uuid);
    if (parsed) results.push(parsed);

    await sleep(200);
  }

  fs.writeFileSync("parsed-results.json", JSON.stringify(results, null, 2));
  console.log("🎉 All parsing complete. Results saved to parsed-results.json");
}

// Mode: delete all records from uuids.json
async function runDelete() {
  // Load uuids.json (array of UUID strings)
  const uuids = JSON.parse(fs.readFileSync("badmaps.json", "utf8"));
  const results = [];

  for (let i = 0; i < uuids.length; i++) {
    const uuid = uuids[i];
    console.log(`Deleting record ${i + 1}/${uuids.length}: ${uuid}`);
    const deleted = await deleteRecord(uuid, "WORKER_PASSWORD");
    if (deleted) results.push(deleted);

    //await sleep(500); // small pause between requests
  }

  fs.writeFileSync("deleted-results.json", JSON.stringify(results, null, 2));
  console.log("🎉 All deletions complete. Results saved to deleted-results.json");
}

// Mode: check duplicates first
async function runCheck() {
  // Load records.json (array of objects with at least a uuid field)
  const records = JSON.parse(fs.readFileSync("uuidsSanitized.json", "utf8"));
  const uuids = records.map(r => r.uuid);

  // Chunk into batches
  const batchSize = 100;
  const missing = [];
  for (let i = 0; i < uuids.length; i += batchSize) {
    const batch = uuids.slice(i, i + batchSize);
    console.log(`Checking batch ${i / batchSize + 1} (${batch.length} UUIDs)...`);
    const batchMissing = await checkUuids(batch);
    missing.push(...batchMissing);
    await sleep(1000); // small pause between batches
  }

  fs.writeFileSync("missing-records.json", JSON.stringify(missing, null, 2));
  console.log(`🎉 Check complete. ${missing.length} missing UUIDs saved to missing-records.json`);
}

async function runErrorCheck() {
  // Load records.json (array of objects with at least a uuid field)
  const records = JSON.parse(fs.readFileSync("uuidsSanitized.json", "utf8"));
  const uuids = records.map(r => r.uuid);

  // Chunk into batches
  const batchSize = 100;
  const missing = [];
  for (let i = 0; i < uuids.length; i += batchSize) {
    const batch = uuids.slice(i, i + batchSize);
    console.log(`Checking batch ${i / batchSize + 1} (${batch.length} UUIDs)...`);
    const batchMissing = await checkerrors(batch);
    missing.push(...batchMissing);
    await sleep(1000); // small pause between batches
  }

  fs.writeFileSync("missing-records.json", JSON.stringify(missing, null, 2));
  console.log(`🎉 Check complete. ${missing.length} missing UUIDs saved to missing-records-errors.json`);
}

// Function to extract just UUIDs from main json format and save them to a new file
function extractUuids() {
  const records = JSON.parse(fs.readFileSync('all-records1-17-26.json', 'utf8'));
  const uuids = records.map(record => ({ uuid: record.uuid }));
  fs.writeFileSync('uuidsSanitized.json', JSON.stringify(uuids, null, 2));
  console.log('🎉 UUIDs extracted and saved to uuids.json');
}

//fixes format of dump of text uuids into json uuid: value
function sanitizeTextUuids() {
  const inputFile = "botuuids.txt";
  const outputFile = "uuidsSanitized.json";
  const rawData = fs.readFileSync(inputFile, "utf8");
  
  // Split the data into an array of UUIDs by newlines and clean up the extra characters like '\r'
  const uuidArray = rawData.split('\n')
    .map(uuid => uuid.replace(/[\r\n]+$/, '').trim()) // Remove any \r, \n, and trim spaces
    .filter(uuid => uuid !== '');  // Remove any empty strings

  const uuidObjects = uuidArray.map(uuid => ({ uuid }));
  fs.writeFileSync(outputFile, JSON.stringify(uuidObjects, null, 1));

  console.log(`✅ Converted ${uuidArray.length} UUIDs and saved to ${outputFile}`);
}


//fixes format of array of uuids into json uuid: value
function sanitizeUuids() {
  const inputFile = "missing-records.json";
  const outputFile = "uuidsSanitized.json";

  const rawData = fs.readFileSync(inputFile, "utf8");
  const uuidArray = JSON.parse(rawData);

  const uuidObjects = uuidArray.map(uuid => ({ uuid }));

  fs.writeFileSync(outputFile, JSON.stringify(uuidObjects, null, 2));

  console.log(`✅ Converted ${uuidArray.length} UUIDs and saved to ${outputFile}`);
}

//deep compares too arrays of records for matching data
//deep compares two arrays of records for matching data
function compareData() {
  const fileBPath = "all-records1-17-26.json";
  const fileAPath = "parsed-results-compare.json";
  const worldRecordsPath = "world-records.json";

  // Load files
  const fileA = JSON.parse(fs.readFileSync(fileAPath, "utf8"));
  const fileB = JSON.parse(fs.readFileSync(fileBPath, "utf8"));
  const worldRecords = JSON.parse(fs.readFileSync(worldRecordsPath, "utf8"));

  // Helper to extract record from either format
  function extractRecord(item) {
    // If it has a 'record' property, it's wrapped
    if (item.record) {
      return item.record;
    }
    // Otherwise it's already a record
    return item;
  }

  // Map B by UUID for fast lookup
  const bMap = new Map(fileB.map(item => {
    const record = extractRecord(item);
    return [record.uuid, record];
  }));

  // Helper: deep compare and collect differences
  function diffFields(a, b, path = "") {
    const diffs = [];

    // Ignore the 'preset' field
    if (path && path.endsWith(".preset")) {
      return diffs;
    }

    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
      if (a !== b) {
        diffs.push({ path, expected: a, found: b });
      }
      return diffs;
    }

    if (Array.isArray(a)) {
      if (!Array.isArray(b)) {
        diffs.push({ path, expected: a, found: b });
        return diffs;
      }

      // Compare arrays order-insensitively
      const unmatchedB = [...b];
      const unmatchedA = [];
      
      for (const [i, itemA] of a.entries()) {
        const index = unmatchedB.findIndex(itemB => {
          const itemDiffs = diffFields(itemA, itemB, "");
          return itemDiffs.length === 0;
        });
        
        if (index === -1) {
          unmatchedA.push({ index: i, item: itemA });
        } else {
          unmatchedB.splice(index, 1);
        }
      }
      
      // Report unmatched items from A
      for (const unmatched of unmatchedA) {
        diffs.push({ path: `${path}[${unmatched.index}]`, expected: unmatched.item, found: "no match in array" });
      }
      
      // Report extra items in B
      for (const extraB of unmatchedB) {
        diffs.push({ path: `${path}[extra]`, expected: "not in A", found: extraB });
      }
      
      return diffs;
    }

    // Object comparison
    for (const key of Object.keys(a)) {
      if (key === "preset" || key === "is_racing_mode" || key === "origin" || key === "timestamp_uploaded" || key === "allow_blue_caps") {
        continue;
      }

      if (!(key in b)) {
        diffs.push({ path: path ? `${path}.${key}` : key, expected: a[key], found: undefined });
      } else {
        diffs.push(...diffFields(a[key], b[key], path ? `${path}.${key}` : key));
      }
    }
    
    // Check for keys in b that aren't in a
    for (const key of Object.keys(b)) {
      if (key === "preset" || key === "is_racing_mode" || key === "origin" || key === "timestamp_uploaded" || key === "allow_blue_caps") {
        continue;
      }
      if (!(key in a)) {
        diffs.push({ path: path ? `${path}.${key}` : key, expected: undefined, found: b[key] });
      }
    }

    return diffs;
  }

  // Check each record in A
  const mismatched = [];
  const mapNames = new Set();
  const mapIDs = new Set();
  fileA.forEach(itemA => {
    const recordA = extractRecord(itemA);
    const recordB = bMap.get(recordA.uuid);
    
    if (!recordB) {
      mismatched.push({ uuid: recordA.uuid, reason: "Missing in B" });
    } else {
      const diffs = diffFields(recordA, recordB);
      if (diffs.length > 0) {
        mapNames.add(recordA.map_name);
        mapIDs.add(recordA.map_id);
        mismatched.push({ uuid: recordA.uuid, reason: "Fields mismatch", diffs });
      }
    }
  });

  // Output result
  if (mismatched.length === 0) {
    console.log("✅ All records in File A exist in File B with matching fields (ignoring 'preset')");
  } else {
    console.log(`❌ ${mismatched.length} records mismatch:`);
    mismatched.forEach(m => {
      console.log(`\nUUID: ${m.uuid} - ${m.reason}`);
      if (m.diffs) {
        m.diffs.forEach(d => {
          console.log(`  Field: ${d.path}`);
          console.log(`    Expected: ${JSON.stringify(d.expected)}`);
          console.log(`    Found:    ${JSON.stringify(d.found)}`);
        });
      }
    });
  }

  // ⭐ Final unique map names
  console.log("\n🗺️ Unique map names with mismatches:");
  console.log([...mapNames]);

  const brokenRecords = [];

  fileA.forEach(itemA => {
    const recordA = extractRecord(itemA);
    const mapId = String(recordA.map_id);

    if (!mapIDs.has(mapId)) return;

    const wr = worldRecords[mapId];
    if (!wr) return;

    const beatsTime =
      typeof recordA.record_time === "number" &&
      recordA.record_time < wr.fastestTime;

    const beatsJumps =
      typeof recordA.total_jumps === "number" &&
      recordA.total_jumps < wr.minJumps;

    if (beatsTime || beatsJumps) {
      brokenRecords.push({
        map_id: mapId,
        map_name: wr.map_name,
        uuid: recordA.uuid,
        record_time: recordA.record_time,
        fastestTime: wr.fastestTime,
        total_jumps: recordA.total_jumps,
        minJumps: wr.minJumps,
        beats: {
          time: beatsTime,
          jumps: beatsJumps
        }
      });
    }
  });

  if (brokenRecords.length === 0) {
    console.log("🏁 No world records beaten.");
  } else {
    console.log(`🔥 ${brokenRecords.length} potential world records found:`);

    brokenRecords.forEach(r => {
      console.log(`\n🗺️ ${r.map_name} (ID: ${r.map_id})`);
      console.log(`UUID: ${r.uuid}`);

      if (r.beats.time) {
        console.log(`⏱️ Time: ${r.record_time} < ${r.fastestTime}`);
      }
      if (r.beats.jumps) {
        console.log(`🦘 Jumps: ${r.total_jumps} < ${r.minJumps}`);
      }
    });
  }


}

// New pipeline mode
async function runPipeline() {
  console.log("🚀 Starting pipeline...");

  // Step 1: sanitize text
  sanitizeTextUuids();

  // Step 2: check duplicates (adds them to missing-records)
  await runCheck();

  // Step 3: sanitize again
  sanitizeUuids();

  // Step 4: check duplicate errors
  await runErrorCheck();

  // Step 5 sanitize
  sanitizeUuids();

  // Step 4: pause for inspection
  console.log("⏸️ Pausing before parse...");
  console.log("👉 Review missing-records.json and missing-records-errors.json to see UUIDs not uploaded.");
  process.stdout.write("Press Enter to continue, or type 'q' to quit: ");

  await new Promise(resolve => {
    process.stdin.once("data", (data) => {
      const input = data.toString().trim().toLowerCase();
      if (input === "q" || input === "quit") {
        console.log("🛑 Pipeline stopped by user.");
        process.exit(0); // terminate the script immediately
      }
      resolve();
    });
  });

  // Step 5: parse
  await runParse();

  console.log("🎉 Pipeline complete!");
}


// Entry point: choose mode based on CLI parameter
const mode = process.argv[2];
if (mode === "parse") {
    runParse();
} else if (mode === "parseVercel") {
    runParseVercel();
} else if (mode === "check") {
    runCheck();
} else if (mode === "checkErrors") {
    runErrorCheck();
} else if (mode === "extract") {
    extractUuids();
} else if (mode === "sanitize") {
    sanitizeUuids();
} else if (mode === "sanitizeText") {
    sanitizeTextUuids();
} else if (mode === "compare") {
    compareData();
} else if (mode === "delete") {
    runDelete();
} else if (mode === "pipeline") {
    runPipeline();
} else if (mode === "delay") {
    testDelayedUpload();
} else {
  console.log("Usage: node script.js [parse|check|checkErrors|extract|sanitize|compare]");
} 