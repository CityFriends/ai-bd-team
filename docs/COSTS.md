# AI BD Team - Cost Analysis

This document breaks down the costs of running the AI BD Team.

## Cost Summary

| Service | Free Tier | Typical Monthly | Heavy Usage |
|---------|-----------|-----------------|-------------|
| Anthropic (Claude) | - | $50-100 | $200-400 |
| SerpAPI | 100 searches | $75 (5k) | $150 (15k) |
| Supabase | 500MB free | $25 | $50+ |
| Slack | Free | Free | $8.75/user |
| SAM.gov | Free | Free | Free |
| FPDS | Free | Free | Free |
| USASpending | Free | Free | Free |
| **Total** | ~$0 | **$150-200** | **$400-600** |

---

## Anthropic Claude API

### Pricing Model
- **Input tokens**: $3.00 per million tokens
- **Output tokens**: $15.00 per million tokens
- Model: `claude-sonnet-4-20250514`

### Typical Usage

**Per agent response:**
- Input: ~1,500 tokens (prompt + context + research)
- Output: ~200 tokens (agent response)
- Cost: ~$0.0045 + $0.003 = **$0.0075 per response**

**Daily estimates (active team):**
| Activity | Responses/Day | Cost/Day |
|----------|---------------|----------|
| Light usage | 20 | $0.15 |
| Normal usage | 50 | $0.38 |
| Heavy usage | 100 | $0.75 |

**Monthly estimates:**
| Usage Level | Responses/Month | Monthly Cost |
|-------------|-----------------|--------------|
| Light | 400 | $3 |
| Normal | 1,000 | $7.50 |
| Active | 2,000 | $15 |
| Heavy | 5,000 | $37.50 |

### Cost Optimization
- Responses are capped at 500 tokens
- Research context is cached (reduces redundant calls)
- Only relevant APIs are called per message

---

## SerpAPI (News Search)

### Pricing Tiers
| Plan | Searches/Month | Price |
|------|----------------|-------|
| Free | 100 | $0 |
| Developer | 5,000 | $75 |
| Business | 15,000 | $150 |
| Enterprise | 50,000 | $300 |

### Typical Usage

**Per agent query:**
- News search: 1 API call
- Competitor intel: 4 API calls (protest, performance, awards, general)

**Monthly estimates:**
| Activity | Searches/Month | Plan Needed |
|----------|----------------|-------------|
| Light | 50-100 | Free |
| Normal | 500-1,000 | Developer ($75) |
| Heavy | 2,000-5,000 | Developer ($75) |
| Very Heavy | 5,000+ | Business ($150) |

### Cost Optimization
- Results cached for 2 hours
- GovCon-specific sources reduce noise
- Competitor intel searches batched

---

## Supabase

### Pricing Tiers
| Plan | Database | Price |
|------|----------|-------|
| Free | 500MB | $0 |
| Pro | 8GB | $25/month |
| Team | 8GB + more compute | $599/month |

### Storage Estimates

**Per month (active usage):**
| Table | Growth/Month |
|-------|-------------|
| agent_memory | ~50MB |
| research_cache | ~20MB (rotated) |
| message_claims | ~5MB (rotated) |
| competitor_intel | ~10MB |
| far_sections | ~100MB (static) |

**Total: ~100-200MB/month active growth**

Free tier (500MB) lasts ~3-6 months before needing Pro.

### Cost Optimization
- Rotate old cache entries
- Clean up old message claims
- Archive old agent_memory after 90 days

---

## Slack

### Pricing
| Plan | Price | Notes |
|------|-------|-------|
| Free | $0 | 90-day message history |
| Pro | $8.75/user/month | Full history, more apps |
| Business+ | $15/user/month | Advanced features |

### For AI BD Team
- Bots don't count as paid users
- Only human users need licenses
- Free tier works for small teams

### Recommendation
- Start with Free tier
- Upgrade to Pro if you need full message history
- Bot functionality works on all tiers

---

## Free Government APIs

### SAM.gov
- **Cost**: Free
- **Rate Limit**: 10,000 requests/day
- **Notes**: Requires API key registration

### FPDS
- **Cost**: Free
- **Rate Limit**: No hard limit (be respectful)
- **Notes**: Public RSS feed, no key needed

### USASpending
- **Cost**: Free
- **Rate Limit**: 1,000 requests/minute
- **Notes**: No key needed

---

## Hosting/Infrastructure

### Running Locally
- **Cost**: $0 (uses your machine)
- **Pros**: No hosting costs, easy development
- **Cons**: Must keep machine running

### Cloud Hosting Options

**Minimal (development/testing):**
| Provider | Type | Cost |
|----------|------|------|
| Railway | Container | $5-10/month |
| Fly.io | Container | $5-10/month |
| Render | Container | Free-$7/month |

**Production:**
| Provider | Type | Cost |
|----------|------|------|
| AWS EC2 t3.small | VM | ~$15/month |
| DigitalOcean Droplet | VM | $12-24/month |
| Google Cloud Run | Serverless | ~$10-20/month |

### Recommendation
- Development: Run locally
- Small production: Railway or Fly.io ($5-10)
- Enterprise: AWS/GCP with proper monitoring ($50+)

---

## Monthly Cost Scenarios

### Scenario 1: Startup/Testing
- 2-3 users, light usage
- Running locally
- Free Supabase tier

| Service | Cost |
|---------|------|
| Anthropic | $10 |
| SerpAPI | $0 (free tier) |
| Supabase | $0 (free tier) |
| Slack | $0 (free tier) |
| Hosting | $0 (local) |
| **Total** | **$10/month** |

### Scenario 2: Active Small Team
- 5-10 users, daily usage
- Cloud hosting
- Normal API usage

| Service | Cost |
|---------|------|
| Anthropic | $50 |
| SerpAPI | $75 |
| Supabase | $25 |
| Slack | $0 |
| Hosting | $10 |
| **Total** | **$160/month** |

### Scenario 3: Active Organization
- 10-20 users, heavy usage
- Production hosting
- Full Slack features

| Service | Cost |
|---------|------|
| Anthropic | $150 |
| SerpAPI | $150 |
| Supabase | $50 |
| Slack Pro | $87.50 (10 users) |
| Hosting | $25 |
| **Total** | **$462/month** |

---

## Cost Reduction Strategies

### 1. Caching
- Cache API responses (2-6 hours)
- Reduces duplicate calls by 60-80%

### 2. Smart Triggering
- Only call relevant APIs per query
- Skip news search if no agency mentioned
- Skip FPDS if no incumbent question

### 3. Response Limits
- Cap response tokens at 500
- Agents are concise by design

### 4. Database Cleanup
- Rotate cache entries weekly
- Archive old memory monthly
- Clean message claims daily

### 5. Usage Monitoring
- Track API calls per service
- Alert on unusual spikes
- Review monthly for optimization

---

## ROI Considerations

### Time Saved
- Manual SAM.gov search: 30 min/opportunity
- Manual FPDS research: 45 min/incumbent
- Manual news search: 20 min/topic
- **AI BD Team: 30 seconds**

### At $150/hour fully-loaded BD cost:
- 10 opportunities/week = 5 hours saved
- Monthly value: ~$3,000 in time savings
- ROI: ~15-20x on $150-200/month cost

### Qualitative Benefits
- Consistent research quality
- Institutional memory
- 24/7 availability
- Faster response to opportunities
- Better competitive intelligence
