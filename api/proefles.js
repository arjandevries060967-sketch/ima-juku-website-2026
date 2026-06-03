/**
 * Vercel serverless function: proefles aanmelding
 * Vereiste environment variable in Vercel: LAPOSTA_API_KEY
 */

const LIST_ID = '2fueysjced';
const LAPOSTA_API = 'https://api.laposta.nl/v2/member';

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        const params = new URLSearchParams(data);
        const obj = {};
        for (const [key, value] of params.entries()) {
          if (key in obj) {
            obj[key] = Array.isArray(obj[key]) ? [...obj[key], value] : [obj[key], value];
          } else {
            obj[key] = value;
          }
        }
        resolve(obj);
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const d = await parseBody(req);

    const locatieRaw = d['Y8OEFhf1ac[]'];
    const locaties = Array.isArray(locatieRaw) ? locatieRaw.join(', ') : locatieRaw || '';

    const apiKey = process.env.LAPOSTA_API_KEY;
    if (!apiKey) {
      console.error('LAPOSTA_API_KEY is niet ingesteld');
      return res.redirect(302, '/proefles?fout=config');
    }

    const payload = new URLSearchParams({
      list_id:                         LIST_ID,
      email:                           d['PI6DA7TLP7']  || '',
      ip:                              (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '',
      source_url:                      'https://imajuku.nl/proefles',
      'fields[voornaam]':              d['VCQticEHHg']  || '',
      'fields[achternaam]':            d['FEqqKfvEJN']  || '',
      'fields[leeftijd]':              d['WEiUDNfM7O']  || '',
      'fields[geslacht]':              d['rmF5mwHbQm']  || '',
      'fields[ikbenstudent]':          d['wQHcc605z4']  || '',
      'fields[telefoonnumer]':         d['zZH7Jm1GrV']  || '',
      'fields[locatie]':               locaties,
      'fields[proefles1datum]':        d['PcvLnGah3B']  || '',
      'fields[proefles2datum]':        d['FevVlZuZWq']  || '',
      'fields[motivatiewaaromaikido]': d['f9g5G3RavQ']  || '',
      'fields[opmerking]':             d['kjrtQYYCLh']  || '',
    });

    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

    const lapostaRes = await fetch(LAPOSTA_API, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
    });

    const result = await lapostaRes.json().catch(() => ({}));

    if (lapostaRes.ok) {
      return res.redirect(302, '/bedankt');
    }

    // E-mailadres bestaat al in de lijst (Laposta error code 204)
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
