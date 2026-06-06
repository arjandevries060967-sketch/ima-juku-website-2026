(function () {
  const STORAGE_KEY = 'imaJukuCookieConsent.v1';

  const defaultConsent = {
    necessary: true,
    maps: false,
  };

  function readConsent() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...defaultConsent, ...JSON.parse(saved) } : null;
    } catch (error) {
      return null;
    }
  }

  function saveConsent(consent) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...defaultConsent,
      ...consent,
      savedAt: new Date().toISOString(),
    }));
  }

  function loadMaps() {
    document.querySelectorAll('[data-cookie-category="maps"]').forEach((iframe) => {
      if (!iframe.dataset.src || iframe.src) return;
      iframe.src = iframe.dataset.src;
      const placeholder = iframe.parentElement?.querySelector('.cookie-placeholder');
      if (placeholder) placeholder.remove();
      iframe.removeAttribute('hidden');
    });
  }

  function blockMaps() {
    document.querySelectorAll('[data-cookie-category="maps"]').forEach((iframe) => {
      if (!iframe.hasAttribute('hidden')) iframe.setAttribute('hidden', '');
      const parent = iframe.parentElement;
      if (!parent || parent.querySelector('.cookie-placeholder')) return;

      const placeholder = document.createElement('div');
      placeholder.className = 'cookie-placeholder';
      placeholder.innerHTML = `
        <strong>Kaart niet geladen</strong>
        <p>Deze kaart wordt via een externe kaartdienst geladen. Geef toestemming voor kaartdiensten om de kaart te bekijken.</p>
        <button class="cookie-button" type="button" data-cookie-load-maps>Kaart laden</button>
      `;
      parent.prepend(placeholder);
    });
  }

  function applyConsent(consent) {
    if (consent?.maps) loadMaps();
    else blockMaps();
  }

  function createBanner() {
    if (document.getElementById('cookie-banner')) return;

    const banner = document.createElement('section');
    banner.id = 'cookie-banner';
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-labelledby', 'cookie-title');
    banner.innerHTML = `
      <h2 id="cookie-title">Cookies en externe diensten</h2>
      <p>
        Ima Juku gebruikt noodzakelijke opslag om je cookievoorkeur te onthouden. Externe kaartdiensten laden we pas na jouw toestemming.
        We gebruiken geen advertentie- of trackingcookies. Lees meer in het <a href="cookiebeleid.html">cookiebeleid</a>.
      </p>
      <div class="cookie-actions">
        <button class="cookie-button" type="button" data-cookie-reject>Alleen noodzakelijke</button>
        <button class="cookie-button" type="button" data-cookie-preferences>Voorkeuren</button>
        <button class="cookie-button primary" type="button" data-cookie-accept>Alles accepteren</button>
      </div>
      <div class="cookie-preferences" hidden>
        <label class="cookie-option">
          <input type="checkbox" checked disabled>
          <span><strong>Noodzakelijk</strong> Nodig om je keuze te onthouden en de site te laten werken.</span>
        </label>
        <label class="cookie-option">
          <input type="checkbox" data-cookie-maps>
          <span><strong>Kaartdiensten</strong> Laadt externe kaarten voor de trainingslocaties. De kaartdienst kan daarbij gegevens zoals je IP-adres ontvangen.</span>
        </label>
        <div class="cookie-actions">
          <button class="cookie-button" type="button" data-cookie-save>Voorkeuren opslaan</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);
  }

  function createSettingsButton() {
    if (document.getElementById('cookie-settings-button')) return;

    const button = document.createElement('button');
    button.id = 'cookie-settings-button';
    button.className = 'cookie-settings-button';
    button.type = 'button';
    button.textContent = 'Cookie-instellingen';
    document.body.appendChild(button);
  }

  function createBackToTopButton() {
    if (document.getElementById('back-to-top-button')) return;

    const button = document.createElement('button');
    button.id = 'back-to-top-button';
    button.className = 'back-to-top-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Terug naar boven');
    button.title = 'Terug naar boven';
    button.textContent = '↑';
    document.body.appendChild(button);

    const updateVisibility = () => {
      button.classList.toggle('zichtbaar', window.scrollY > 520);
    };

    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
  }

  function showBanner() {
    createBanner();
    const banner = document.getElementById('cookie-banner');
    const consent = readConsent() || defaultConsent;
    const mapsInput = banner.querySelector('[data-cookie-maps]');
    mapsInput.checked = Boolean(consent.maps);
    banner.hidden = false;
  }

  function hideBanner() {
    const banner = document.getElementById('cookie-banner');
    if (banner) banner.hidden = true;
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.matches('[data-cookie-accept]')) {
      const consent = { necessary: true, maps: true };
      saveConsent(consent);
      applyConsent(consent);
      hideBanner();
    }

    if (target.matches('[data-cookie-reject]')) {
      const consent = { necessary: true, maps: false };
      saveConsent(consent);
      applyConsent(consent);
      hideBanner();
    }

    if (target.matches('[data-cookie-preferences]')) {
      const panel = document.querySelector('.cookie-preferences');
      if (panel) panel.hidden = !panel.hidden;
    }

    if (target.matches('[data-cookie-save]')) {
      const maps = Boolean(document.querySelector('[data-cookie-maps]')?.checked);
      const consent = { necessary: true, maps };
      saveConsent(consent);
      applyConsent(consent);
      hideBanner();
    }

    if (target.matches('#cookie-settings-button, [data-cookie-settings]')) {
      showBanner();
    }

    if (target.matches('#back-to-top-button')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (target.matches('[data-cookie-load-maps]')) {
      const consent = { necessary: true, maps: true };
      saveConsent(consent);
      applyConsent(consent);
      hideBanner();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    createSettingsButton();
    createBackToTopButton();
    const consent = readConsent();
    applyConsent(consent || defaultConsent);
    if (!consent) showBanner();
  });
}());
