# ACH Year-Over-Year Comparison Dashboard

A Vercel-hosted dashboard for tracking incoming ACH payments per employer, comparing current year performance against the previous year.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Unit API credentials

# Replace placeholder customer data
# Copy your real customer_company.json to data/customer_company.json

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## Configuration

### Environment Variables

Create `.env.local` with:

```env
UNIT_API_TOKEN=your_unit_api_token_here
UNIT_API_URL=https://api.s.unit.sh
```

| Variable | Description |
|----------|-------------|
| `UNIT_API_TOKEN` | Your Unit API bearer token (get from Unit Dashboard) |
| `UNIT_API_URL` | `https://api.s.unit.sh` (sandbox) or `https://api.unit.co` (production) |

### Customer Mapping

Replace `data/customer_company.json` with your actual customer-to-employer mapping file.

Expected structure:
```json
{
  "mappings": [
    {
      "customerId": "123456",
      "accountId": "789012",
      "employerName": "Example Farms LLC"
    }
  ]
}
```

## Deployment

### Deploy to Vercel

1. Push to GitHub
2. Import repository at [vercel.com/new](https://vercel.com/new)
3. Add environment variables in Vercel project settings
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
| `GET /api/ach-data?customerId=123` | Get YoY ACH comparison data |

## Resources

- [Unit API Documentation](https://www.unit.co/docs/api/)
- [Received Payments API](https://www.unit.co/docs/api/payments/ach/receiving/apis)
- [Build Guide](./BUILD_GUIDE.md)
