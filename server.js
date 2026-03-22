const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const app = express();

// Serve static files (HTML, CSS, JS) from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint: fetches any URL and returns the response
app.get('/fetch', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing ?url= parameter');
  }

  try {
    // Fetch the target page with a modern User-Agent
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    // Get the response as text
    let data = await response.text();

    // Simple URL rewriting to make relative links go through the proxy
    // This helps images, CSS, and JS that use relative paths
    const baseUrl = targetUrl.replace(/\/[^\/]*$/, '/');
    data = data.replace(/(href|src)=["']\/([^"']*?)["']/g, `$1="/fetch?url=${baseUrl}$2"`);

    // Send back with original content type
    res.set('Content-Type', response.headers.get('content-type'));
    res.send(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).send(`Error fetching ${targetUrl}: ${err.message}`);
  }
});

// Catch-all route: serve the main index.html (for client-side routing, or if user goes to root)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Proxy browser running on port ${port}`);
});