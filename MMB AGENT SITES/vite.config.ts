import path from "path";
import http from "http";
import https from "https";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MORELOGIN_BASE = 'http://127.0.0.1:40000';
const MORELOGIN_API_KEY = process.env.MORELOGIN_API_KEY || '';

function moreloginRequest(apiPath: string, method: string, body?: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, MORELOGIN_BASE);
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 40000,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(MORELOGIN_API_KEY ? { Authorization: `Bearer ${MORELOGIN_API_KEY}` } : {}),
      },
      timeout: 60000,
    };
    if (body) {
      options.headers!['Content-Length'] = Buffer.byteLength(body).toString();
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode || 200, data });
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', (err) => reject(err));
    if (body) req.write(body);
    req.end();
  });
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    {
      name: 'sites-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/morelogin-api') && !req.url?.startsWith('/sitemap-fetch') && !req.url?.startsWith('/backend-api')) {
            return next();
          }

          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            res.statusCode = 204;
            res.end();
            return;
          }

          // Backend API proxy (localhost:3200 for Sites)
          if (req.url?.startsWith('/backend-api')) {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
              const apiPath = req.url!.replace('/backend-api', '') || '/';
              const payload = body || undefined;
              const options: http.RequestOptions = {
                hostname: '127.0.0.1',
                port: 3200,
                path: apiPath,
                method: req.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
                timeout: 60000,
              };
              if (payload) options.headers!['Content-Length'] = Buffer.byteLength(payload).toString();

              const proxyReq = http.request(options, (proxyRes) => {
                let data = '';
                proxyRes.on('data', (chunk) => { data += chunk; });
                proxyRes.on('end', () => {
                  res.setHeader('Content-Type', 'application/json');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  res.statusCode = proxyRes.statusCode || 200;
                  res.end(data);
                });
              });
              proxyReq.on('error', (err: any) => {
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 502;
                res.end(JSON.stringify({ error: 'Backend not running: ' + err.message }));
              });
              if (payload) proxyReq.write(payload);
              proxyReq.end();
            });
            return;
          }

          // Sitemap proxy — fetches any sitemap URL server-side (avoids CORS)
          if (req.url?.startsWith('/sitemap-fetch')) {
            const urlParams = new URL(req.url, 'http://localhost').searchParams;
            const sitemapUrl = urlParams.get('url');
            if (!sitemapUrl) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'url parameter required' }));
              return;
            }

            // Recursive fetch with redirect following (max 5 redirects)
            function fetchUrl(targetUrl: string, redirectsLeft: number) {
              try {
                const parsedUrl = new URL(targetUrl);
                const isHttps = parsedUrl.protocol === 'https:';
                const mod = isHttps ? https : http;

                const opts: any = {
                  hostname: parsedUrl.hostname,
                  port: parsedUrl.port ? Number(parsedUrl.port) : (isHttps ? 443 : 80),
                  path: parsedUrl.pathname + (parsedUrl.search || ''),
                  method: 'GET',
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                    'Accept': 'text/xml, application/xml, text/html, */*',
                    'Accept-Encoding': 'identity',
                  },
                  timeout: 20000,
                  rejectUnauthorized: false,
                };

                const fetchReq = mod.request(opts, (fetchRes: any) => {
                  // Follow redirects
                  if (fetchRes.statusCode >= 300 && fetchRes.statusCode < 400 && fetchRes.headers.location) {
                    if (redirectsLeft <= 0) {
                      res.statusCode = 502;
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ error: 'Too many redirects' }));
                      return;
                    }
                    let redirectTarget = fetchRes.headers.location;
                    // Handle relative redirects
                    if (redirectTarget.startsWith('/')) {
                      redirectTarget = `${parsedUrl.protocol}//${parsedUrl.hostname}${redirectTarget}`;
                    }
                    fetchUrl(redirectTarget, redirectsLeft - 1);
                    return;
                  }

                  // Non-200 response
                  if (fetchRes.statusCode >= 400) {
                    let errData = '';
                    fetchRes.on('data', (c: Buffer) => { errData += c.toString(); });
                    fetchRes.on('end', () => {
                      res.statusCode = 502;
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ error: `Remote returned ${fetchRes.statusCode}`, body: errData.substring(0, 200) }));
                    });
                    return;
                  }

                  // Success — stream data back
                  let data = '';
                  fetchRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
                  fetchRes.on('end', () => {
                    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.statusCode = 200;
                    res.end(data);
                  });
                });

                fetchReq.on('timeout', () => {
                  fetchReq.destroy();
                  res.statusCode = 504;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Sitemap fetch timed out (20s)' }));
                });

                fetchReq.on('error', (err: Error) => {
                  res.statusCode = 502;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Sitemap fetch failed: ' + err.message }));
                });

                fetchReq.end();
              } catch (err: any) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Invalid URL: ' + err.message }));
              }
            }

            fetchUrl(sitemapUrl, 5);
            return;
          }

          // MoreLogin API proxy
          let body = '';
          req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          req.on('end', async () => {
            const apiPath = req.url!.replace('/morelogin-api', '') || '/';
            try {
              const result = await moreloginRequest(apiPath, req.method || 'POST', body || undefined);
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.statusCode = result.status;
              res.end(result.data);
            } catch (err: any) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 502;
              res.end(JSON.stringify({ code: -1, msg: 'Proxy error: ' + (err?.message || 'Unknown') }));
            }
          });
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5200,
  },
});
