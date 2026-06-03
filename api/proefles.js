/**
 * Vercel serverless function: proefles aanmelding
 *
 * Ontvangt de form POST van /proefles.html,
 * stuurt de data door naar de Laposta API,
 * en redirect naar /bedankt of /proefles?fout=1
 *
 * Vereiste environment variable in Vercel:
 *   LAPOSTA_API_KEY = jouw Laposta API-sleutel
 */

const LIST_ID = '2fueysjced';
const LAPOSTA_API = 'https://api.laposta.nl/v2/member';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const d = req.body || {};

    // Checkbox locatie kan enkelvoudig (string) of meervoudig (array) binnenkomen
    const locaties = Array.isArray(d['Y8OEFhf1ac[]'])
      ? d['Y8OEFhf1ac[]'].join(', ')
      : d['Y8OEFhf1ac[]'] || '';

    // Bouw het Laposta-payload op
    // Veldnamen zijn de Laposta field-ID's zoals gevonden in het originele formulier
    const payload = new URLSearchParams({
      list_id:                  LIST_ID,
      email:                    d['PI6DA7TLP7']  || '',
      ip:                       req.headers['x-forwarded-for']?.split(',')[0].trim()
                                || req.socket?.remoteAddress
                                || '',
      source_url:               'https://imajuku.nl/proefles',

      // Persoonsgegevens
      'fields[VCQticEHHg]':     d['VCQticEHHg']  || '',   // Voornaam
      'fields[FEqqKfvEJN]':     d['FEqqKfvEJN']  || '',   // Achternaam
      'fields[WEiUDNfM7O]':     d['WEiUDNfM7O']  || '',   // Leeftijd
      'fields[rmF5mwHbQm]':     d['rmF5mwHbQm']  || '',   // Geslacht
      'fields[wQHcc605z4]':     d['wQHcc605z4']  || '',   // Student

      // Contact
      'fields[zZH7Jm1GrV]':     d['zZH7Jm1GrV']  || '',   // Telefoonnummer

      // Proefles
      'fields[Y8OEFhf1ac]':     locaties,                  // Locatie(s)
      'fields[PcvLnGah3B]':     d['PcvLnGah3B']  || '',   // Proefles 1 datum
      'fields[FevVlZuZWq]':     d['FevVlZuZWq']  || '',   // Proefles 2 datum
      'fields[f9g5G3RavQ]':     d['f9g5G3RavQ']  || '',   // Motivatie
      'fields[kjrtQYYCLh]':     d['kjrtQYYCLh']  || '',   // Opmerking
    });

    const apiKey = process.env.LAPOSTA_API_KEY;
    if (!apiKey) {
      console.error('LAPOSTA_API_KEY is niet ingesteld');
      return res.redirect(302, '/proefles?fout=config');
    }

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
      // Gelukt — stuur door naar bedanktpagina
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
}
