/**
 * Gmail OAuth Setup Script
 *
 * Run this once to get a refresh token for Gmail API access.
 * Uses localhost redirect (Google deprecated the OOB flow).
 *
 * Usage:
 *   npm run setup:gmail
 *
 * Prerequisites:
 * 1. Go to Google Cloud Console: https://console.cloud.google.com/
 * 2. Create a new project (or use existing)
 * 3. Enable Gmail API: APIs & Services > Enable APIs > Gmail API
 * 4. Create OAuth credentials: APIs & Services > Credentials > Create Credentials > OAuth client ID
 *    - Application type: Web application (NOT Desktop)
 *    - Add authorized redirect URI: http://localhost:3000/oauth2callback
 *    - Download the JSON file
 * 5. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your .env file
 * 6. Run this script to get GMAIL_REFRESH_TOKEN
 */

import 'dotenv/config';
import { google } from 'googleapis';
import * as http from 'http';
import { URL } from 'url';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'];
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

async function main() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║                     Gmail Setup Instructions                       ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  1. Go to: https://console.cloud.google.com/                      ║
║                                                                   ║
║  2. Create or select a project                                    ║
║                                                                   ║
║  3. Enable Gmail API:                                             ║
║     APIs & Services > Enable APIs > Search "Gmail API" > Enable   ║
║                                                                   ║
║  4. Configure OAuth consent screen:                               ║
║     APIs & Services > OAuth consent screen                        ║
║     - User type: External                                         ║
║     - Add your email as a test user                               ║
║                                                                   ║
║  5. Create OAuth credentials:                                     ║
║     APIs & Services > Credentials > Create Credentials            ║
║     > OAuth client ID > Web application                           ║
║                                                                   ║
║     Add Authorized redirect URI:                                  ║
║     http://localhost:3000/oauth2callback                          ║
║                                                                   ║
║  6. Add to your .env file:                                        ║
║     GMAIL_CLIENT_ID=your_client_id                                ║
║     GMAIL_CLIENT_SECRET=your_client_secret                        ║
║                                                                   ║
║  7. Run this script again: npm run setup:gmail                    ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
  });

  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    Gmail Authorization                             ║
╠═══════════════════════════════════════════════════════════════════╣

  Starting local server on port 3000...

  Open this URL in your browser:

  ${authUrl}

  Sign in with the Gmail account that receives eBuy alerts.

  Waiting for authorization...

╚═══════════════════════════════════════════════════════════════════╝
`);

  // Create a simple HTTP server to receive the callback
  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/oauth2callback')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const url = new URL(req.url, 'http://localhost:3000');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400);
      res.end(`Authorization failed: ${error}`);
      console.error(`\nAuthorization failed: ${error}`);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400);
      res.end('No authorization code received');
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>✅ Authorization Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
          </body>
        </html>
      `);

      console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                         Success!                                   ║
╠═══════════════════════════════════════════════════════════════════╣

  Add this to your .env file:

  GMAIL_REFRESH_TOKEN=${tokens.refresh_token}

  Your Gmail is now connected! Maya will scan eBuy alert emails
  during her daily opportunity scan.

╚═══════════════════════════════════════════════════════════════════╝
`);

      server.close();
      process.exit(0);

    } catch (err) {
      res.writeHead(500);
      res.end('Error getting tokens');
      console.error('Error getting tokens:', err);
      server.close();
      process.exit(1);
    }
  });

  server.listen(3000, () => {
    console.log('  Server listening on http://localhost:3000');
    console.log('  Waiting for OAuth callback...\n');
  });

  // Timeout after 5 minutes
  setTimeout(() => {
    console.log('\nTimeout: No authorization received within 5 minutes.');
    server.close();
    process.exit(1);
  }, 5 * 60 * 1000);
}

main().catch(console.error);
