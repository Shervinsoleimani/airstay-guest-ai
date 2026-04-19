const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const HOSTAWAY_CLIENT_ID = process.env.HOSTAWAY_CLIENT_ID;
const HOSTAWAY_CLIENT_SECRET = process.env.HOSTAWAY_CLIENT_SECRET;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

let hostawayAccessToken = null;
let tokenExpiry = null;

async function getHostawayToken() {
  if (hostawayAccessToken && tokenExpiry > Date.now()) {
    return hostawayAccessToken;
  }
  const response = await axios.post('https://api.hostaway.com/v1/accessTokens', {
    client_id: HOSTAWAY_CLIENT_ID,
    client_secret: HOSTAWAY_CLIENT_SECRET,
  });
  hostawayAccessToken = response.data.access_token;
  tokenExpiry = Date.now() + response.data.expires_in * 1000;
  return hostawayAccessToken;
}

async function getReservation(reservationId) {
  const token = await getHostawayToken();
  const response = await axios.get(
    `https://api.hostaway.com/v1/reservations/${reservationId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return response.data.result;
}

async function sendMessageToGuest(conversationId, messageText) {
  const token = await getHostawayToken();
  await axios.post(
    `https://api.hostaway.com/v1/conversations/${conversationId}/messages`,
    { message: messageText },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

async function generateResponse(guestMessage, guestName, property) {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are the concierge for a luxury boutique hotel in Montreal called ${property}. A guest named ${guestName} just messaged: "${guestMessage}". Respond warmly and concisely (under 100 words). Use their first name once. If you don't know something, say you will follow up shortly.`
      }]
    },
    {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      }
    }
  );
  return response.data.content[0].text;
}

app.post('/webhook', async (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));
  const { reservationId, conversationId, message, senderType } = req.body;

  if (senderType === 'host') {
    return res.json({ status: 'ignored' });
  }

  const reservation = await getReservation(reservationId);
  const guestName = reservation?.guestFirstName || 'Guest';
  const propertyName = reservation?.listingTitle || 'our property';

  const aiResponse = await generateResponse(message, guestName, propertyName);
  await sendMessageToGuest(conversationId, aiResponse);

  res.json({ status: 'success', response: aiResponse });
});

app.get('/', (req, res) => {
  res.json({ status: 'Airstay Guest AI is running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
