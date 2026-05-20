// Fetch channel videos using the same InnerTube method the project uses
const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  // First get channel page to find channel ID
  console.log('Fetching channel page...');
  try {
    const html = await fetchUrl('https://www.youtube.com/@KULDEEP1211-g9o');
    // Extract channel ID from page
    const match = html.match(/channel_id=([^"&]+)/);
    const match2 = html.match(/"channelId":"([^"]+)"/);
    const match3 = html.match(/externalId":"([^"]+)"/);
    
    const channelId = match2?.[1] || match3?.[1] || match?.[1];
    console.log('Channel ID:', channelId);
    
    if (channelId) {
      // Now fetch RSS feed
      console.log('\nFetching RSS feed...');
      const rss = await fetchUrl(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
      
      // Parse video titles and IDs
      const titles = [...rss.matchAll(/<title>([^<]+)<\/title>/g)].slice(1, 10); // skip channel title
      const videoIds = [...rss.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)];
      
      console.log(`\nChannel: ${[...rss.matchAll(/<title>([^<]+)<\/title>/g)][0]?.[1]}`);
      console.log(`Videos found: ${videoIds.length}\n`);
      
      for (let i = 0; i < Math.min(titles.length, 8); i++) {
        console.log(`  ${i+1}. "${titles[i][1]}"`);
        console.log(`     URL: https://www.youtube.com/watch?v=${videoIds[i]?.[1]}`);
      }
    } else {
      console.log('Could not find channel ID. Trying handle-based RSS...');
      // Try direct handle approach
      const rss = await fetchUrl('https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxxxxx');
      console.log(rss.substring(0, 300));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
