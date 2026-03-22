const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const cookieParser = require('cookie');
const cheerio = require('cheerio');
const app = express();

// Serve static files from "public"
app.use(express.static(path.join(__dirname, 'public')));

// In‑memory session store (simple, resets on restart)
const sessions = new Map(); // sessionId -> { cookies: string, lastUsed: timestamp }

// Helper to extract cookies from response headers
function getCookieString(res) {
  const setCookie = res.headers.raw()['set-cookie'];
  if (!setCookie) return '';
  return setCookie.map(c => c.split(';')[0]).join('; ');
}

// Main proxy endpoint
app.all('/proxy/*', async (req, res) => {
  // Extract the target URL from the path
  let targetUrl = req.params[0]; // everything after /proxy/
  if (!targetUrl.startsWith('http')) {
    targetUrl = 'https://' + targetUrl;
  }

  // Get session ID from request (if any)
  let sessionId = req.cookies.sessionId;
  if (!sessionId) {
    sessionId = Math.random().toString(36).substring(2, 15);
    res.cookie('sessionId', sessionId, { httpOnly: true });
  }

  // Retrieve stored cookies for this session
  let cookieHeader = '';
  if (sessions.has(sessionId)) {
    cookieHeader = sessions.get(sessionId).cookies;
  }

  // Prepare request options
  const fetchOptions = {
    method: req.method,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': req.headers.accept || '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'manual', // handle redirects ourselves
  };

  if (cookieHeader) {
    fetchOptions.headers['Cookie'] = cookieHeader;
  }

  if (req.method === 'POST') {
    fetchOptions.body = JSON.stringify(req.body);
    fetchOptions.headers['Content-Type'] = 'application/json';
  }

  try {
    // Fetch from target
    const response = await fetch(targetUrl, fetchOptions);

    // Update stored cookies with new ones from response
    const newCookies = getCookieString(response);
    if (newCookies) {
      const oldCookies = sessions.has(sessionId) ? sessions.get(sessionId).cookies : '';
      const merged = mergeCookies(oldCookies, newCookies);
      sessions.set(sessionId, { cookies: merged, lastUsed: Date.now() });
    }

    // Handle redirects
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      let location = response.headers.get('location');
      // Make location relative to our proxy
      if (location.startsWith('/')) {
        location = targetUrl.replace(/^https?:\/\/[^\/]+/, '') + location;
      }
      const proxyLocation = `/proxy/${location.replace(/^https?:\/\//, '')}`;
      return res.redirect(proxyLocation);
    }

    // Get response body
    let body = await response.text();
    const contentType = response.headers.get('content-type') || '';

    // If HTML, rewrite URLs to go through the proxy
    if (contentType.includes('text/html')) {
      const $ = cheerio.load(body);
      // Rewrite all links and forms
      $('a, form, link[rel="stylesheet"], script[src], img[src]').each((i, el) => {
        const tag = el.name;
        const attr = tag === 'a' ? 'href' : (tag === 'form' ? 'action' : (tag === 'link' ? 'href' : 'src'));
        let url = $(el).attr(attr);
        if (url && !url.startsWith('data:') && !url.startsWith('#')) {
          // Make absolute URL
          if (url.startsWith('/')) {
            url = new URL(url, targetUrl).href;
          } else if (!url.startsWith('http')) {
            url = new URL(url, targetUrl).href;
          }
          // Rewrite to proxy
          const proxyUrl = `/proxy/${url.replace(/^https?:\/\//, '')}`;
          $(el).attr(attr, proxyUrl);
        }
      });
      // Rewrite any inline scripts that might contain URLs (simplistic)
      body = $.html();
    }

    // Forward the response
    res.set('Content-Type', contentType);
    res.status(response.status);
    res.send(body);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send(`Error fetching ${targetUrl}: ${err.message}`);
  }
});

// Helper to merge cookies (simple concatenation, dedupe by name)
function mergeCookies(oldStr, newStr) {
  const old = oldStr.split('; ').filter(c => c);
  const add = newStr.split('; ').filter(c => c);
  const map = new Map();
  [...old, ...add].forEach(c => {
    const [name, ...rest] = c.split('=');
    map.set(name, c);
  });
  return Array.from(map.values()).join('; ');
}

// Serve the main HTML interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Instagram proxy running on port ${port}`);
});
