const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const HOSTAWAY_CLIENT_ID = process.env.HOSTAWAY_CLIENT_ID;
const HOSTAWAY_CLIENT_SECRET = process.env.HOSTAWAY_CLIENT_SECRET;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const OWNER_PHONE = process.env.OWNER_PHONE;

let hostawayAccessToken = null;
let tokenExpiry = null;
const pendingMessages = {};

const PROPERTIES = {
  '155': {
    name: '155 Rue Saint-Paul East, Old Montreal',
    wifi_name: 'Labellavie',
    wifi_pass: 'enjoyyourstay',
    checkin_time: '4:00 PM',
    checkout_time: '11:00 AM',
    quiet_hours: '11:00 PM to 7:00 AM',
    elevator: 'No elevator — stairs only',
    laundry: 'Shared laundry on 2nd and 3rd floor hallways',
    garbage: 'Leave bags at the back staircase — housekeepers will handle it',
    parking: 'Paid street parking nearby. Public lots 3-5 min walk, approx $20/day. Street parking $3-4/hr — use Mobicité app. Note: Saint-Paul Street closes to public vehicles 11am-11pm April to October. Drop off at William Gray Hotel and walk to building — entrance is next to Crémerie Saint-Paul.',
    entry: 'Check-in instructions with building and unit entry codes are sent on your arrival day by 12pm.'
  },
  '380': {
    name: '380 Rue Le Moyne, Old Montreal',
    wifi_name: 'La Bella Vie',
    wifi_pass: 'enjoyyourstay',
    checkin_time: '4:00 PM',
    checkout_time: '11:00 AM',
    quiet_hours: '11:00 PM to 7:00 AM',
    elevator: 'Yes — building has elevator',
    laundry: 'In-unit washer and dryer',
    garbage: 'Garbage and recycling bins in the basement (SS level)',
    parking: 'Paid street parking right next to building. Public lots 2-3 min walk, approx $20/day. Street parking $3-4/hr — use Mobicité app. Brief parking in front of building to unload with hazard lights on is fine.',
    entry: 'Check-in instructions with building entrance code, intercom code, and unit door code are sent on your arrival day by 12pm.'
  },
  '386': {
    name: '386 Rue Le Moyne, Old Montreal',
    wifi_name: 'Le Moyne 2.4 / 5',
    wifi_pass: '386L3m0yn3',
    checkin_time: '4:00 PM',
    checkout_time: '11:00 AM',
    quiet_hours: '11:00 PM to 7:00 AM',
    elevator: 'Yes — building has elevator',
    laundry: 'In-unit washer and dryer',
    garbage: 'From ground floor, take door in front of elevator then stairs down. Garbage and recycling in basement. Glass/bottles can be left next to bins.',
    parking: 'Paid street parking right next to building. Public lots 2-3 min walk, approx $20/day. Street parking $3-4/hr — use Mobicité app.',
    entry: 'Check-in instructions with all entry codes are sent on your arrival day by 12pm.'
  },
  '2055': {
    name: '2055 Rue Bishop, Montreal',
    wifi_name: 'VIRGIN830',
    wifi_pass: '3D1EDD2A',
    checkin_time: '4:00 PM',
    checkout_time: '11:00 AM',
    quiet_hours: '11:00 PM to 7:00 AM',
    elevator: 'Please refer to your check-in instructions',
    laundry: 'Please refer to your check-in instructions',
    garbage: 'Garbage pickup is Monday mornings — place bags in front of building next to the trees the night before.',
    parking: 'Paid street parking on Bishop Street. Public garages 2-3 min walk, approx $22/day. Street parking $3/hr — use Mobicité app. You may park in front of building up to 15 min to unload with hazard lights on.',
    entry: 'Check-in instructions with all entry codes are sent on your arrival day by 12pm.'
  }
};

function getProperty(title) {
  if (!title) return null;
  const t = title.toLowerCase();
  if (t.includes('saint-paul') || t.includes('saint paul') || t.includes('155')) return PROPERTIES['155'];
  if (t.includes('386')) return PROPERTIES['386'];
  if (t.includes('380') || t.includes('le moyne') || t.includes('moyne')) return PROPERTIES['380'];
  if (t.includes('bishop') || t.includes('2055')) return PROPERTIES['2055'];
  return null;
}

async function getHostawayToken() {
  if (hostawayAccessToken && tokenExpiry > Date.now()) return hostawayAccessToken;
  const response = await axios.post('https://api.hostaway.com/v1/accessTokens', {
    grant_type: 'client_credentials',
    client_id: HOSTAWAY_CLIENT_ID,
    client_secret: HOSTAWAY_CLIENT_SECRET,
    scope: 'general'
  });
  hostawayAccessToken = response.data.access_token;
  tokenExpiry = Date.now() + (response.data.expires_in * 1000);
  return hostawayAccessToken;
}

async function getReservation(reservationId) {
  try {
    const token = await getHostawayToken();
    const response = await axios.get(
      `https://api.hostaway.com/v1/reservations/${reservationId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return response.data.result;
  } catch(e) {
    console.log('Could not fetch reservation:', e.message);
    return null;
  }
}

async function sendReply(conversationId, text) {
  try {
    const token = await getHostawayToken();
    await axios.post(
      `https://api.hostaway.com/v1/conversations/${conversationId}/messages`,
      { body: text },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    console.log('Reply sent successfully');
  } catch(e) {
    console.log('Could not send reply:', e.message, JSON.stringify(e.response?.data));
  }
}

async function generateAIResponse(message, guestName, property) {
  const propInfo = property ? `
PROPERTY: ${property.name}
WiFi: ${property.wifi_name} / Password: ${property.wifi_pass}
Check-in: ${property.checkin_time} | Check-out: ${property.checkout_time}
Quiet hours: ${property.quiet_hours}
Elevator: ${property.elevator}
Laundry: ${property.laundry}
Garbage: ${property.garbage}
Parking: ${property.parking}
Entry: ${property.entry}` : 'Property details not available.';

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: `You are the AI concierge for Airstay Properties, managing luxury boutique hotels in Montreal. Be warm, professional, and make guests feel like VIPs. Your goal is 5-star reviews.

${propInfo}

RULES — NEVER BREAK:
1. NEVER offer discounts. If asked say: "Our rates reflect the premium quality and location of our properties. For stays of 7+ nights, feel free to reach out and we can explore options."
2. NEVER confirm early check-in or late checkout. Say: "I'd love to help! Let me check availability with our team and confirm shortly."
3. NEVER make promises about rule exceptions.
4. For complaints say: "I sincerely apologize. I'm escalating this to our team right now and someone will be in touch very shortly."
5. Never mention you are AI unless directly asked.
6. Keep responses warm and under 120 words.
7. Use guest's first name once.`,
      messages: [{ role: 'user', content: message }]
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
  res.status(200).json({ received: true });

  try {
    console.log('Webhook body:', JSON.stringify(req.body));

    const data = req.body;

    const message = data.message || data.body ||
      data.data?.message || data.data?.body ||
      data.object?.message || data.object?.body;

    const senderType = data.senderType || data.data?.senderType ||
      data.object?.senderType || 'guest';

    const conversationId = data.conversationId || data.data?.conversationId ||
      data.object?.conversationId;

    const reservationId = data.reservationId || data.data?.reservationId ||
      data.object?.reservationId;

    console.log(`Message: ${message}, Sender: ${senderType}, ConvID: ${conversationId}`);

    if (!message || !conversationId) {
      console.log('Missing message or conversationId — skipping');
      return;
    }

    if (senderType === 'host' || senderType === 'system' || senderType === 'property') {
      console.log('Ignoring non-guest message');
      return;
    }

    let guestName = 'Guest';
    let property = null;

    if (reservationId) {
      const reservation = await getReservation(reservationId);
      if (reservation) {
        guestName = reservation.guestFirstName || 'Guest';
        property = getProperty(reservation.listingName || reservation.listingTitle || '');
        console.log(`Guest: ${guestName}, Property: ${property?.name || 'unknown'}`);
      }
    }

    console.log(`Owner alert — ${guestName} says: ${message}`);

    pendingMessages[conversationId] = {
      message, guestName, property, timestamp: Date.now()
    };

    setTimeout(async () => {
      if (pendingMessages[conversationId]) {
        const p = pendingMessages[conversationId];
        console.log('Auto-responding after 10 min timeout');
        const reply = await generateAIResponse(p.message, p.guestName, p.property);
        await sendReply(conversationId, reply);
        delete pendingMessages[conversationId];
        console.log('AI replied:', reply);
      }
    }, 10 * 60 * 1000);

  } catch(error) {
    console.log('Webhook error:', error.message);
    if (error.response) {
      console.log('Error response:', JSON.stringify(error.response.data));
    }
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'Airstay Guest AI is running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Airstay Guest AI running on port ${PORT}`);
});
