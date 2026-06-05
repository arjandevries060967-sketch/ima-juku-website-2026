/**
 * Vercel serverless function: proefles aanmelding → Laposta
 * Vereiste env var in Vercel: LAPOSTA_API_KEY
 * Optioneel voor automatische mail: SMTP_USER, SMTP_PASS, PROEFLES_MAIL_FROM, PROEFLES_REPLY_TO, PROEFLES_NOTIFY_EMAIL
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

function buildTrialMail({ data, locaties, dateAnalysis }) {
  const invalidDates = dateAnalysis.filter(item => !item.valid);
  const hasInvalidDates = invalidDates.length > 0;
  const firstName = data['VCQticEHHg'] || 'daar';
  const subject = hasInvalidDates
    ? 'Je proeflesaanvraag bij Ima Juku: let op je gekozen datum'
    : 'Je proeflesaanvraag bij Ima Juku is ontvangen';

  const dateLines = dateAnalysis
    .map(item => `- ${item.label}: ${item.formatted}${item.valid ? '' : ' (niet mogelijk)'}`)
    .join('\n');

  const warningText = hasInvalidDates
    ? `\nLet op: ${invalidDates.map(item => {
      if (item.invalidReason === 'past') return `je hebt ${item.formatted} gekozen, maar die datum ligt in het verleden`;
      if (item.invalidReason === 'closed') return `je hebt ${item.formatted} gekozen, maar dan is de dojo gesloten vanwege de ${item.closedPeriodName}`;
      return `je hebt ${item.weekdayName} ${item.formatted} gekozen`;
    }).join(' en ')}. Kies alvast een nieuwe datum: een proefles kan alleen op maandag in Zeist of donderdag in Baarn, buiten de vakantieperiodes.\n\nWe nemen persoonlijk contact met je op om de proefles definitief af te stemmen.\n`
    : '\nJe gekozen data vallen op een mogelijke trainingsavond. We nemen persoonlijk contact met je op om de datum definitief te bevestigen.\n';

  const text = `Beste ${firstName},

Dank je wel voor je aanvraag voor een proefles bij Ima Juku.
${warningText}
Je aanvraag:
Naam: ${data['VCQticEHHg'] || ''} ${data['FEqqKfvEJN'] || ''}
E-mail: ${data['PI6DA7TLP7'] || ''}
Telefoon: ${data['zZH7Jm1GrV'] || ''}
Locatievoorkeur: ${locaties.join(', ') || 'niet opgegeven'}
${dateLines}

Hartelijke groet,
Ima Juku Aikido`;

  const html = `
    <p>Beste ${escapeHtml(firstName)},</p>
    <p>Dank je wel voor je aanvraag voor een proefles bij Ima Juku.</p>
    ${hasInvalidDates
      ? `<p><strong>Let op:</strong> ${escapeHtml(invalidDates.map(item => {
        if (item.invalidReason === 'past') return `je hebt ${item.formatted} gekozen, maar die datum ligt in het verleden`;
        if (item.invalidReason === 'closed') return `je hebt ${item.formatted} gekozen, maar dan is de dojo gesloten vanwege de ${item.closedPeriodName}`;
        return `je hebt ${item.weekdayName} ${item.formatted} gekozen`;
      }).join(' en '))}. Kies alvast een nieuwe datum: een proefles kan alleen op maandag in Zeist of donderdag in Baarn, buiten de vakantieperiodes.</p><p>We nemen persoonlijk contact met je op om de proefles definitief af te stemmen.</p>`
      : '<p>Je gekozen data vallen op een mogelijke trainingsavond. We nemen persoonlijk contact met je op om de datum definitief te bevestigen.</p>'
    }
    <p><strong>Je aanvraag:</strong></p>
    <ul>
      <li>Naam: ${escapeHtml(`${data['VCQticEHHg'] || ''} ${data['FEqqKfvEJN'] || ''}`.trim())}</li>
      <li>E-mail: ${escapeHtml(data['PI6DA7TLP7'])}</li>
      <li>Telefoon: ${escapeHtml(data['zZH7Jm1GrV'])}</li>
      <li>Locatievoorkeur: ${escapeHtml(locaties.join(', ') || 'niet opgegeven')}</li>
      ${dateAnalysis.map(item => `<li>${escapeHtml(item.label)}: ${escapeHtml(item.formatted)}${item.valid ? '' : ' <strong>(niet mogelijk)</strong>'}</li>`).join('')}
    </ul>
    <p>Hartelijke groet,<br>Ima Juku Aikido</p>
  `;

  return { subject, text, html, hasInvalidDates };
}

async function sendTrialMail({ to, mail }) {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.PROEFLES_MAIL_FROM;
  if (!user || !pass || !from || !to) {
    console.log('Automatische proeflesmail overgeslagen: SMTP_USER, SMTP_PASS, PROEFLES_MAIL_FROM of ontvanger ontbreekt');
    return;
  }

  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.transip.email',
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const message = {
    from,
    to,
    replyTo: process.env.PROEFLES_REPLY_TO || 'info@imajuku.nl',
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  };

  if (process.env.PROEFLES_NOTIFY_EMAIL) {
    message.bcc = process.env.PROEFLES_NOTIFY_EMAIL;
  }

  await transporter.sendMail(message);
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
      const mail = buildTrialMail({ data: d, locaties, dateAnalysis });
      try {
        await sendTrialMail({ to: d['PI6DA7TLP7'], mail });
        console.log('Automatische proeflesmail verstuurd', JSON.stringify({
          hasInvalidDates: mail.hasInvalidDates,
        }));
      } catch (mailErr) {
        console.error('Automatische proeflesmail mislukt:', mailErr);
      }
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
