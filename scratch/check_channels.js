async function run() {
  const token = '44763853d63c4544adad7ba9cb74ca4c';
  try {
    const res = await fetch('https://api.wazzup24.com/v3/channels', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.ok) {
      const channels = await res.json();
      console.log('Channels returned by Wazzup:', JSON.stringify(channels, null, 2));
    } else {
      console.error('Failed to fetch channels:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Error fetching channels:', err);
  }
}

run();
