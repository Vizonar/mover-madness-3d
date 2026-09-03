// Run: node ngrok-tunnel.cjs <auth_token> <port>
// Example: node ngrok-tunnel.cjs 3IpkXB5It2qlTkt8PzGgBecTkM3_6PyNpqjmSbUCivKrRtVzt 2568

const { connect } = require('@ngrok/ngrok');

async function main() {
  const token = process.argv[2];
  const port = parseInt(process.argv[3]) || 2568;

  if (!token) {
    console.error('Usage: node ngrok-tunnel.cjs <authtoken> [port]');
    process.exit(1);
  }

  console.log('Creating ngrok tunnel...');
  console.log('Authtoken:', token.substring(0, 20) + '...');

  const listener = await connect({
    addr: port,
    authtoken: token,
  });

  const url = listener.url();
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`  TUNNEL URL: ${url}`);
  console.log(`  Forwarding to: localhost:${port}`);
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('Send this URL to your friend:');
  console.log(`  ${url}`);
  console.log('');
  console.log('Press Ctrl+C to stop.');
  console.log('');

  // Keep alive — setInterval prevents process from exiting
  setInterval(() => {}, 60000);
  process.stdin.resume();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
