# ACH Year-Over-Year Comparison Dashboard

A Vercel-hosted dashboard for tracking incoming ACH payments per employer, comparing current year (2026) performance against the previous year (2025).

Built for Standard Holdings to monitor seasonal labor payment patterns across agricultural and landscaping clients.

## Features

- 🔍 **Employer Search** - Search by employer name (Everglades, Patterson Farms, etc.)
- 📊 **Year-over-Year Chart** - Interactive line chart comparing weekly ACH counts
- 📈 **Summary Statistics** - Total ACHs, YoY percentage change, trend status
- 👥 **Worker Aggregation** - Automatically aggregates all workers per employer

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
# Create .env.local with:
# UNIT_API_TOKEN=your_unit_api_token_here
# UNIT_API_URL=https://api.s.unit.sh

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNIT_API_TOKEN` | Your Unit API bearer token ([get from Unit Dashboard](https://app.s.unit.sh)) |
| `UNIT_API_URL` | `https://api.s.unit.sh` (sandbox) or `https://api.unit.co` (production) |

## Data Sources

- **ACH Payments**: [Unit Banking API](https://www.unit.co/docs/api/payments/ach/receiving/apis) - `GET /received-payments`
- **Customer Mapping**: [customer_company.json](https://github.com/standardholdingsllc/hubspot-address-mapper/blob/main/web-app/data/customer_company.json) - Maps Unit customer IDs to employer names

## Deployment to Vercel

1. Push to GitHub ✅
2. Import repository at [vercel.com/new](https://vercel.com/new)
3. Add environment variables in Vercel project settings:
   - `UNIT_API_TOKEN`
   - `UNIT_API_URL`
4. Deploy

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **API**: Unit Banking API
- **Hosting**: Vercel

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/employers?q=query` | Search employers by name |
| `GET /api/ach-data?employer=Name` | Get YoY ACH comparison data for an employer |

## Documentation

See [BUILD_GUIDE.md](./BUILD_GUIDE.md) for detailed implementation documentation.
