require('dotenv').config();
const { handleMetaWebhook } = require('./src/services/leadService');

async function sendFakeLead() {
  const payload = {
    "object": "page",
    "entry": [
      {
        "id": "444444444444",
        "time": 1783145903,
        "changes": [
          {
            "field": "leadgen",
            "value": {
              "ad_id": "444444444",
              "form_id": "444444444444",
              "leadgen_id": "444444444444",
              "created_time": 1783145903,
              "page_id": "444444444444",
              "adgroup_id": "44444444444"
            }
          }
        ]
      }
    ]
  };

  console.log("Simulating webhook payload...");
  await handleMetaWebhook(payload, (data) => console.log('Broadcast:', data));
  console.log("Done.");
  process.exit(0);
}

sendFakeLead().catch(console.error);
