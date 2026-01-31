const fs = require('fs');

async function executeBatchUpdates() {
  const ACCOUNT_ID = 'your-account-id';
  const DATABASE_ID = 'your-database-id';
  const API_TOKEN = 'your-api-token';

  const sqlFile = fs.readFileSync('update-records.sql', 'utf8');
  const statements = sqlFile
    .split('\n')
    .filter(line => line.trim().startsWith('UPDATE'))
    .map(line => line.trim());

  console.log(`📊 Found ${statements.length} UPDATE statements`);

  const batchSize = 50;
  
  for (let i = 0; i < statements.length; i += batchSize) {
    const batch = statements.slice(i, i + batchSize);
    
    console.log(`⏳ Executing batch ${Math.floor(i / batchSize) + 1}...`);

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sql: batch.join('\n')
        })
      }
    );

    const result = await response.json();
    
    if (!result.success) {
      console.error(`❌ Batch failed:`, result.errors);
      break;
    }
    
    console.log(`✅ Batch completed (${batch.length} statements)`);
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('🎉 All updates completed!');
}

executeBatchUpdates().catch(console.error);