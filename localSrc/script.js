async function parseRecord(uuid) {
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: uuid }), //parse expects { input }
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

