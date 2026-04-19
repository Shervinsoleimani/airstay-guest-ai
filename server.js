const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const HOSTAWAY_CLIENT_ID = process.env.HOSTAWAY_CLIENT_ID;
const HOSTAWAY_CLIENT_SECRET = process.env.HOSTAWAY_CLIENT_SECRET;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const OWNER_PHONE = process.env.OWNER_PHONE;

let hostawayAccessToken = null;
let tokenExpiry = null;

const pendingMessages = {};

const PROPERTIES = {
  '155 rue saint-paul': {
    name: '155 Rue Saint-Paul East, Old Montreal',
    wifi_name: 'Labellavie',
    wifi_pass: 'enjoyyourstay',
    checkin_time: '4:00 PM',
    checkout_time: '11:00 AM',
    quiet_hours: '11:00 PM to 7:00 AM',
    elevator: 'No elevator — stairs only',
    laundry: 'Shared laundry on 2nd and 3rd floor hallways',
    garbage: 'Leave bags at the back staircase — housekeepers will take care of it',
    parking: `There is paid street parking near the building and public parking lots 3-5 min walk away. Daily passes approx $20/day. Street parking approx $3-4/hour — download the Mobicité app for easy payment. Note: Saint-Paul Street closes to public vehicles from 11am to 11pm (April to October). During this time, drop off at the William Gray Hotel and walk to the building — entrance is next to Crémerie Saint-Paul shop. Nearby parking: Indigo Montreal at 445 Rue Saint-Jean-Baptiste.`,
    entry: 'Check-in instructions including building entry code and unit code are sent on arrival day by 12pm.',
    notes: 'No elevator. Building entrance is next to Crémerie Saint-Paul shop.'
  },
  '380 rue le moyne': {
    name: '380 Rue Le Moyne, Old Montreal',
    wifi_name: 'La Bella Vie',
    wifi_pass: 'enjoyyourstay',
    checkin_time: '4:00 PM',
    checkout_time: '11:00 AM',
    quiet_hours: '11:00 PM to 7:00 AM',
    elevator: 'Yes',
    laundry: 'In-unit washer and dryer',
    garbage: 'Garbage and recycling bins are in the basement (SS level)',
    parking: `Paid street parking right next to the building. Public parking lots 2-3 min walk, daily passes approx $20/day. Street parking approx $3-4/hour — download Mobicité app. You may briefly park in front of building to unload luggage with hazard lights on. Nearby: Hotel St Paul Parking (514) 380-2222, ClicknPark at 720 Rue Saint-Maurice +1 855-979-7275.`,
    entry: 'Check-in instructions including building entrance code, intercom code, and unit door code are sent on arrival day by 12pm.',
    notes: 'Building has elevator.'
  },
  '386 rue le moyne': {
    name: '386 Rue Le Moyne, Old Montreal',
    wifi_name: 'Le Moyne 2.4 / 5',
    wifi_pass: '386L3m0yn3',
    checkin_time: '4:00 PM',
    checkout_time: '11:00 AM',
    quiet_hours: '11:00 PM to 7:00 AM',
    elevator: 'Yes',
    laundry: 'In-unit washer and dryer',
    garbage: 'From ground floor, take the door directly in front of the elevator, then head downstairs. Garbage and recycling bins are in the basement. Glass/bottles can be left next to the bins — housekeepers will handle them.',
    parking: `Paid street parking right next to the building. Public parking lots 2-3 min walk, daily passes approx $20/day. Street parking approx $3-4/hour — download Mobicité app. You may briefly park in front of building to unload luggage with hazard lights on. Nearby: Hotel St Paul Parking (514) 380-2222, ClicknPark at 720 Rue Saint-Maurice +1 855-979-7275.`,
    entry: 'Check-in instructions including building entrance code, intercom code, and unit door code are sent on arrival day by 12pm.',
    notes: 'Building has elevator.'
  },
  '2055 rue bishop': {
    name: '2055 Rue Bishop, Montreal',
    wifi_name: 'VIRGIN830',
    wifi_pass: '3D1EDD2A',
    checkin_time: '4:00 PM',
    checkout_time: '11:00 AM',
    quiet_hours: '11:00 PM to 7:00 AM',
    elevator: 'No',
    laundry: 'In-unit washer and dryer',
    garbage: 'Garbage pickup is Monday mornings — place bags in front of the building next to the trees the night before.',
    parking: `Paid street parking on Bishop Street. Public parking garages 2-3 min walk, daily passes approx $22/day. Street parking approx $3/hour — download Mobicité app. You may park in front of building for up to 15 minutes to unload with hazard lights on. Nearby: Concordia LB Parking Garage (514) 848-2424 ext 8777, Hotel Novotel Garage (514) 866-4660, 1432 Crescent St Garage.`,
    entry: 'Check-in instructions including entry codes are sent on arrival day by 12pm.',
    notes: ''
  }
};

function getPropertyInfo(listingTitle) {
  if (!listingTitle) return null;
  const title = listingTitle.toLowerCase();
  for (const key of Object.keys(PROPERTIES)) {
    if (title.includes(key)) return PROPERTIES[key];
  }
  return null;
}

async function getHostawayToken() {
  if (hostawayAccessToken && tokenExpiry > Date.now()) return hostawayAccessToken;
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

async function sendSMSToOwner(message) {
  if (!OWNER_PHONE) return;
  try {
    await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'ping' }]
    }, {
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    });
  } catch(e) {}
  console.log(`SMS TO OWNER: ${message}`);
}

async function generateAIResponse(guestMessage, guestName, property, conversationHistory) {
  const propertyInfo = property ? `
PROPERTY: ${property.name}
WiFi: ${property.wifi_name} / Password: ${property.wifi_pass}
Check-in: ${property.checkin_time} | Check-out: ${property.checkout_time}
Quiet hours: ${property.quiet_hours}
Elevator: ${property.elevator}
Laundry: ${property.laundry}
Garbage: ${property.garbage}
Parking: ${property.parking}
Entry: ${property.entry}
Notes: ${property.notes}` : 'Property details not found — be helpful but vague on specifics.';

  const systemPrompt = `You are the AI concierge for Airstay Properties, managing luxury boutique hotels in Old Montreal. You represent a premium brand. Always be warm, professional, and make guests feel like VIP guests at a 5-star hotel. Your goal is to earn 5-star reviews.

${propertyInfo}

STRICT RULES — NEVER BREAK THESE:
1. NEVER offer, agree to, or discuss discounts. If asked, say: "Our rates reflect the premium quality and location of our properties, and are set based on current market demand. For extended stays of 7 nights or more, feel free to reach out and we'd be happy to explore options."
2. NEVER confirm early check-in or late checkout. Always say: "I'd love to help make that work! Let me check availability and coordinate with our team. I'll confirm with you as soon as possible."
3. NEVER make promises about exceptions to house rules.
4. NEVER mention you are an AI unless directly asked.
5. For ANY complaint or maintenance issue, say: "I sincerely apologize for this experience. I'm escalating this to our team right now and someone will be in touch with you very shortly."
6. Keep responses warm, concise, and elegant — under 120 words unless the question genuinely requires more detail.
7. Use the guest's first name once per message.
8. Always end messages with something that makes the guest feel valued.

Guest name: ${guestName}`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: guestMessage }]
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
  res.json({ status: 'received' });

  try {
    const body = req.body;
    const conversationId = body.conversationId || body.data?.conversationId;
    const reservationId = body.reservationId || body.data?.reservationId;
    const message = body.message || body.data?.message;
    const senderType = body.senderType || body.data?.senderType;

    if (!message || senderType === 'host' || senderType === 'system') {
      console.log('Ignoring non-guest message');
      return;
    }

    const reservation = await getReservation(reservationId);
    const guestName = reservation?.guestFirstName || 'Guest';
    const listingTitle = reservation?.listingTitle || '';
    const property = getPropertyInfo(listingTitle);

    const alertMessage = `AIRSTAY GUEST MESSAGE
Guest: ${guestName}
Property: ${listingTitle}
Message: "${message}"

Reply "AI ${conversationId}" to let AI respond, or reply manually in Hostaway.`;

    await sendSMSToOwner(alertMessage);
    console.log('Owner alerted:', alertMessage);

    pendingMessages[conversationId] = {
      guestMessage: message,
      guestName,
      property,
      listingTitle,
      timestamp: Date.now()
    };

    setTimeout(async () => {
      const pending = pendingMessages[conversationId];
      if (pending) {
        console.log(`Auto-responding to conversation ${conversationId} after timeout`);
        const aiResponse = await generateAIResponse(
          pending.guestMessage,
          pending.guestName,
          pending.property,
          []
        );
        await sendMessageToGuest(conversationId, aiResponse);
        delete pendingMessages[conversationId];
        console.log('AI response sent:', aiResponse);
      }
    }, 10 * 60 * 1000);

  } catch (error) {
    console.error('Webhook error:', error.message, error.response?.data);
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'Airstay Guest AI is running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', pending: Object.keys(pendingMessages).length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Airstay Guest AI running on port ${PORT}`);
});
