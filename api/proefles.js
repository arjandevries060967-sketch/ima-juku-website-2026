/**
 * Vercel serverless function: proefles aanmelding → Laposta
 * Vereiste env var in Vercel: LAPOSTA_API_KEY
 *
 * Payload wordt volledig handmatig gebouwd met ongeëncodeerde blokhaken,
 * zoals Laposta vereist: custom_fields[voornaam]=Waarde
 */

const LIST_ID    = '2fueysjced';
const LAPOSTA_API = 'https://api.laposta.nl/v2/member';

// Lees raw POST-body als string
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

// Parseer URL-encoded body naar object; ondersteunt meerdere waarden per key
function parseBody(raw) {
  const params = new URLSearchParams(raw);
  const obj = {};
  for (const [key, value] of params.entries()) {
    if (key in obj) {
      obj[key] = Array.isArray(obj[key]) ? [...obj[key], value] : [obj[key], value];
    } else {
      obj[key] = value;
    }
  }
  return obj;
}

// Bouw payload volledig als string, nooit via URLSearchParams,
// zodat blokhaken in custom_fields[naam] nooit geëncodeerd worden.
function buildPayload({ listId, email, ip, sourceUrl, customFields }) {
  const enc = encodeURIComponent;
  const parts = [
    `list_id=${enc(listId)}`,
    `email=${enc(email)}`,
    `ip=${enc(ip)}`,
    `source_url=${enc(sourceUrl)}`,
  ];
  for (const [key, val] of Object.entries(customFields)) {
    parts.push(`custom_fields[${key}]=${enc(val)}`);
  }
  return parts.join('&');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const raw = await readBody(req);
    const d   = parseBody(raw);

    console.log('Form data keys:', Object.keys(d));

    const locatieRaw = d['Y8OEFhf1ac[]'];
    const locaties   = Array.isArray(locatieRaw)
      ? locatieRaw.join(', ')
      : locatieRaw || '';

    const apiKey = process.env.LAPOSTA_API_KEY;
    if (!apiKey) {
      console.error('LAPOSTA_API_KEY is niet ingesteld als env var');
      return res.redirect(302, '/proefles?fout=config');
    }

    const payload = buildPayload({
      listId:    LIST_ID,
      email:     d['PI6DA7TLP7']  || '',
      ip:        (req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
      sourceUrl: 'https://imajuku.nl/proefles',
      customFields: {
        voornaam:              d['VCQticEHHg']  || '',
        achternaam:            d['FEqqKfvEJN']  || '',
        leeftijd:              d['WEiUDNfM7O']  || '',
        geslacht:              d['rmF5mwHbQm']  || '',
        ikbenstudent:          d['wQHcc605z4']  || '',
        telefoonnumer:         d['zZH7Jm1GrV']  || '', // typo in Laposta
        locatie:               locaties,
        proefles1datum:        d['PcvLnGah3B']  || '',
        proefles2datum:        d['FevVlZuZWq']  || '',
        motivatiewaaromaikido: d['f9g5G3RavQ']  || '',
        opmerking:             d['kjrtQYYCLh']  || '',
      },
    });

    console.log('Laposta payload:', payload);

    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

    const lapostaRes = await fetch(LAPOSTA_API, {
      method: 'POST',
      headers: {
        Authorization:  authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload,
    });

    const result = await lapostaRes.json().catch(() => ({}));
    console.log('Laposta status:', lapostaRes.status, JSON.stringify(result));

    if (lapostaRes.ok) {
      return res.redirect(302, '/bedankt');
    }

    // E-mailadres staat al in de lijst
    if (result?.error?.code === 204) {
      return res.redirect(302, '/bedankt?al=1');
    }

    console.error('Laposta fout:', lapostaRes.status, JSON.stringify(result));
    return res.redirect(302, '/proefles?fout=1');

  } catch (err) {
    console.error('Onverwachte fout:', err);
    return res.redirect(302, '/proefles?fout=1');
  }
};
