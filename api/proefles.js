/**
 * Vercel serverless function: proefles aanmelding
 * Vereiste environment variable in Vercel: LAPOSTA_API_KEY
 */

const LIST_ID = '2fueysjced';
const LAPOSTA_API = 'https://api.laposta.nl/v2/member';

// Lees de raw request body en parse als URL-encoded form data
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        const params = new URLSearchParams(data);
        const obj = {};
        for (const [key, value] of params.entries()) {
          // Meervoudige waarden (checkboxes met [] naam) samenvoegen als array
          if (key in obj) {
            obj[key] = Array.isArray(obj[key])
              ? [...obj[key], value]
              : [obj[key], value];
          } else {
            obj[key] = value;
          }
        }
        resolve(obj);
      } catch (e) {
        reject(e);
      }
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

    // Checkbox locatie kan enkelvoudig (string) of meervoudig (array) zijn
    const locatieRaw = d['Y8OEFhf1ac[]'];
    const locaties = Array.isArray(locatieRaw)
      ? locatieRaw.join(', ')
      : locatieRaw || '';

    const apiKey = process.env.LAPOSTA_API_KEY;
    if (!apiKey) {
      console.error('LAPOSTA_API_KEY is niet ingesteld');
      return res.redirect(302, '/proefles?fout=config');
    }

    const payload = new URLSearchParams({
      list_id:                  LIST_ID,
      email:                    d['PI6DA7TLP7']  || '',
      ip:                       (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                                || req.socket?.remoteAddress
                                || '',
      source_url:               'https://imajuku.nl/proefles',

      'fields[VCQticEHHg]':     d['VCQticEHHg']  || '',   // Voornaam
      'fields[FEqqKfvEJN]':     d['FEqqKfvEJN']  || '',   // Achternaam
      'fields[WEiUDNfM7O]':     d['WEiUDNfM7O']  || '',   // Leeftijd
      'fields[rmF5mwHbQm]':     d['rmF5mwHbQm']  || '',   // Geslacht
      'fields[wQHcc605z4]':     d['wQHcc605z4']  || '',   // Student
      'fields[zZH7Jm1GrV]':     d['zZH7Jm1GrV']  || '',   // Telefoonnummer
      'fields[Y8OEFhf1ac]':     locaties,                  // Locatie(s)
      'fields[PcvLnGah3B]':     d['PcvLnGah3B']  || '',   // Proefles 1 datum
      'fields[FevVlZuZWq]':     d['FevVlZuZWq']  || '',   // Proefles 2 datum
      'fields[f9g5G3RavQ]':     d['f9g5G3RavQ']  || '',   // Motivatie
      'fields[kjrtQYYCLh]':     d['kjrtQYYCLh']  || '',   // Opmerking
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
    console.log('Laposta response:', lapostaRes.status, JSON.stringify(result));

    if (lapostaRes.ok) {
      return res.redirect(302, '/bedankt');
    }

    // Al ingeschreven (Laposta error code 308)
    if (result?.error?.code === 308) {
      return res.redirect(302, '/bedankt?al=1');
    }

    console.error('Laposta fout:', result);
    return res.redirect(302, '/proefles?fout=1');

  } catch (err) {
    console.error('Onverwachte fout:', err);
    return res.redirect(302, '/proefles?fout=1');
  }
};
