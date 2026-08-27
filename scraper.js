/**
 * ============================================
 * KUROIRU SCRAPER v4.0 - PUPPETER VERSION
 * ============================================
 * Menggunakan Puppeteer untuk render JavaScript
 * ============================================
 */

require('dotenv').config();

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

// ============ CONFIG ============
const CONFIG = {
  APP_URL: 'https://kuroiru.co/app',
  API_URL: 'https://kuroiru.co/api/anime/',
  BASE_URL: 'https://kuroiru.co',
  IMG_URL: 'https://kuroiru.co',
  TIMEOUT: 60000,
  DELAY: 500,
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ============ INIT ============
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Set SUPABASE_URL dan SUPABASE_KEY di .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Args
const args = process.argv.slice(2);
const isDebug = args.includes('--debug');
const isFast = args.includes('--catalog-only');
const limitArg = args.find(a => a.startsWith('--limit='));
const maxLimit = limitArg ? parseInt(limitArg.split('=')[1]) : 0;

// ============ LOGGING ============
const log = {
  info: (m) => console.log(`ℹ️  ${m}`),
  ok: (m) => console.log(`✅ ${m}`),
  warn: (m) => console.log(`⚠️  ${m}`),
  err: (m) => console.log(`❌ ${m}`),
  dbg: (m) => isDebug && console.log(`🔍 ${m}`),
  line: () => console.log('─'.repeat(60)),
};

// ============ CONCURRENCY LIMITER ============
class Limiter {
  constructor(n) { this.max = n; this.running = 0; this.queue = []; }
  async run(fn) {
    while (this.running >= this.max) await new Promise(r => this.queue.push(r));
    this.running++;
    try { return await fn(); } finally { this.running--; this.queue.shift()?.(); }
  }
}
const limiter = new Limiter(2);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============ PUPPETEER BROWSER ============
let browser = null;

async function getBrowser() {
  if (!browser) {
    log.info('Starting browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
    });
  }
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ============ STEP 1: SCRAPE IDs WITH PUPPETEER ============
async function scrapeAnimeIds() {
  log.info('Step 1: Scraping anime IDs (with Puppeteer)...');
  log.line();
  
  const browser = await getBrowser();
  const page = await browser.newPage();
  
  await page.setUserAgent(CONFIG.USER_AGENT);
  await page.setViewport({ width: 1920, height: 1080 });
  
  try {
    log.dbg('Navigating to ' + CONFIG.APP_URL);
    
    // Wait for network idle (semua request selesai)
    await page.goto(CONFIG.APP_URL, {
      waitUntil: 'networkidle0',
      timeout: CONFIG.TIMEOUT,
    });
    
    // Tunggu elemen anime muncul
    await page.waitForSelector('.panel-item', { timeout: 30000 });
    
    // Scroll sedikit untuk trigger lazy load
    await page.evaluate(() => {
      window.scrollBy(0, 500);
    });
    await sleep(1000);
    
    // Ambil HTML setelah JS render
    const html = await page.content();
    log.dbg(`HTML length after JS render: ${html.length}`);
    
    const $ = cheerio.load(html);
    const ids = [];
    const seen = new Set();
    
    $('.panel-item').each((_, el) => {
      const href = $(el).attr('href') || '';
      const match = href.match(/\/anime\/(\d+)/);
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        ids.push(match[1]);
        const title = $(el).find('.item-title').text().trim().substring(0, 40);
        log.dbg(`Found: ${match[1]} - ${title}`);
      }
    });
    
    log.line();
    log.ok(`Ditemukan ${ids.length} anime ID`);
    return maxLimit > 0 ? ids.slice(0, maxLimit) : ids;
    
  } catch (e) {
    log.err(`Puppeteer error: ${e.message}`);
    return [];
  } finally {
    await page.close();
  }
}

// ============ STEP 2: FETCH DETAIL FROM API ============
async function fetchAnimeDetail(id) {
  // API tidak butuh browser, bisa langsung fetch
  const axios = require('axios');
  
  try {
    const res = await axios.get(CONFIG.API_URL + id, {
      timeout: 30000,
      headers: { 'User-Agent': CONFIG.USER_AGENT },
    });
    
    const data = res.data;
    
    return {
      kuroiru_id: id,
      title: data.title || '',
      title_en: data.title_en || '',
      title_jp: data.title_jp || '',
      title_synonyms: data.title_synonyms || [],
      slug: `anime-${id}`,
      cover_url: data.picture 
        ? (data.picture.startsWith('http') ? data.picture : CONFIG.IMG_URL + data.picture)
        : null,
      type: data.info?.type || null,
      status: data.status || null,
      score: data.info?.score || null,
      members: data.info?.member || null,
      rank: data.info?.rank || null,
      rating: data.info?.rating || null,
      synopsis: data.info?.synopsis || null,
      duration: data.info?.duration || null,
      aired: data.info?.aired || null,
      season: data.info?.season || null,
      source: data.info?.source || null,
      genres: data.info?.genres || [],
      tags: data.info?.tags || '',
      studios: data.info?.studios || [],
      total_episodes: data.episodes || null,
      current_episode: data.lastep || null,
      dub: data.dub || false,
      schedule: data.schedule || null,
      anilist_id: data.al || null,
      youtube_id: data.yt || null,
      streams_url: `${CONFIG.BASE_URL}/anime/${id}/streams`,
      updated_at: new Date().toISOString(),
    };
  } catch (e) {
    log.warn(`API failed for ID ${id}: ${e.message}`);
    return null;
  }
}

// ============ STEP 3: SAVE TO DATABASE ============
async function saveToDb(anime) {
  if (!anime) return false;
  
  try {
    const { error } = await supabase
      .from('anime')
      .upsert({
        kuroiru_id: anime.kuroiru_id,
        title: anime.title,
        title_en: anime.title_en,
        title_jp: anime.title_jp,
        title_synonyms: anime.title_synonyms,
        slug: anime.slug,
        cover_url: anime.cover_url,
        type: anime.type,
        status: anime.status,
        score: anime.score,
        members: anime.members,
        rank: anime.rank,
        rating: anime.rating,
        synopsis: anime.synopsis,
        duration: anime.duration,
        aired: anime.aired,
        season: anime.season,
        source: anime.source,
        genres: anime.genres,
        tags: anime.tags,
        studios: anime.studios,
        total_episodes: anime.total_episodes,
        current_episode: anime.current_episode,
        dub: anime.dub,
        schedule: anime.schedule,
        anilist_id: anime.anilist_id,
        youtube_id: anime.youtube_id,
        streams_url: anime.streams_url,
        updated_at: anime.updated_at,
      }, { onConflict: 'kuroiru_id' });
    
    if (error) {
      log.err(`DB [${anime.kuroiru_id}]: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    log.err(`Exception [${anime.kuroiru_id}]: ${e.message}`);
    return false;
  }
}

// ============ MAIN ============
async function main() {
  const start = Date.now();
  
  log.info('🚀 KUROIRU SCRAPER v4.0 (PUPPETEER)');
  log.info(`Mode: ${isFast ? 'FAST (skip API)' : 'FULL (with API)'}`);
  if (maxLimit > 0) log.info(`Limit: ${maxLimit}`);
  if (isDebug) log.info('Debug: ON');
  log.line();
  
  try {
    // Step 1: Get anime IDs
    const ids = await scrapeAnimeIds();
    if (ids.length === 0) {
      log.warn('Tidak ada anime ditemukan');
      return;
    }
    
    // Step 2: Fetch details & save
    log.line();
    log.info(`Step 2: ${isFast ? 'Saving basic' : 'Fetching & saving'}...`);
    log.line();
    
    let saved = 0;
    let failed = 0;
    
    if (isFast) {
      for (const id of ids) {
        const anime = {
          kuroiru_id: id,
          title: '',
          slug: `anime-${id}`,
          streams_url: `${CONFIG.BASE_URL}/anime/${id}/streams`,
          updated_at: new Date().toISOString(),
        };
        const ok = await saveToDb(anime);
        ok ? saved++ : failed++;
      }
    } else {
      const tasks = ids.map((id, index) => 
        limiter.run(async () => {
          await sleep(index * CONFIG.DELAY);
          const detail = await fetchAnimeDetail(id);
          const ok = await saveToDb(detail);
          ok ? saved++ : failed++;
          if (detail) log.dbg(`[${saved + failed}/${ids.length}] ${detail.title_en || detail.title}`);
        })
      );
      await Promise.all(tasks);
    }
    
    // Summary
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    log.line();
    log.ok(`🎉 Selesai dalam ${duration} detik`);
    log.info(`✅ Berhasil: ${saved}`);
    if (failed > 0) log.warn(`❌ Gagal: ${failed}`);
    log.info(`📊 Total: ${ids.length}`);
    
  } finally {
    await closeBrowser();
  }
}

main();