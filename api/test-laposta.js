module.exports = async function handler(req, res) {
  const apiKey = process.env.LAPOSTA_API_KEY;

  // Blokhaken ongeëncodeeerd
  const base = new URLSearchParams({
    list_id: '2fueysjced',
    email: 'test.server2.imajuku@mailinator.com',
    ip: '1.2.3.4',
    source_url: 'https://imajuku.nl/proefles',
  }).toString();

  const fields = {
    voornaam: 'Server', achternaam: 'Test', leeftijd: '30',
    geslacht: 'Man', ikbenstudent: 'Nee', telefoonnumer: '0600000000',
    locatie: 'Zeist', proefles1datum: '2026-07-01', proefles2datum: '2026-07-08',
    motivatiewaaromaikido: 'Server test', opmerking: '',
  };

  const fieldPart = Object.entries(fields)
    .map(([k, v]) => `fields[${k}]=${encodeURIComponent(v)}`)
    .join('&');

  const payload = base + '&' + fieldPart;

  const resp = await fetch('https://api.laposta.nl/v2/member', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload,
  });

  const result = await resp.json().catch(() => ({}));
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ laposta_status: resp.status, laposta_response: result, payload });
};
