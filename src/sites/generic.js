// generic.js — Universal directory submission adapter using bb-browser
// Works with any directory site by auto-detecting form fields via snapshot

import { withBrowser, delay } from '../browser.js';

// Field detection patterns (reused from batch-submit.js proven selectors)
const FIELD_PATTERNS = {
  name: /name|title|product|app.?name|tool.?name/i,
  url: /url|website|link|homepage|site/i,
  email: /email|mail|e-mail/i,
  description: /desc|description|about|summary|detail|intro/i,
};

const SUBMIT_PATTERNS = /submit|send|add|post|create|list|suggest|save/i;

/**
 * Parse bb-browser snapshot output to find interactive elements
 * Snapshot format: lines like "@3 [textbox] Name ..." or "@7 [button] Submit"
 */
export function parseSnapshot(snapshot) {
  const fields = { name: null, url: null, email: null, description: null, category: null, submit: null, pricingRadios: [] };
  const lines = snapshot.split('\n');

  let lastLabel = ''; // bb-browser 0.14 emits the human label and the textbox on separate rows
  for (const line of lines) {
    // bb-browser 0.14 snap -i format: "<role> [ref=N] \"<label>\""
    const refMatch = line.match(/^(\w+)\s+\[ref=(\d+)\]\s*"?(.*?)"?\s*$/);
    if (!refMatch) continue;

    const [, role, refNum, label] = refMatch;
    const ref = '@' + refNum;
    const labelLower = label.toLowerCase();

    if (role === 'label') { lastLabel = labelLower; continue; }

    // For textbox/combobox, prefer the preceding label (field name) over the
    // placeholder — bb-browser 0.14 puts the human label on its own row.
    const labelText = (lastLabel || labelLower);

    // Text fields. Name: prefer specific (tool/product/app name) over generic
    // "Your Name" — hold generic as a fallback, let specific win.
    if (role === 'textbox' || role === 'combobox') {
      if (/tool.?name|product.?name|app.?name/i.test(labelText)) fields.name = ref;
      else if (/\bname\b/i.test(labelText) && !fields._nameFallback) fields._nameFallback = ref;
      else if (!fields.url && FIELD_PATTERNS.url.test(labelText)) fields.url = ref;
      else if (!fields.email && FIELD_PATTERNS.email.test(labelText)) fields.email = ref;
      else if (!fields.description && FIELD_PATTERNS.description.test(labelText)) fields.description = ref;
      // Category dropdown
      if (role === 'combobox' && /categor/i.test(labelText) && !fields.category) fields.category = ref;
      lastLabel = '';
    }

    // Pricing radios (free/freemium/paid) — collect all, pick the match at submit time
    if (role === 'radio' && /free|freemium|paid|premium/i.test(labelLower)) {
      fields.pricingRadios.push({ ref, value: labelLower });
    }

    // Match submit button
    if ((role === 'button' || role === 'link') && SUBMIT_PATTERNS.test(labelLower)) {
      if (!fields.submit) fields.submit = ref;
    }
  }

  // Fallback: if no specific tool/product name field, use the generic "name" one
  if (!fields.name && fields._nameFallback) fields.name = fields._nameFallback;
  delete fields._nameFallback;

  return fields;
}

/**
 * Try "Login with Google" — reuse the browser's existing Google session
 * (the browser must already be logged into a Google account).
 * Flow: click Login-with-Google → Google accountchooser (select account)
 *       → consent (Continue) → back to site (logged in).
 * Returns true if the OAuth flow ran (regardless of site-side callback success).
 */
async function tryGoogleLogin(page) {
  const found = await page.eval(`(()=>{const l=[...document.querySelectorAll('a,button')].find(e=>/login with google|sign in with google|continue with google|google\\s*登录|使用\\s*google/i.test(e.textContent));if(!l)return 'no-google-login';if(l.href){location.href=l.href}else{l.click()}return 'clicked'})()`);
  if (found === 'no-google-login') return false;
  console.log('  🔑 Found "Login with Google" — running OAuth flow...');
  await delay(6000); // redirect to Google accountchooser

  // accountchooser: click the logged-in account
  await page.eval(`(()=>{const acc=document.querySelector('[data-identifier],[data-email],li[data-email],div[data-identifier]');if(acc){acc.click();return 'account-selected'}return 'no-account'})()`);
  await delay(6000); // → consent page

  // consent: click Continue/Allow/Approve
  await page.eval(`(()=>{const b=[...document.querySelectorAll('button,div[role=button]')].find(b=>/continue|继续|allow|允许|agree|同意|approve|授权/i.test(b.textContent));if(b){b.click();return 'consent'}return 'no-consent'})()`);
  await delay(6000); // → back to site (logged in, hopefully)

  return true;
}

/**
 * React-style form fill — when bb-browser snap can't detect fields (React inputs
 * often aren't labeled as 'textbox' role), discover inputs via placeholder/name/
 * aria-label and fill using the native value setter + input event (React-compatible).
 * Returns count of fields filled.
 */
async function tryReactFill(page, product) {
  const inputsJson = await page.eval(`JSON.stringify([...document.querySelectorAll('input[type=text],input[type=email],input[type=url],textarea')].map((el,i)=>({i,ph:el.placeholder||'',n:el.name||'',t:el.type,al:el.getAttribute('aria-label')||''})))`);
  let inputs = [];
  try { inputs = JSON.parse(inputsJson); } catch {}
  if (!inputs.length) return 0;

  const patterns = {
    name: /name|title|product|tool/i,
    url: /url|website|link|homepage|site/i,
    email: /email|mail/i,
    description: /desc|description|about|summary|detail|intro/i,
  };
  const used = new Set();
  let filled = 0;
  for (const [field, re] of Object.entries(patterns)) {
    const value = field === 'name' ? product.name
      : field === 'url' ? (product.utm_url || product.url)
      : field === 'email' ? product.email
      : (product.long_description || product.description);
    if (!value) continue;
    const match = inputs.find(inp => !used.has(inp.i) && re.test((inp.ph + ' ' + inp.n + ' ' + inp.al).toLowerCase()));
    if (!match) continue;
    used.add(match.i);
    const res = await page.eval(`((idx, val) => {
      const els = [...document.querySelectorAll('input[type=text],input[type=email],input[type=url],textarea')];
      const el = els[idx]; if (!el) return 'no-el';
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'filled';
    })(${match.i}, ${JSON.stringify(value)})`);
    if (res === 'filled') { console.log(`  ✏️  React fill ${field}`); filled++; }
  }
  return filled;
}

export default {
  name: 'generic',
  url: null,
  auth: 'none',
  captcha: 'none',
  engine: 'bb', // forces bb-browser

  async submit(product, config) {
    const targetUrl = config._genericUrl || config._targetUrl;
    if (!targetUrl) throw new Error('No target URL provided for generic submission');

    return withBrowser({ ...config, _engine: 'bb' }, async ({ page }) => {
      // 1. Navigate to submission page
      console.log(`  📄 Opening ${targetUrl}`);
      await page.goto(targetUrl);
      // Wait for the form to render — many AI directories load the form via JS,
      // so a fixed 2s delay misses it. Poll up to ~10s for any form element.
      for (let i = 0; i < 10; i++) {
        await delay(1000);
        if (await page.$('input, textarea, form').catch(() => null)) break;
      }
      await delay(1000);

      // 1.5. Validate page — check for dead/login/paid pages
      const pageUrl = typeof page.url === 'function' ? page.url() : '';
      const pageTitle = await page.textContent('title').catch(() => '');
      const bodyText = await page.textContent('body').catch(() => '');
      const bodySnippet = bodyText.substring(0, 500).toLowerCase();

      if (/404|not found|page not found/.test(bodySnippet) || /404/.test(pageTitle)) {
        throw new Error(`Page returned 404 — submit URL may have changed. Check the site root.`);
      }
      if (/500|server error|internal error/.test(bodySnippet)) {
        throw new Error(`Page returned 500 Server Error — site may be down.`);
      }
      if (/login|sign.?in|log.?in|create.?account/.test(pageUrl.toLowerCase()) ||
          (/login|sign.?in/.test(bodySnippet) && !/submit|add.*tool|description/.test(bodySnippet))) {
        throw new Error(`Page redirected to login — this site now requires an account.`);
      }
      if (/stripe\.com|checkout|payment|pricing|buy now|\$\d+/.test(bodySnippet) &&
          !/free/.test(bodySnippet)) {
        throw new Error(`Page appears to be a payment page — this site may no longer be free.`);
      }

      // 2. Take interactive snapshot
      console.log('  🔍 Scanning form fields...');
      const snapshot = await page.snapshot();
      const fields = parseSnapshot(snapshot);

      const detected = Object.entries(fields)
        .filter(([k, v]) => (k === 'pricingRadios' ? v.length > 0 : v))
        .map(([k, v]) => (k === 'pricingRadios' ? `pricing=${v.length} radios` : `${k}=${v}`))
        .join(', ');
      console.log(`  📋 Detected: ${detected || 'none'}`);

      if (!fields.name && !fields.url && !fields.description) {
        // No form visible — maybe the site requires login. Try "Login with Google"
        // (reuses the browser's existing Google session, no registration needed).
        console.log('  🔐 No form — trying Login with Google...');
        const oauthDone = await tryGoogleLogin(page);
        if (oauthDone) {
          await delay(2000);
          const snapshot2 = await page.snapshot();
          Object.assign(fields, parseSnapshot(snapshot2));
          const detected2 = Object.entries(fields)
            .filter(([k, v]) => (k === 'pricingRadios' ? v.length > 0 : v))
            .map(([k, v]) => (k === 'pricingRadios' ? `pricing=${v.length} radios` : `${k}=${v}`))
            .join(', ');
          console.log(`  📋 After Google login Detected: ${detected2 || 'none'}`);
        }
        if (!fields.name && !fields.url && !fields.description) {
          // Last resort: React-style fill (eval by placeholder/name, native setter + input event).
          // Many directory sites use React inputs that bb-browser snap can't label as textbox.
          console.log('  ⚛️ Trying React-style fill (eval by placeholder/name)...');
          const filled = await tryReactFill(page, product);
          if (filled >= 2) {
            const sub = await page.eval(`(() => {
              const s = document.querySelector('button[type=submit],input[type=submit]') ||
                [...document.querySelectorAll('button')].find(b => /submit|send|add|post|发布/i.test(b.textContent));
              if (s) { s.click(); return 'submitted'; }
              return 'no-submit';
            })()`);
            await delay(3000);
            console.log(`✅ Submitted (React fill, ${filled} fields, ${sub})`);
            return { url: page.url(), confirmation: 'React submission completed — verify manually' };
          }
          throw new Error(oauthDone
            ? 'No form even after Google login + React fill — site needs manual registration.'
            : 'No form fields (snap empty, no Google login, React fill failed).');
        }
      }

      // 3. Fill detected fields
      if (fields.name) {
        console.log(`  ✏️  Filling name: ${product.name}`);
        await page.fill(fields.name, product.name);
        await delay(300);
      }

      if (fields.url) {
        const url = product.utm_url || product.url;
        console.log(`  ✏️  Filling URL: ${url}`);
        await page.fill(fields.url, url);
        await delay(300);
      }

      if (fields.email) {
        console.log(`  ✏️  Filling email: ${product.email}`);
        await page.fill(fields.email, product.email);
        await delay(300);
      }

      if (fields.description) {
        const desc = product.long_description || product.description;
        console.log(`  ✏️  Filling description`);
        await page.fill(fields.description, desc);
        await delay(300);
      }

      // 3b. Category dropdown — read options, fuzzy-match product.categories
      if (fields.category) {
        try {
          const optionsJson = await page.eval(`JSON.stringify(Array.from(document.querySelector('select')?.options || []).map(o => ({ text: o.text.trim(), value: o.value })).filter(o => o.text))`);
          const options = JSON.parse(optionsJson);
          const wants = (product.categories || []).map(c => c.toLowerCase());
          let match = null;
          for (const want of wants) {
            match = options.find(o => o.text.toLowerCase().includes(want) || want.includes(o.text.toLowerCase().split(/[\s-]/)[0]));
            if (match) break;
          }
          if (match) {
            await page.select(fields.category, match.value || match.text);
            console.log(`  ✏️  Selecting category: ${match.text}`);
            await delay(300);
          } else {
            console.log(`  ⚠️  Category: no match for [${wants.join(',')}] in [${options.map(o => o.text).slice(0, 6).join(' | ')}] — set manually`);
          }
        } catch (e) {
          console.log(`  ⚠️  Category select failed: ${(e.message || '').split('\n')[0]}`);
        }
      }

      // 3c. Pricing radio — click the option matching product.pricing
      if (fields.pricingRadios.length && product.pricing) {
        const want = product.pricing.toLowerCase();
        const radio = fields.pricingRadios.find(r => r.value === want)
          || fields.pricingRadios.find(r => r.value.includes(want) || want.includes(r.value))
          || fields.pricingRadios.find(r => r.value.includes('free')); // default to a free tier
        if (radio) {
          console.log(`  ✏️  Selecting pricing: ${radio.value}`);
          await page.click(radio.ref);
          await delay(300);
        }
      }

      // 4. Screenshot before submit
      try {
        const screenshotDir = config.browser?.screenshot_dir || './screenshots';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        await page.screenshot(`${screenshotDir}/generic-${timestamp}.png`);
      } catch {}

      // 5. Submit
      if (fields.submit) {
        console.log(`  🚀 Clicking submit (${fields.submit})`);
        try {
          await page.click(fields.submit);
        } catch (e) {
          // bb-browser click @ref can fail (ref→xpath mapping breaks after fill);
          // fallback to JS click on submit input/button
          console.log(`  ⚠️  click @ref failed, fallback JS click`);
          await page.eval(`(()=>{const el=document.querySelector('input[type=submit],button[type=submit]')||[...document.querySelectorAll('button')].find(b=>/submit|send|add|post/i.test(b.textContent));if(el){el.click();return 'clicked'}return 'no submit el'})()`);
        }
        await delay(3000);
      } else {
        console.log('  ⚠️  No submit button found — form filled but not submitted');
      }

      const currentUrl = page.url();
      return {
        url: currentUrl,
        confirmation: fields.submit
          ? 'Generic submission completed — verify manually'
          : 'Form filled but no submit button found',
      };
    });
  },
};
