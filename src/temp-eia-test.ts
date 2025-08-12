import axios from 'axios';
import { config } from './config.js';

async function testEiaApi() {
  const apiKey = config.eiaApiKey;
  if (!apiKey) {
    console.error("EIA API key not found. Please set it in your .env file.");
    return;
  }

  const endpoint = "https://api.eia.gov/v2/electricity/operating-generator-capacity/data";
  const params = {
    api_key: apiKey,
    frequency: "monthly",
    facets: {
      stateid: ["CO"],
    },
    data: ["net-summer-capacity-mw", "net-winter-capacity-mw"],
    sort: [{ column: "period", direction: "desc" }],
    length: 5000,
  };

  try {
    const response = await axios.get(endpoint, { params });
    console.log("API Response:", response.data);
  } catch (error: any) {
    console.error("API Error:", error.response?.data || error.message);
  }
}

testEiaApi();
