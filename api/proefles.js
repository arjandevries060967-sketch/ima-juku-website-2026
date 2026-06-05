/**
 * Vercel serverless function: proefles aanmelding → Laposta
 * Vereiste env var in Vercel: LAPOSTA_API_KEY
 * Optioneel voor Gmail-concept: OPENAI_API_KEY, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 * GMAIL_REFRESH_TOKEN, GMAIL_DRAFT_FROM
 *
 * Payload wordt volledig handmatig gebouwd met ongeëncodeerde blokhaken,
 * zoals Laposta vereist: custom_fields[voornaam]=Waarde
 */

const LIST_ID    = '2fueysjced';
const LAPOSTA_API = 'https://api.laposta.nl/v2/member';

const WEEKDAYS = [
  'zondag',
  'maandag',
  'dinsdag',
  'woensdag',
  'donderdag',
  'vrijdag',
  'zaterdag',
];

const CLOSED_PERIODS = [
  {
    name: 'zomervakantie',
    start: '2026-07-17',
    end: '2026-08-30',
  },
  {
    name: 'kerstvakantie',
    start: '2026-12-19',
    end: '2027-01-03',
  },
];

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
    if (Array.isArray(val)) {
      // Checkbox/multi-select: stuur als custom_fields[key][]=waarde
      for (const v of val) {
        parts.push(`custom_fields[${key}][]=${enc(v)}`);
      }
    } else {
      parts.push(`custom_fields[${key}]=${enc(val)}`);
    }
  }
  return parts.join('&');
}

function parseDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function formatDateNl(value) {
  const date = parseDateValue(value);
  if (!date) return value || 'geen datum';
  return new Intl.DateTimeFormat('nl-NL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function todayUtcDateOnly() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function getClosedPeriod(date) {
  if (!date) return null;
  return CLOSED_PERIODS.find(period => {
    const start = parseDateValue(period.start);
    const end = parseDateValue(period.end);
    return start && end && date >= start && date <= end;
  }) || null;
}

function getAllowedWeekdays(locaties) {
  const allowed = new Set();
  if (locaties.some(locatie => locatie.toLowerCase().includes('zeist'))) allowed.add(1);
  if (locaties.some(locatie => locatie.toLowerCase().includes('baarn'))) allowed.add(4);
  return allowed;
}

function analyseTrialDates({ locaties, dates }) {
  const allowedWeekdays = getAllowedWeekdays(locaties);
  const fallbackAllowed = new Set([1, 4]);
  const activeAllowed = allowedWeekdays.size ? allowedWeekdays : fallbackAllowed;

  return dates.map(({ label, value }) => {
    const date = parseDateValue(value);
    const weekday = date ? date.getUTCDay() : null;
    const isPast = date ? date < todayUtcDateOnly() : false;
    const closedPeriod = getClosedPeriod(date);
    const validWeekday = weekday !== null && activeAllowed.has(weekday);
    return {
      label,
      value,
      formatted: formatDateNl(value),
      weekdayName: weekday === null ? 'onbekend' : WEEKDAYS[weekday],
      closedPeriodName: closedPeriod?.name || null,
      invalidReason: isPast ? 'past' : closedPeriod ? 'closed' : validWeekday ? null : 'weekday',
      valid: !isPast && !closedPeriod && validWeekday,
    };
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function invalidDateSummary(item) {
  if (item.invalidReason === 'past') {
    return `${item.formatted} ligt in het verleden`;
  }
  if (item.invalidReason === 'closed') {
    return `${item.formatted} valt in de ${item.closedPeriodName}`;
  }
  return `${item.formatted} valt op een ${item.weekdayName}`;
}

function buildDateWarningText(dateAnalysis) {
  const invalidDates = dateAnalysis.filter(item => !item.valid);
  if (!invalidDates.length) return '';
  return `Let op: ${invalidDates.map(invalidDateSummary).join(' en ')}. Een proefles kan alleen op maandag in Zeist of donderdag in Baarn, buiten de vakantieperiodes.`;
}

function buildDateLines(dateAnalysis) {
  return dateAnalysis
    .map(item => `${item.formatted}${item.valid ? '' : ' (niet mogelijk)'}`)
    .join('\n');
}

async function generatePersonalNote({ data, locaties, dateAnalysis }) {
  const opmerking = (data['kjrtQYYCLh'] || '').trim();
  const motivatie = (data['f9g5G3RavQ'] || '').trim();
  const isStudent = (data['wQHcc605z4'] || '').toLowerCase() === 'ja';
  const invalidWarning = buildDateWarningText(dateAnalysis);
  const studentNote = isStudent
    ? 'Ik zie dat je hebt aangegeven dat je student bent. Voor studenten gelden aangepaste lesgelden; dat tarief is lager dan het reguliere tarief.'
    : '';
  if (!process.env.OPENAI_API_KEY || (!motivatie && !opmerking && !invalidWarning && !studentNote)) {
    if (!motivatie && !opmerking && !invalidWarning && !studentNote) return '';
    return [
      motivatie ? `Mooi om te lezen waarom je Aikido wilt proberen: "${motivatie}".` : '',
      opmerking ? `Ik lees ook je opmerking: "${opmerking}". Geef dit bij binnenkomst gerust nog even aan, dan kunnen we daar op de mat zorgvuldig rekening mee houden.` : '',
      studentNote,
      invalidWarning,
    ].filter(Boolean).join('\n\n');
  }

  const prompt = `
Schrijf een korte, warme concept-alinea voor een e-mail aan iemand die een proefles Aikido bij Ima Juku heeft aangevraagd.

Context:
- Naam: ${data['VCQticEHHg'] || ''}
- Locatievoorkeur: ${locaties.join(', ') || 'niet opgegeven'}
- Gekozen data:
${buildDateLines(dateAnalysis)}
- Datumwaarschuwing: ${invalidWarning || 'geen'}
- Student: ${isStudent ? 'ja' : 'nee of niet opgegeven'}
- Waarom wil iemand Aikido doen: ${motivatie || 'geen'}
- Opmerking van aanvrager: ${opmerking || 'geen'}

Regels:
- Schrijf in het Nederlands.
- Spreek de aanvrager persoonlijk, rustig en natuurlijk aan alsof Arjan zelf reageert.
- Als er een motivatie staat bij "Waarom wil je Aikido doen?": schrijf daar een persoonlijke zin over die laat merken dat de motivatie echt gelezen is. Herhaal niet letterlijk te veel woorden.
- Als er een opmerking staat: reageer daar warm en concreet op. Maak het niet zakelijk; het mag voelen als een persoonlijke uitnodiging.
- Geef geen medische diagnose of medisch advies.
- Als er een blessure of gezondheidsopmerking staat: erken dat voorzichtig, zeg dat we daar op de mat rekening mee kunnen houden, dat iemand binnen eigen grenzen traint, en dat overleg met arts/fysiotherapeut verstandig is bij twijfel.
- Als er een datumwaarschuwing is: noem die helder en vraag om een nieuwe passende datum.
- Als de aanvrager student is: noem dat er aangepaste lesgelden voor studenten gelden en dat dit goedkoper is dan het reguliere tarief. Noem geen bedrag.
- Schrijf maximaal twee korte alinea's.
- Maximaal 150 woorden.
`.trim();

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input: prompt,
      max_output_tokens: 220,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI conceptfout ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return result.output_text || result.output?.flatMap(item => item.content || [])
    .map(part => part.text || '')
    .join('')
    .trim();
}

async function buildTeacherDraftMail({ data, locaties, dateAnalysis }) {
  const invalidDates = dateAnalysis.filter(item => !item.valid);
  const hasInvalidDates = invalidDates.length > 0;
  const firstName = data['VCQticEHHg'] || 'daar';
  let personalNote = '';
  try {
    personalNote = await generatePersonalNote({ data, locaties, dateAnalysis });
  } catch (noteErr) {
    console.error('AI-persoonlijke alinea mislukt, fallback gebruikt:', noteErr);
    const opmerking = (data['kjrtQYYCLh'] || '').trim();
    const motivatie = (data['f9g5G3RavQ'] || '').trim();
    const isStudent = (data['wQHcc605z4'] || '').toLowerCase() === 'ja';
    personalNote = [
      motivatie ? `Mooi om te lezen waarom je Aikido wilt proberen: "${motivatie}".` : '',
      opmerking ? `Ik lees ook je opmerking: "${opmerking}". Geef dit bij binnenkomst gerust nog even aan, dan kunnen we daar op de mat zorgvuldig rekening mee houden.` : '',
      isStudent ? 'Ik zie dat je hebt aangegeven dat je student bent. Voor studenten gelden aangepaste lesgelden; dat tarief is lager dan het reguliere tarief.' : '',
      buildDateWarningText(dateAnalysis),
    ].filter(Boolean).join('\n\n');
  }
  const dateLines = dateAnalysis.map(item => item.formatted).join('\n');
  const dateHtml = dateAnalysis.map(item => `<li>${escapeHtml(item.formatted)}${item.valid ? '' : ' <strong>(controle nodig)</strong>'}</li>`).join('');
  const subject = `Proeflesreactie - ${data['VCQticEHHg'] || ''} ${data['FEqqKfvEJN'] || ''}`.trim();
  const opmerking = (data['kjrtQYYCLh'] || '').trim();
  const motivatie = (data['f9g5G3RavQ'] || '').trim();

  const text = `Beste ${firstName},

Je hebt je ingeschreven voor twee gratis proeflessen Aikido. Misschien is dit wel de stap die een positieve verandering in je leven brengt.

${personalNote ? `${personalNote}\n\n` : ''}Locaties staan onderaan deze mail.

Data
${dateLines}

Voorbereiding & binnenkomst (graag 19.25 uur aanwezig)

Meld je even bij de leraar Arjan en maak kennis met de aanwezige leden.
Sieraden af i.v.m. veiligheid (Aikido is een contactsport).
In de kleedkamer: schoenen uit, wisselen voor slippers of sokken; jas ophangen, tas laten staan.
In de zaal: vraag wie de leraar is en meld je bij hem (Arjan).
We leggen samen de mat (meestal in tweetallen); daarna gaat iedereen zich omkleden.

Kledingadvies

Trainingsbroek (zonder ritsen) of legging en t-shirt zijn perfect!

Training (19.45-21.30)

- Na het omkleden kom je rustig terug de zaal in. Zet je slippers bij de rand en stap zonder slippers of sokken de mat op.
- We nemen even de tijd om kennis te maken en groeten daarna samen aan het begin van de les.
- Je hoeft nog niets te kunnen. Je kijkt mee met de groep en krijgt begeleiding van een van de assistenten.
- De warming-up duurt ongeveer 15 minuten en is gericht op soepel bewegen, flexibiliteit en lichte kernversterking. We doen geen conditie- of zware krachtoefeningen.
- Daarna oefenen we Aikido-technieken, meestal in tweetallen. Na elke uitleg wisselen we van partner, zodat je rustig met verschillende mensen kunt oefenen.
- 21.00 uur: reguliere les klaar, gevolgd door 30 minuten vrij trainen.
- 21.30 uur: we groeten af.

Na afloop

We poetsen en ruimen de matten samen op.
Daarna omkleden en naar huis.

Locaties

Zeist - maandag
Noordweg 10 (gemeentelijke gymzaal)
Herenkleedkamer: direct links bij binnenkomst
Dameskleedkamer: einde gang, linker deur

Baarn - donderdag
Begoniastraat 4 (gemeentelijke gymzaal)
Herenkleedkamer: links bij binnenkomst
Dameskleedkamer: rechts bij binnenkomst

Tot snel in de dojo! We kijken er naar uit om je te mogen ontvangen!

Vriendelijke groet,

Arjan de Vries
Ima Juku Aikido leraar en oprichter (6de dan)

---
Interne controle:
Naam: ${data['VCQticEHHg'] || ''} ${data['FEqqKfvEJN'] || ''}
E-mail: ${data['PI6DA7TLP7'] || ''}
Telefoon: ${data['zZH7Jm1GrV'] || ''}
Locatievoorkeur: ${locaties.join(', ') || 'niet opgegeven'}
Student: ${data['wQHcc605z4'] || 'niet opgegeven'}
Waarom Aikido: ${motivatie || 'geen'}
Opmerking: ${opmerking || 'geen'}
Datumcontrole: ${hasInvalidDates ? buildDateWarningText(dateAnalysis) : 'geen bijzonderheden'}`;

  const html = `
    <p>Beste ${escapeHtml(firstName)},</p>
    <p>Je hebt je ingeschreven voor twee gratis proeflessen Aikido. Misschien is dit wel de stap die een positieve verandering in je leven brengt.</p>
    ${personalNote ? `<p>${escapeHtml(personalNote).replace(/\n/g, '<br>')}</p>` : ''}
    <p>Locaties staan onderaan deze mail.</p>

    <h3>Data</h3>
    <ul>${dateHtml}</ul>

    <h3>Voorbereiding &amp; binnenkomst (graag 19.25 uur aanwezig)</h3>
    <ul>
      <li>Meld je even bij de leraar Arjan en maak kennis met de aanwezige leden.</li>
      <li>Sieraden af i.v.m. veiligheid (Aikido is een contactsport).</li>
      <li>In de kleedkamer: schoenen uit, wisselen voor slippers of sokken; jas ophangen, tas laten staan.</li>
      <li>In de zaal: vraag wie de leraar is en meld je bij hem (Arjan).</li>
      <li>We leggen samen de mat; daarna gaat iedereen zich omkleden.</li>
    </ul>

    <h3>Kledingadvies</h3>
    <p>Trainingsbroek (zonder ritsen) of legging en t-shirt zijn perfect!</p>

    <h3>Training (19.45-21.30)</h3>
    <ul>
      <li>Na het omkleden kom je rustig terug de zaal in. Zet je slippers bij de rand en stap zonder slippers of sokken de mat op.</li>
      <li>We nemen even de tijd om kennis te maken en groeten daarna samen aan het begin van de les.</li>
      <li>Je hoeft nog niets te kunnen. Je kijkt mee met de groep en krijgt begeleiding van een van de assistenten.</li>
      <li>De warming-up duurt ongeveer 15 minuten en is gericht op soepel bewegen, flexibiliteit en lichte kernversterking. We doen geen conditie- of zware krachtoefeningen.</li>
      <li>Daarna oefenen we Aikido-technieken, meestal in tweetallen. Na elke uitleg wisselen we van partner, zodat je rustig met verschillende mensen kunt oefenen.</li>
      <li>21.00 uur: reguliere les klaar, gevolgd door 30 minuten vrij trainen.</li>
      <li>21.30 uur: we groeten af.</li>
    </ul>

    <h3>Na afloop</h3>
    <p>We poetsen en ruimen de matten samen op. Daarna omkleden en naar huis.</p>

    <h3>Locaties</h3>
    <p><strong>Zeist - maandag</strong><br>Noordweg 10 (gemeentelijke gymzaal)<br>Herenkleedkamer: direct links bij binnenkomst<br>Dameskleedkamer: einde gang, linker deur</p>
    <p><strong>Baarn - donderdag</strong><br>Begoniastraat 4 (gemeentelijke gymzaal)<br>Herenkleedkamer: links bij binnenkomst<br>Dameskleedkamer: rechts bij binnenkomst</p>

    <p>Tot snel in de dojo! We kijken er naar uit om je te mogen ontvangen!</p>
    <p>Vriendelijke groet,<br><br>Arjan de Vries<br>Ima Juku Aikido leraar en oprichter (6de dan)</p>

    <hr>
    <p><strong>Interne controle voor Arjan:</strong><br>
    Naam: ${escapeHtml(`${data['VCQticEHHg'] || ''} ${data['FEqqKfvEJN'] || ''}`.trim())}<br>
    E-mail: ${escapeHtml(data['PI6DA7TLP7'])}<br>
    Telefoon: ${escapeHtml(data['zZH7Jm1GrV'])}<br>
    Locatievoorkeur: ${escapeHtml(locaties.join(', ') || 'niet opgegeven')}<br>
    Student: ${escapeHtml(data['wQHcc605z4'] || 'niet opgegeven')}<br>
    Waarom Aikido: ${escapeHtml(motivatie || 'geen')}<br>
    Opmerking: ${escapeHtml(opmerking || 'geen')}<br>
    Datumcontrole: ${escapeHtml(hasInvalidDates ? buildDateWarningText(dateAnalysis) : 'geen bijzonderheden')}</p>
  `;

  return { subject, text, html };
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const boundary = `ima-juku-${Date.now()}`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n');
}

async function getGmailAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.log('Gmail-concept overgeslagen: Gmail OAuth-variabelen ontbreken');
    return null;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gmail tokenfout ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  return result.access_token;
}

async function createGmailDraft({ to, mail }) {
  const from = process.env.GMAIL_DRAFT_FROM || 'info@imajuku.nl';
  const accessToken = await getGmailAccessToken();
  if (!accessToken || !to) {
    return;
  }

  const raw = base64Url(buildMimeMessage({
    from,
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  }));

  const userId = encodeURIComponent(process.env.GMAIL_DRAFT_USER || 'me');
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${userId}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gmail conceptfout ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function createTeacherDraftSafely({ data, locaties, dateAnalysis, reason }) {
  try {
    const draftMail = await buildTeacherDraftMail({ data, locaties, dateAnalysis });
    const draft = await createGmailDraft({ to: data['PI6DA7TLP7'], mail: draftMail });
    if (!draft) {
      console.log('Gmail-concept proefles overgeslagen', JSON.stringify({ reason }));
      return;
    }
    console.log('Gmail-concept proefles aangemaakt', JSON.stringify({
      draftId: draft?.id || null,
      reason,
    }));
  } catch (draftErr) {
    console.error('Gmail-concept proefles mislukt:', draftErr);
  }
}

function isLapostaDuplicate(result) {
  const code = result?.error?.code;
  const message = JSON.stringify(result || {});
  return (
    code === 204 ||
    code === '204' ||
    /already|duplicate|exists|bestaat al|staat al|member/i.test(message)
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    const raw = await readBody(req);
    const d   = parseBody(raw);


    const locatieRaw = d['Y8OEFhf1ac[]'];
    // Altijd als array, ook bij één keuze — Laposta checkbox-veld vereist array-notatie
    const locaties = Array.isArray(locatieRaw)
      ? locatieRaw
      : locatieRaw ? [locatieRaw] : [];
    const dateAnalysis = analyseTrialDates({
      locaties,
      dates: [
        { label: 'Proefles 1', value: d['PcvLnGah3B'] || '' },
        { label: 'Proefles 2', value: d['FevVlZuZWq'] || '' },
      ],
    });
    await createTeacherDraftSafely({ data: d, locaties, dateAnalysis, reason: 'form-submit' });

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
    if (isLapostaDuplicate(result)) {
      return res.redirect(302, '/bedankt?al=1');
    }

    console.error('Laposta fout:', lapostaRes.status, JSON.stringify(result));
    return res.redirect(302, '/proefles?fout=1');

  } catch (err) {
    console.error('Onverwachte fout:', err);
    return res.redirect(302, '/proefles?fout=1');
  }
};
