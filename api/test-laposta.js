module.exports = async function handler(req, res) {
  const apiKey = process.env.LAPOSTA_API_KEY;

  const body = new URLSearchParams({
    list_id: '2fueysjced',
    email: 'test.server.imajuku@mailinator.com',
    ip: '1.2.3.4',
    source_url: 'https://imajuku.nl/proefles',
    'fields[voornaam]': 'Server',
    'fields[achternaam]': 'Test',
    'fields[leeftijd]': '30',
    'fields[geslacht]': 'Man',
    'fields[ikbenstudent]': 'Nee',
    'fields[telefoonnumer]': '0600000000',
    'fields[locatie]': 'Zeist',
    'fields[proefles1datum]': '2026-07-01',
    'fields[proefles2datum]': '2026-07-08',
    'fields[motivatiewaaromaikido]': 'Server test',
    'fields[opmerking]': '',
  });

  const resp = await fetch('https://api.laposta.nl/v2/member', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const result = await resp.json().catch(() => ({}));

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    laposta_status: resp.status,
    laposta_response: result,
    payload: body.toString(),
  });
};
