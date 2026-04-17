const https = require("https");
const http = require("http");
const { URL } = require("url");
const zlib = require("zlib");

function fetchUrl(targetUrl, reqHeaders) {
  return new Promise((resolve, reject) => {
    let target;
    try { target = new URL(targetUrl); } catch (e) { return reject(new Error("Invalid URL")); }

    const lib = target.protocol === "https:" ? https : http;
    const options = {
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: target.pathname + target.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "close",
        "Upgrade-Insecure-Requests": "1",
      },
      timeout: 15000,
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      const encoding = res.headers["content-encoding"] || "";
      let stream = res;

      if (encoding === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());

      stream.on("data", c => chunks.push(c));
      stream.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), url: targetUrl }));
      stream.on("error", reject);
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    req.end();
  });
}

function resolveUrl(val, base) {
  try { return new URL(val, base).href; } catch { return null; }
}

function rewriteHtml(html, targetUrl, proxyBase) {
  const makeProxyUrl = (u) => `${proxyBase}?url=${encodeURIComponent(u)}`;

  // Rewrite src, href, action, srcset
  html = html.replace(/(\s(?:src|href|action))\s*=\s*(['"])(.*?)\2/gi, (m, attr, q, val) => {
    const trimmed = val.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("javascript:") || trimmed.startsWith("#") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) return m;
    const abs = resolveUrl(trimmed, targetUrl);
    if (!abs) return m;
    return `${attr}=${q}${makeProxyUrl(abs)}${q}`;
  });

  // Rewrite srcset
  html = html.replace(/\ssrcset\s*=\s*(['"])(.*?)\1/gi, (m, q, val) => {
    const rewritten = val.replace(/([^\s,]+)(\s*(?:\d+[wx])?)/g, (part, u, descriptor) => {
      const abs = resolveUrl(u.trim(), targetUrl);
      return abs ? makeProxyUrl(abs) + descriptor : part;
    });
    return ` srcset=${q}${rewritten}${q}`;
  });

  // Rewrite inline style url()
  html = html.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, val) => {
    if (!val || val.startsWith("data:")) return m;
    const abs = resolveUrl(val.trim(), targetUrl);
    if (!abs) return m;
    return `url(${q}${makeProxyUrl(abs)}${q})`;
  });

  // Rewrite <meta http-equiv="refresh">
  html = html.replace(/(content\s*=\s*["']\d+;\s*url=)([^"']+)(["'])/gi, (m, pre, u, q) => {
    const abs = resolveUrl(u.trim(), targetUrl);
    return abs ? `${pre}${makeProxyUrl(abs)}${q}` : m;
  });

  return html;
}

function buildToolbar(targetUrl, proxyBase) {
  return `
<style id="__pb_style">
#__pb{all:initial;position:fixed;top:0;left:0;right:0;z-index:2147483647;height:48px;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);display:flex;align-items:center;gap:8px;padding:0 14px;box-shadow:0 2px 12px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
#__pb *{all:initial;font-family:inherit;}
#__pb_logo{color:#a78bfa;font-size:13px;font-weight:700;white-space:nowrap;letter-spacing:.5px;}
#__pb_input{flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:#e2e8f0;font-size:13px;padding:7px 12px;outline:none;min-width:0;}
#__pb_input:focus{border-color:#7c3aed;background:rgba(255,255,255,0.12);}
#__pb_input::placeholder{color:#94a3b8;}
#__pb_go{background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;}
#__pb_go:hover{background:#6d28d9;}
#__pb_back,#__pb_fwd{background:rgba(255,255,255,0.08);color:#e2e8f0;border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:6px 10px;font-size:14px;cursor:pointer;line-height:1;}
#__pb_back:hover,#__pb_fwd:hover{background:rgba(255,255,255,0.15);}
#__pb_lock{font-size:14px;color:#4ade80;}
body{margin-top:48px!important;}
</style>
<div id="__pb">
  <span id="__pb_logo">&#127760; Proxy</span>
  <button id="__pb_back" onclick="history.back()">&#8592;</button>
  <button id="__pb_fwd" onclick="history.forward()">&#8594;</button>
  <span id="__pb_lock">${targetUrl.startsWith("https") ? "&#128274;" : "&#128275;"}</span>
  <input id="__pb_input" type="text" placeholder="Enter a URL..." value="${targetUrl.replace(/"/g, '&quot;')}" />
  <button id="__pb_go">Go</button>
</div>
<script>
(function(){
  var inp = document.getElementById('__pb_input');
  var btn = document.getElementById('__pb_go');
  function nav(){
    var v = inp.value.trim();
    if(!v) return;
    if(!/^https?:\\/\\//.test(v)) v = 'https://' + v;
    window.location.href = '${proxyBase}?url=' + encodeURIComponent(v);
  }
  btn.onclick = nav;
  inp.addEventListener('keydown', function(e){ if(e.key==='Enter') nav(); });
})();
</script>`;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const targetUrl = req.query.url;
  if (!targetUrl) {
    res.status(400).send("Missing ?url= parameter");
    return;
  }

  let normalized = targetUrl.trim();
  if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;

  const proxyBase = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}/api/proxy`;

  let result;
  try {
    result = await fetchUrl(normalized, req.headers);
  } catch (err) {
    res.status(502).send(`
<!DOCTYPE html><html><head><title>Proxy Error</title>
<style>body{font-family:sans-serif;background:#0f0f1a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
.box{background:#1e1e35;border:1px solid #2d2d4e;border-radius:16px;padding:2rem 2.5rem;text-align:center;max-width:480px;}
h2{color:#f87171;margin-bottom:.75rem;}p{color:#94a3b8;line-height:1.6;}
a{color:#a78bfa;text-decoration:none;}a:hover{text-decoration:underline;}</style></head>
<body><div class="box"><h2>&#9888; Connection Failed</h2>
<p>${err.message}</p><p><a href="/">&#8592; Back to home</a></p></div></body></html>`);
    return;
  }

  const { status, headers, body, url: finalUrl } = result;

  // Handle redirects
  if ([301, 302, 303, 307, 308].includes(status) && headers.location) {
    let loc = headers.location;
    try { loc = new URL(loc, finalUrl).href; } catch {}
    res.setHeader("Location", `${proxyBase}?url=${encodeURIComponent(loc)}`);
    res.status(302).end();
    return;
  }

  const ct = headers["content-type"] || "";

  // Pass through binary content (images, fonts, video, etc.)
  if (!ct.includes("text/html") && !ct.includes("text/css") && !ct.includes("javascript")) {
    res.setHeader("Content-Type", ct || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(status).send(body);
    return;
  }

  // Rewrite CSS
  if (ct.includes("text/css")) {
    let css = body.toString("utf8");
    css = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, val) => {
      if (!val || val.startsWith("data:")) return m;
      const abs = resolveUrl(val.trim(), finalUrl);
      if (!abs) return m;
      return `url(${q}${proxyBase}?url=${encodeURIComponent(abs)}${q})`;
    });
    res.setHeader("Content-Type", "text/css");
    res.status(200).send(css);
    return;
  }

  // Rewrite JS — just pass through (rewriting JS would break execution)
  if (ct.includes("javascript")) {
    res.setHeader("Content-Type", ct);
    res.status(200).send(body);
    return;
  }

  // Rewrite HTML
  let html = body.toString("utf8");
  html = rewriteHtml(html, finalUrl, proxyBase);

  const toolbar = buildToolbar(finalUrl, proxyBase);

  // Remove CSP and X-Frame headers that would block us
  // Inject toolbar after <body> or at top
  if (/<body[\s>]/i.test(html)) {
    html = html.replace(/<body([\s\S]*?)>/i, (m) => m + toolbar);
  } else {
    html = toolbar + html;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.removeHeader("content-security-policy");
  res.removeHeader("x-frame-options");
  res.status(200).send(html);
};
