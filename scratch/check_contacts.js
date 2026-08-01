async function run() {
  const token = '44763853d63c4544adad7ba9cb74ca4c';
  try {
    const res = await fetch('https://api.wazzup24.com/v3/contacts', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.ok) {
      const contacts = await res.json();
      console.log('Contacts returned by Wazzup:', JSON.stringify(contacts, null, 2));
    } else {
      console.error('Failed to fetch contacts:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Error fetching contacts:', err);
  }
}

run();
