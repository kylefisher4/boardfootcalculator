# Board Footage Calculator

A lumber material takeoff tool that parses CSV material lists and calculates board footage using AI.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add your Anthropic API key

Create a `.env.local` file in the project root (or rename the included template):

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### 3. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

### Option A: Deploy from GitHub

1. Push this project to a GitHub repo
2. Go to [vercel.com](https://vercel.com) and sign in
3. Click "New Project" → Import your repo
4. In the project settings, add your environment variable:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your Anthropic API key
5. Click Deploy

### Option B: Deploy with Vercel CLI

```bash
npm i -g vercel
vercel
```

When prompted, add your environment variable:

```bash
vercel env add ANTHROPIC_API_KEY
```

Then redeploy:

```bash
vercel --prod
```

## Restricting Access

By default the app is open to anyone with the URL. To add access control:

- **Vercel Password Protection** (Pro plan): Settings → General → Password Protection
- **Simple auth**: Add a password check in `app/api/calculate/route.js`
- **Vercel Authentication** (Enterprise): Restrict to specific email domains

## Project Structure

```
├── app/
│   ├── layout.js          # Root HTML layout
│   ├── page.jsx           # Main calculator component
│   └── api/
│       └── calculate/
│           └── route.js   # API proxy (adds your key server-side)
├── package.json
├── next.config.js
├── .env.local             # Your API key (never committed)
└── .gitignore
```
