import puppeteer from 'puppeteer';
import axios from 'axios';
import chalk from 'chalk'; // Diimpor kembali
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HttpsProxyAgent } from 'https-proxy-agent';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NAV_TIMEOUT_MS = parseInt(process.env.NAV_TIMEOUT_MS || '300000', 10);

const API_BASE = 'https://api-hunter.membit.ai';
const ACCOUNTS_PATH = path.join(__dirname, 'accounts.json');
const COOKIES_PATH = path.join(__dirname, 'X', 'cookies.json');
const PROXY_PATH = path.join(__dirname, 'proxy.txt');
const HEADERS = {
  'authority': 'api-hunter.membit.ai',
  'accept': '*/*',
  'accept-encoding': 'gzip, deflate, br',
  'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
  'content-type': 'application/json',
  'origin': 'chrome-extension://fcjoldoebodoljbljpnkdnfgnpdgbdcm',
  'priority': 'u=1, i',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'none',
  'sec-fetch-storage-access': 'active',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
};

// --- Fungsi Logging Baru dengan Timestamp dan Warna ---

/**
 * Mendapatkan timestamp format HH:mm:ss WIB
 */
const getTimestamp = () => {
  return new Date().toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
};

const logSuccess = (msg) => console.log(chalk.gray(`[${getTimestamp()} WIB]`) + ' ' + chalk.green(msg));
const logError = (msg) => console.error(chalk.gray(`[${getTimestamp()} WIB]`) + ' ' + chalk.red(msg));
// DIUBAH: chalk.yellow -> chalk.blue
const logInfo = (msg) => console.log(chalk.gray(`[${getTimestamp()} WIB]`) + ' ' + chalk.blue(msg));
const logAccount = (msg) => console.log(chalk.gray(`[${getTimestamp()} WIB]`) + ' ' + chalk.cyan.bold(msg));
const logSeparator = () => console.log(chalk.blue('----------------------------------------------------'));

// ---------------------------------------------------

function mapSameSite(val) {
  if (!val) return undefined;
  const v = String(val).toLowerCase();
  if (v.includes('no') || v === 'no_restriction') return 'None';
  if (v.startsWith('lax')) return 'Lax';
  if (v.startsWith('strict')) return 'Strict';
  return undefined;
}

async function applyCookiesFromFile(page, filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(raw);
    const normalized = json.map(c => {
      const o = {
        name: c.name, value: c.value,
        domain: c.domain || '.x.com',
        path: c.path || '/',
        httpOnly: !!c.httpOnly,
        secure: !!c.secure
      };
      const ss = mapSameSite(c.sameSite);
      if (ss) o.sameSite = ss;
      if (c.expirationDate) o.expires = Math.floor(c.expirationDate);
      return o;
    });
    await page.setCookie(...normalized);
    logInfo('Sesi cookie berhasil diterapkan dari ' + filePath);
  } catch (e) {
    logError('Gagal menerapkan cookie: ' + e.message);
  }
}

function scheduleCookieRefresh(page, filePath, intervalMs = 4 * 60 * 60 * 1000) {
  setInterval(async () => {
    try {
      await applyCookiesFromFile(page, filePath);
      await page.reload({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
      logInfo('Refresh cookie otomatis & memuat ulang halaman.');
    } catch (err) {
      logError('Refresh cookie otomatis gagal: ' + err.message);
    }
  }, intervalMs);
}

function scheduleFeedStallGuard(page, { checkIntervalMs = 60000, maxStallChecks = 5, bottomThreshold = 1500 } = {}) {
  let lastHeight = 0;
  let stall = 0;
  setInterval(async () => {
    try {
      const state = await page.evaluate((threshold) => {
        const sh = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        const sy = window.scrollY || 0;
        const ih = window.innerHeight || 0;
        const atBottom = (sy + ih + threshold) >= sh;
        const txt = document.body ? document.body.innerText : '';
        const hasErr = /try again|something went wrong|reload|tap to retry/i.test(txt);
        return { sh, atBottom, hasErr };
      }, bottomThreshold);

      if (state.hasErr) {
        await page.reload({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
        logInfo('Refresh otomatis setelah halaman error.');
        stall = 0; lastHeight = 0;
        return;
      }

      if (state.atBottom) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      }

      if (state.sh <= lastHeight + 50 && state.atBottom) {
        stall++;
      } else {
        stall = 0;
      }
      lastHeight = state.sh;

      if (stall >= maxStallChecks) {
        await page.reload({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
        logInfo('Refresh otomatis karena feed terhenti.');
        stall = 0; lastHeight = 0;
      }
    } catch {}
  }, checkIntervalMs);
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = () => delay(Math.floor(Math.random() * 2000) + 1000);

function parseCookies(cookieString) {
  return cookieString.split('; ').map(cookie => {
    const [name, value] = cookie.split('=');
    return { name, value, domain: '.api-hunter.membit.ai', path: '/' };
  });
}

function censorUUID(uuid) {
  if (!uuid) return 'undefined';
  return uuid.slice(0, 8) + '****' + uuid.slice(-4);
}

function censorProxy(proxy) {
  if (!proxy) return 'none';
  const match = proxy.match(/^(https?:\/\/)?([^@]+@)?(.+)/);
  if (!match) return proxy;
  const [, scheme = 'http://', auth, host] = match;
  return `${scheme}${auth ? '****:****@' : ''}${host}`;
}

function generateRandomString(length = 10) {
  return crypto.randomBytes(length).toString('hex');
}

function generateDummyCookie() {
  const gaValue = `GA1.1.${generateRandomString(10)}.${Math.floor(Date.now() / 1000)}`;
  const pkceValue = generateRandomString(64);
  const gaSxValue = `GS2.1.s${Math.floor(Date.now() / 1000)}$o1$g1$t${Math.floor(Date.now() / 1000)}$j${Math.floor(Math.random() * 100)}$l0$h0`;
  return `_ga=${gaValue}; pkce_code_verifier=${pkceValue}; _ga_S0JR1YNYZX=${gaSxValue}`;
}

let failCount = 0;

async function loadAccountsAndCookies(page) {
  if (!fs.existsSync(ACCOUNTS_PATH)) {
    logError('KRITIKAL: File accounts.json tidak ditemukan! Keluar.');
    process.exit(1);
  }
  if (!fs.existsSync(COOKIES_PATH)) {
    logError('KRITIKAL: File cookies.json di folder X tidak ditemukan! Keluar.');
    process.exit(1);
  }
  let accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
  if (!Array.isArray(accounts) || accounts.length === 0 || !accounts[0].auth_token) {
    logError('KRITIKAL: Format accounts.json tidak valid. Harus berupa array objek dengan auth_token. Keluar.');
    process.exit(1);
  }
  accounts = accounts.map((acc, index) => {
    if (acc.hasOwnProperty('cookie') && acc.cookie === '') {
      acc.cookie = generateDummyCookie();
    }
    return acc;
  });
  const xCookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
  await page.setCookie(...xCookies);
  logInfo('Cookie browser dimuat dari cookies.json.');
  return accounts.map((acc, index) => ({
    authToken: acc.auth_token,
    apiCookies: acc.cookie ? parseCookies(acc.cookie) : parseCookies(generateDummyCookie())
  }));
}

async function scrapePost(page) {
  await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  await randomDelay();
  const postData = await page.evaluate(() => {
    const post = document.querySelector('article[data-testid="tweet"]');
    if (!post) return null;
    const url = post.querySelector('a[href*="/status/"]')?.href || '';
    const userNameDiv = post.querySelector('div[data-testid="User-Name"]');
    const userText = userNameDiv ? userNameDiv.innerText : '';
    const parts = userText.split('\n');
    const authorName = parts[0] || '';
    const authorHandle = parts[1] ? parts[1].slice(1) : '';
    const profileImage = post.querySelector('div[data-testid="Tweet-User-Avatar"] img')?.src || '';
    const timestamp = post.querySelector('time')?.getAttribute('datetime') || new Date().toISOString();
    const content = post.querySelector('div[data-testid="tweetText"]')?.innerText || '';
    const likes = parseInt(post.querySelector('button[data-testid="like"]')?.innerText.replace(/[^0-9]/g, '') || '0');
    const retweets = parseInt(post.querySelector('button[data-testid="retweet"]')?.innerText.replace(/[^0-9]/g, '') || '0');
    const replies = parseInt(post.querySelector('button[data-testid="reply"]')?.innerText.replace(/[^0-9]/g, '') || '0');
    const images = Array.from(post.querySelectorAll('img[src*="media"]')).map(img => img.src);
    let formattedContent = content;
    if (images.length > 0) {
      formattedContent += '\n\n' + images.map(img => `![image](${img})`).join('\n\n');
    }
    return {
      url,
      author: { name: authorName, handle: `@${authorHandle}`, profile_image: profileImage },
      timestamp,
      content: formattedContent,
      likes,
      retweets,
      replies
    };
  });
  if (!postData || !postData.url) {
    logError('Gagal mengambil post. Mencoba refresh...');
    failCount++;
    if (failCount > 3) {
      logInfo('Beberapa kali gagal scrape. Melakukan hard refresh...');
      await page.goto('https://x.com/home', { waitUntil: 'networkidle2' });
      await delay(3000);
      failCount = 0;
    }
    return null;
  }
  failCount = 0;
  logSuccess(`Post ditemukan: ${postData.author.handle} (Likes: ${postData.likes}, RTs: ${postData.retweets})`);
  return postData;
}

let proxyAgents = [];

function getProxyAgents(numAccounts) {
  if (!fs.existsSync(PROXY_PATH)) {
    logInfo('File proxy.txt tidak ditemukan. Menjalankan tanpa proxy.');
    proxyAgents = Array(numAccounts).fill(null);
    return proxyAgents;
  }
  const proxies = fs.readFileSync(PROXY_PATH, 'utf-8').trim().split('\n').filter(p => p.trim());
  if (proxies.length === 0) {
    logInfo('File proxy.txt kosong. Menjalankan tanpa proxy.');
    proxyAgents = Array(numAccounts).fill(null);
    return proxyAgents;
  }
  logInfo(`Memuat ${proxies.length} proxy dari proxy.txt.`);
  proxyAgents = proxies.map((proxy, index) => {
    return { proxy, agent: new HttpsProxyAgent(proxy) };
  });
  while (proxyAgents.length < numAccounts) {
    proxyAgents.push(null);
  }
  return proxyAgents;
}

function getNextProxy(accountIndex) {
  const currentProxyIndex = accountIndex;
  const nextProxyIndex = (currentProxyIndex + 1) % proxyAgents.length;
  if (proxyAgents[nextProxyIndex]) {
    logInfo(`[Akun ${accountIndex + 1}] Proxy gagal. Beralih permanen ke proxy: ${censorProxy(proxyAgents[nextProxyIndex].proxy)}`);
    proxyAgents[accountIndex] = proxyAgents[nextProxyIndex];
    return proxyAgents[accountIndex];
  } else {
    logInfo(`[Akun ${accountIndex + 1}] Tidak ada proxy tersisa. Melanjutkan tanpa proxy.`);
    proxyAgents[accountIndex] = null;
    return null;
  }
}

async function getUUID(postData, authToken, apiCookies, proxyAgent, accountIndex) {
  let currentAgent = proxyAgent ? proxyAgent.agent : null;
  try {
    const response = await axios.post(`${API_BASE}/posts/submit`, postData, {
      headers: { ...HEADERS, 'authorization': authToken, 'cookie': apiCookies.map(c => `${c.name}=${c.value}`).join('; ') },
      httpsAgent: currentAgent
    });
    const uuid = response.data.post_uuid;
    if (!uuid) {
      logError(`[Akun ${accountIndex + 1}] Gagal submit: Tidak ada UUID dalam respons.`);
      return null;
    }
    const censored = censorUUID(uuid);
    logSuccess(`[Akun ${accountIndex + 1}] Post berhasil disubmit. UUID: ${censored} | Poin: ${response.data.expected_epoch_points}`);
    return uuid;
  } catch (err) {
    logError(`[Akun ${accountIndex + 1}] Gagal mendapatkan UUID: ${err.message}`);
    if (err.code === 'ECONNREFUSED' || err.message.includes('network') || err.message.includes('timeout')) {
      const newProxy = getNextProxy(accountIndex);
      currentAgent = newProxy ? newProxy.agent : null;
      if (currentAgent || !newProxy) {
        return await getUUID(postData, authToken, apiCookies, newProxy, accountIndex);
      }
    }
    logError(`[Akun ${accountIndex + 1}] Error non-proxy atau proxy habis, skip: ${err.message}`);
    return null;
  }
}

async function submitEngagement(uuid, postData, authToken, apiCookies, proxyAgent, accountIndex) {
  const censored = censorUUID(uuid);
  let currentAgent = proxyAgent ? proxyAgent.agent : null;
  const payload = { post_uuid: uuid, url: postData.url, likes: postData.likes, retweets: postData.retweets, replies: postData.replies };
  try {
    await axios.post(`${API_BASE}/engagements/submit`, payload, {
      headers: { ...HEADERS, 'authorization': authToken, 'cookie': apiCookies.map(c => `${c.name}=${c.value}`).join('; ') },
      httpsAgent: currentAgent
    });
    logSuccess(`[Akun ${accountIndex + 1}] Engagement terkirim untuk ${censored}.`);
  } catch (err) {
    logError(`[Akun ${accountIndex + 1}] Gagal submit engagement untuk ${censored}: ${err.message}`);
    if (err.code === 'ECONNREFUSED' || err.message.includes('network') || err.message.includes('timeout')) {
      const newProxy = getNextProxy(accountIndex);
      currentAgent = newProxy ? newProxy.agent : null;
      if (currentAgent || !newProxy) {
        await submitEngagement(uuid, postData, authToken, apiCookies, newProxy, accountIndex);
      }
    } else {
      logError(`[Akun ${accountIndex + 1}] Error non-proxy engagement, skip: ${err.message}`);
    }
  }
}

async function logPointsAndEligiblePosts(authToken, apiCookies, proxyAgent, accountIndex) {
  let currentAgent = proxyAgent ? proxyAgent.agent : null;
  try {
    const response = await axios.get(`${API_BASE}/points/next_epoch`, {
      headers: { ...HEADERS, 'authorization': authToken, 'cookie': apiCookies.map(c => `${c.name}=${c.value}`).join('; ') },
      httpsAgent: currentAgent
    });
    const eligiblePosts = response.data.eligible_posts_count;
    const estimatedPoints = response.data.estimated_epoch_points;
    logInfo(`[Akun ${accountIndex + 1}] Update Stats: ${eligiblePosts} Post Valid | ${estimatedPoints} Estimasi Poin`);
  } catch (err) {
    logError(`[Akun ${accountIndex + 1}] Gagal mengambil data poin: ${err.message}`);
    if (err.code === 'ECONNREFUSED' || err.message.includes('network') || err.message.includes('timeout')) {
      const newProxy = getNextProxy(accountIndex);
      currentAgent = newProxy ? newProxy.agent : null;
      if (currentAgent || !newProxy) {
        await logPointsAndEligiblePosts(authToken, apiCookies, newProxy, accountIndex);
      }
    } else {
      logError(`[Akun ${accountIndex + 1}] Error non-proxy stats, skip: ${err.message}`);
    }
  }
}

// Blok utama (IIFE)
(async () => {
  logInfo('Memulai bot...');
  const now = new Date();
  logInfo(`Tanggal saat ini: ${now.getDate()} ${now.toLocaleString('id-ID', { month: 'long' })} ${now.getFullYear()}`);
  console.log(''); // Spasi
  
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  const accounts = await loadAccountsAndCookies(page);
  getProxyAgents(accounts.length);
  
  await page.goto('https://x.com/home', { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  logInfo('Sesi browser dimulai via cookie.');
  
  scheduleCookieRefresh(page, COOKIES_PATH);
  scheduleFeedStallGuard(page);
  
  while (true) {
    const postData = await scrapePost(page);
    if (!postData) continue;
    
    for (let i = 0; i < accounts.length; i++) {
      if (i > 0) logSeparator(); // Separator antar akun
      logAccount(`Memproses Akun ${i + 1} / ${accounts.length}`);
      
      const acc = accounts[i];
      const proxyAgent = proxyAgents[i];
      
      const uuid = await getUUID(postData, acc.authToken, acc.apiCookies, proxyAgent, i);
      if (!uuid) continue;
      
      await submitEngagement(uuid, postData, acc.authToken, acc.apiCookies, proxyAgent, i);
      await logPointsAndEligiblePosts(acc.authToken, acc.apiCookies, proxyAgent, i);
      await randomDelay();
    }
    
    logInfo('Memuat ulang timeline untuk post baru...');
    await page.reload({ waitUntil: 'networkidle2', timeout: NAV_TIMEOUT_MS });
  }
})();
