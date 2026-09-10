require('dotenv').config();

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = process.env.SHOT_PORT || 4777;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUTPUT_DIR = path.join(__dirname, '..', 'screenshots');
const CHROME_PATH = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      return res.status;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('Server did not start in time.');
}

async function capture(browser, name, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(OUTPUT_DIR, name), fullPage: false });
  await page.close();
  console.log(`  saved ${name}`);
}

async function login(browser, email, password) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('button[type="submit"]')
  ]);
  await page.close();
}

async function loginAndCapture(browser, name, url, email, password) {
  await login(browser, email, password);
  await capture(browser, name, url);
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uniuyp-shots-'));
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(PORT) };

  execSync(`node ${path.join(__dirname, 'seed.js')}`, { env, stdio: 'inherit' });

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env });
  try {
    await waitForServer(BASE_URL);
    console.log('Server up, capturing screenshots...');

    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
    });

    await capture(browser, '01-login.png', `${BASE_URL}/login`);
    await capture(browser, '02-register.png', `${BASE_URL}/register`);

    await loginAndCapture(browser, '03-admin-dashboard.png', `${BASE_URL}/admin/users`, 'demo.admin@uniuyo.edu.ng', 'demo1234');
    await loginAndCapture(browser, '04-upload.png', `${BASE_URL}/upload`, 'demo.lecturer@uniuyo.edu.ng', 'demo1234');
    await loginAndCapture(browser, '05-student-search.png', `${BASE_URL}/dashboard`, 'demo.student@uniuyo.edu.ng', 'demo1234');

    await browser.close();
    console.log('All screenshots captured.');
  } finally {
    server.kill();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
        break;
      } catch {
        await sleep(500);
      }
    }
    server.removeAllListeners();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});