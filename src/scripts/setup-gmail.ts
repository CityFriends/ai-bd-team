/**
 * Gmail OAuth Setup Script
 *
 * Run this once to get a refresh token for Gmail API access.
 * The refresh token is long-lived and can be used for automated email access.
 *
 * Usage:
 *   npm run setup:gmail
 *
 * Prerequisites:
 * 1. Go to Google Cloud Console: https://console.cloud.google.com/
 * 2. Create a new project (or use existing)
 * 3. Enable Gmail API: APIs & Services > Enable APIs > Gmail API
 * 4. Create OAuth credentials: APIs & Services > Credentials > Create Credentials > OAuth client ID
 *    - Application type: Desktop app
 *    - Download the JSON file
 * 5. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your .env file
 * 6. Run this script to get GMAIL_REFRESH_TOKEN
 */

import 'dotenv/config';
import { google } from 'googleapis';
import * as readline from 'readline';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify'];

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
║  4. Create OAuth credentials:                                     ║
║     APIs & Services > Credentials > Create Credentials            ║
║     > OAuth client ID > Desktop app                               ║
║                                                                   ║
║  5. Add to your .env file:                                        ║
║     GMAIL_CLIENT_ID=your_client_id                                ║
║     GMAIL_CLIENT_SECRET=your_client_secret                        ║
║                                                                   ║
║  6. Run this script again: npm run setup:gmail                    ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'urn:ietf:wg:oauth:2.0:oob' // For desktop/CLI apps
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

  1. Open this URL in your browser:

     ${authUrl}

  2. Sign in with the Gmail account that receives eBuy alerts

  3. Grant the requested permissions

  4. Copy the authorization code shown

╚═══════════════════════════════════════════════════════════════════╝
`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Enter the authorization code: ', async (code) => {
    rl.close();

    try {
      const { tokens } = await oauth2Client.getToken(code);

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
    } catch (err) {
      console.error('Error getting tokens:', err);
      process.exit(1);
    }
  });
}

main().catch(console.error);
